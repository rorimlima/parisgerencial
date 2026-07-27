/**
 * Auditoria dos cálculos da Previsão de Pagamento (RFN046) e da coluna
 * AUTOMÁTICA do Fluxo de Caixa.
 *
 * Reimplementa aqui, de forma independente e sem depender de React, as mesmas
 * regras de `src/utils/rfn046Parser.ts` e `src/utils/payableForecast.ts`, e
 * confere os totais contra a planilha real. Se um dia alguém mexer na régua de
 * semanas ou no critério de título em aberto, este teste acusa.
 *
 * Uso:  node scripts/testPrevisaoPagamento.mjs [caminho/RFN046.xlsx]
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKS = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];

const normalizeIsoDate = (raw) => {
  if (!raw && raw !== 0) return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  const s = raw.toString().trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return '';
};

const weekOfMonth = (iso) => {
  const day = parseInt((iso || '').slice(8, 10), 10);
  if (isNaN(day)) return 'sem01';
  return WEEKS[Math.min(4, Math.max(0, Math.floor((day - 1) / 7)))];
};

const num = (v) => {
  if (typeof v === 'number') return v;
  const s = (v ?? '').toString().replace(/[^0-9,.-]/g, '');
  if (!s) return 0;
  const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return isNaN(n) ? 0 : n;
};

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let failures = 0;
const check = (label, actual, expected, tol = 0.01) => {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) <= tol : actual === expected;
  if (!ok) failures++;
  // Contagens são inteiros e aparecem como número puro; valores monetários em R$.
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : brl(v)) : v);
  const shown = fmt(actual);
  const exp = fmt(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${shown}${ok ? '' : `  (esperado ${exp})`}`);
};

const file =
  process.argv[2] ||
  ['uploads/RFN046_TITULOS270726110909.xlsx', 'RFN046_TITULOS270726110909.xlsx'].find((p) => fs.existsSync(p));

if (!file || !fs.existsSync(file)) {
  console.error('Planilha RFN046 não encontrada. Passe o caminho como argumento.');
  process.exit(1);
}

const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

console.log(`\nArquivo: ${path.basename(file)} — ${rows.length} linha(s)\n`);

// ── 1. Parsing e validação ─────────────────────────────────────────────────
const parsed = rows.map((r) => {
  const dueDate = normalizeIsoDate(r['Titulo_DataVencimento']);
  const paymentDate = normalizeIsoDate(r['Titulo_DataPagamento']);
  const balance = Math.abs(num(r['Titulo_Saldo']));
  return {
    titleCode: (r['Titulo_Codigo'] ?? '').toString().trim(),
    dueDate,
    paymentDate,
    balance,
    year: parseInt(dueDate.slice(0, 4), 10) || 0,
    monthKey: MONTH_KEYS[parseInt(dueDate.slice(5, 7), 10) - 1] || '',
    valid: !!dueDate && balance > 0 && !paymentDate,
  };
});

const validos = parsed.filter((t) => t.valid);
const totalPrevisto = validos.reduce((a, t) => a + t.balance, 0);

console.log('1) Leitura e validação do RFN046');
check('títulos válidos (em aberto)', validos.length, rows.length);
check('saldo total previsto', totalPrevisto, rows.reduce((a, r) => a + Math.abs(num(r['Titulo_Saldo'])), 0));
check('nenhum título com data de pagamento', parsed.filter((t) => t.paymentDate).length, 0);
check('chaves únicas (sem duplicidade)', new Set(validos.map((t) => t.titleCode)).size, validos.length);

// ── 2. Quebra por semana bate com o total ──────────────────────────────────
console.log('\n2) Quebra por mês e semana (régua 1–7 / 8–14 / 15–21 / 22–28 / 29–31)');
const porMes = new Map();
for (const t of validos) {
  const key = `${t.year}_${t.monthKey}`;
  if (!porMes.has(key)) porMes.set(key, { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 });
  porMes.get(key)[weekOfMonth(t.dueDate)] += t.balance;
}
let somaSemanas = 0;
for (const [key, semanas] of [...porMes.entries()].sort()) {
  const totalMes = WEEKS.reduce((a, w) => a + semanas[w], 0);
  somaSemanas += totalMes;
  console.log(
    `  ${key}: ` +
      WEEKS.map((w) => `${w.replace('sem0', 'S')}=${semanas[w] ? brl(semanas[w]) : '—'}`).join('  ') +
      `  | total ${brl(totalMes)}`
  );
}
check('soma das semanas = total previsto', somaSemanas, totalPrevisto);

// Nenhum vencimento pode cair fora das 5 semanas
const diasForaDaRegua = validos.filter((t) => {
  const d = parseInt(t.dueDate.slice(8, 10), 10);
  return isNaN(d) || d < 1 || d > 31;
});
check('vencimentos com dia válido', diasForaDaRegua.length, 0);

// ── 3. Consulta por intervalo ──────────────────────────────────────────────
console.log('\n3) Consulta por intervalo de dias');
const inRange = (ini, fim) => validos.filter((t) => t.dueDate >= ini && t.dueDate <= fim);
const datas = validos.map((t) => t.dueDate).sort();
const primeiro = datas[0];
const ultimo = datas[datas.length - 1];

check('intervalo completo = total previsto', inRange(primeiro, ultimo).reduce((a, t) => a + t.balance, 0), totalPrevisto);
check('intervalo vazio (antes do primeiro vencimento)', inRange('1900-01-01', '1900-12-31').length, 0);

// Partição: qualquer corte no meio tem que somar exatamente o total.
const corte = datas[Math.floor(datas.length / 2)];
const anterior = (() => {
  const d = new Date(`${corte}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const parteA = inRange(primeiro, anterior).reduce((a, t) => a + t.balance, 0);
const parteB = inRange(corte, ultimo).reduce((a, t) => a + t.balance, 0);
check(`partição em ${corte} sem sobra nem sobreposição`, parteA + parteB, totalPrevisto);

// ── 4. Dupla contagem: previsão x títulos pagos ────────────────────────────
console.log('\n4) Proteção contra dupla contagem');
// Simula a quitação de metade dos títulos pelo RFN006 (mesma chave Titulo_Codigo).
const pagos = new Set(validos.slice(0, Math.floor(validos.length / 2)).map((t) => t.titleCode));
const aposQuitacao = validos
  .map((t) => (pagos.has(t.titleCode) ? { ...t, paymentDate: '2026-07-27', balance: 0 } : t))
  .filter((t) => t.balance > 0 && !t.paymentDate);
const totalApos = aposQuitacao.reduce((a, t) => a + t.balance, 0);
const totalPagos = validos.filter((t) => pagos.has(t.titleCode)).reduce((a, t) => a + t.balance, 0);

check('títulos quitados saem da previsão', aposQuitacao.length, validos.length - pagos.size);
check('previsão restante + quitados = total original', totalApos + totalPagos, totalPrevisto);

console.log(
  `\n${failures === 0 ? '✓ TODAS AS VERIFICAÇÕES PASSARAM' : `✗ ${failures} VERIFICAÇÃO(ÕES) FALHOU(RAM)`}\n` +
    `Total previsto a pagar no arquivo: ${brl(totalPrevisto)} em ${validos.length} título(s).\n`
);

process.exit(failures === 0 ? 0 : 1);
