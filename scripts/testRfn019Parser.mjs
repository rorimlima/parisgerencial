/**
 * Conferência do parser RFN019 (src/utils/rfn019Parser.ts).
 *
 * Roda com: node scripts/testRfn019Parser.mjs [caminho-do-30108.xlsx] [caminho-do-30101.xlsx]
 *
 * O que este teste protege
 * ------------------------
 * 1. O parser da TELA e o SEED gravado no banco têm que gerar exatamente as
 *    mesmas chaves. Se divergirem, reimportar a planilha pela tela duplica
 *    tudo que o seeder já colocou lá — o pior cenário possível para o caixa.
 *    Por isso o teste roda o parser TypeScript de verdade contra os .xlsx
 *    originais e compara linha a linha com scripts/data/rfn019Seed.json.
 * 2. Idempotência: passar o mesmo arquivo duas vezes tem que produzir chaves
 *    idênticas, e o conjunto de chaves tem que ser único.
 * 3. A separação entre transferência interna e movimento real, que é o que
 *    decide se o dinheiro entra ou não no Resultado Financeiro.
 *
 * Sem os .xlsx à mão, o teste ainda valida chaves, idempotência e regras de
 * transferência usando o próprio seed — só pula a comparação com a origem.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Carrega o módulo TS real (sem build), resolvendo o import interno entre eles.
const cache = new Map();
const loadTs = (relPath) => {
  if (cache.has(relPath)) return cache.get(relPath);
  const abs = resolve(root, relPath);
  const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.require = (spec) => {
    if (spec.startsWith('.')) {
      const p = resolve(dirname(abs), spec).replace(root + '/', '') + '.ts';
      return loadTs(p);
    }
    return Module.createRequire(abs)(spec);
  };
  cache.set(relPath, m.exports);
  m._compile(js, abs);
  cache.set(relPath, m.exports);
  return m.exports;
};

const { parseRfn019Rows, summarizeRfn019, isInternalTransferRow, normalizeRfn019Date, toAmount } =
  loadTs('src/utils/rfn019Parser.ts');
const { statementDocId, buildTesourariaDedupeKey, buildBankDedupeKey } = loadTs('src/utils/statementKeys.ts');

let passed = 0;
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

const seed = JSON.parse(readFileSync(resolve(root, 'scripts/data/rfn019Seed.json'), 'utf8'));

console.log('\n── Seed gravado no banco ──');
check('seed tem 2.125 lançamentos', seed.length === 2125, `veio ${seed.length}`);
const seedKeys = seed.map((e) => e.dedupeKey);
check('nenhuma chave repetida no seed', new Set(seedKeys).size === seedKeys.length);
const seedIds = seedKeys.map(statementDocId);
check('nenhum ID de documento repetido', new Set(seedIds).size === seedIds.length);
check('todo ID é válido no Firestore (sem barra, ≤1500 bytes)',
  seedIds.every((id) => !id.includes('/') && Buffer.byteLength(id) <= 1500 && id !== '.' && id !== '..'));
check('toda linha tem data, conta e chave',
  seed.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.accountCode && e.dedupeKey));
check('toda linha tem valor (entrada ou saída)',
  seed.every((e) => e.entryAmount > 0 || e.exitAmount > 0));
check('tipo é DINHEIRO em todas as linhas', seed.every((e) => e.documentType === 'DINHEIRO'));

const c30108 = seed.filter((e) => e.accountCode === '30108');
const c30101 = seed.filter((e) => e.accountCode === '30101');
check('Caixa 30108 com 1.950 lançamentos', c30108.length === 1950, `veio ${c30108.length}`);
check('Tesouraria 30101 com 175 lançamentos', c30101.length === 175, `veio ${c30101.length}`);

console.log('\n── Transferência interna x movimento real ──');
const transf = seed.filter((e) => e.isInternalTransfer);
const real = seed.filter((e) => !e.isInternalTransfer);
check('797 transferências internas detectadas', transf.length === 797, `veio ${transf.length}`);
check('todas as transferências estão no Caixa 30108', transf.every((e) => e.accountCode === '30108'));
check('transferências somam R$ 1.203.042,27 de crédito',
  approx(transf.reduce((a, e) => a + e.entryAmount, 0), 1203042.27));
check('transferência não tem débito', approx(transf.reduce((a, e) => a + e.exitAmount, 0), 0));
check('entradas REAIS do período = R$ 28.390,00',
  approx(real.reduce((a, e) => a + e.entryAmount, 0), 28390.0));
check('saídas REAIS do período = R$ 3.895.237,39',
  approx(real.reduce((a, e) => a + e.exitAmount, 0), 3895237.39));

// A regra de detecção, isolada
check('conta gerencial 30101 é transferência', isInternalTransferRow('30101', 'CAIXA 301.01 TESOURARIA'));
check('conta gerencial 30108 é transferência', isInternalTransferRow('30108', ''));
check('salários NÃO é transferência', !isInternalTransferRow('21023', 'SALARIOS E ORDENADOS'));
check('compra de peças NÃO é transferência', !isInternalTransferRow('20102', 'COMPRA DE PECAS P/ESTOQUE'));
check('detecta pelo texto mesmo sem identificador', isInternalTransferRow('', 'TRANSFERENCIA CAIXA 301.01'));

console.log('\n── 2026 (o ano que aparece no painel) ──');
const s26 = seed.filter((e) => e.year === 2026);
const real26 = s26.filter((e) => !e.isInternalTransfer);
check('2026 tem 166 lançamentos', s26.length === 166, `veio ${s26.length}`);
check('2026: entradas reais = R$ 0,00 (nenhum recebimento de cliente em dinheiro)',
  approx(real26.reduce((a, e) => a + e.entryAmount, 0), 0));
check('2026: saídas reais = R$ 665.187,89',
  approx(real26.reduce((a, e) => a + e.exitAmount, 0), 79129.79 + 586058.1));
check('2026: R$ 42.543,77 de transferência ficariam fora das entradas',
  approx(s26.filter((e) => e.isInternalTransfer).reduce((a, e) => a + e.entryAmount, 0), 42543.77));
check('todo lançamento de 2026 tem mês válido',
  s26.every((e) => ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].includes(e.monthKey)));

console.log('\n── Helpers de leitura ──');
check('data como objeto Date', normalizeRfn019Date(new Date(2026, 6, 20)) === '2026-07-20');
check('data ISO', normalizeRfn019Date('2026-07-20') === '2026-07-20');
check('data DD/MM/AAAA', normalizeRfn019Date('20/07/2026') === '2026-07-20');
check('data vazia devolve vazio', normalizeRfn019Date('') === '' && normalizeRfn019Date(null) === '');
check('valor pt-BR 1.234,56', approx(toAmount('1.234,56'), 1234.56));
check('valor com R$', approx(toAmount('R$ 2.100,53'), 2100.53));
check('valor negativo vira positivo', approx(toAmount(-500), 500));
check('valor vazio = 0', toAmount('') === 0 && toAmount(null) === 0);
check('chave é estável entre chamadas',
  buildTesourariaDedupeKey('30108', '100928') === buildTesourariaDedupeKey('30108', ' 100928 '));
check('mesma numeração em contas diferentes gera chaves diferentes',
  buildTesourariaDedupeKey('30108', '160225') !== buildTesourariaDedupeKey('30101', '160225'));

console.log('\n── Chave dos extratos bancários (sem ID de movimento) ──');
const bank = (over = {}) =>
  buildBankDedupeKey({
    source: 'bradesco',
    date: '2026-07-24',
    documentRef: '',
    description: 'PAGTO ELETRON COBRANCA',
    entryAmount: 0,
    exitAmount: 7567.15,
    occurrence: 0,
    ...over,
  });
check('mesma linha gera sempre a mesma chave', bank() === bank());
check('espaço e caixa não mudam a chave', bank() === bank({ description: '  pagto   Eletron Cobranca ' }));
check('acento não muda a chave', bank({ description: 'JOSE' }) === bank({ description: 'JOSÉ' }));
check('valor diferente gera chave diferente', bank() !== bank({ exitAmount: 7567.16 }));
check('data diferente gera chave diferente', bank() !== bank({ date: '2026-07-25' }));
check('linhas idênticas no mesmo dia não colidem', bank({ occurrence: 0 }) !== bank({ occurrence: 1 }));
check('chave de banco não colide com a de tesouraria',
  statementDocId(bank()) !== statementDocId(buildTesourariaDedupeKey('30108', '1')));

// Descrições longas: o corte não pode fazer duas linhas virarem o mesmo documento
const longA = bank({ description: 'X'.repeat(400) + 'FIM-A' });
const longB = bank({ description: 'X'.repeat(400) + 'FIM-B' });
check('descrições longas com mesmo começo geram IDs diferentes',
  statementDocId(longA) !== statementDocId(longB));
check('ID de descrição longa respeita o limite do Firestore',
  Buffer.byteLength(statementDocId(longA)) <= 1500);

// ── Comparação com os .xlsx originais (o teste que realmente importa) ──
const f1 = process.argv[2] || '/tmp/f1.xlsx';
const f2 = process.argv[3] || '/tmp/f2.xlsx';

if (existsSync(f1) && existsSync(f2)) {
  console.log('\n── Parser da TELA x seed do BANCO (mesmas planilhas) ──');
  const readSheet = (path, account) => {
    const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    return parseRfn019Rows(rows, account);
  };

  const parsed = [...readSheet(f1, '30108'), ...readSheet(f2, '30101')];
  check('parser lê as mesmas 2.125 linhas', parsed.length === seed.length, `parser=${parsed.length} seed=${seed.length}`);

  const seedByKey = new Map(seed.map((e) => [e.dedupeKey, e]));
  let diffs = [];
  for (const p of parsed) {
    const s = seedByKey.get(p.dedupeKey);
    if (!s) { diffs.push(`chave inexistente no seed: ${p.dedupeKey}`); continue; }
    for (const f of ['date', 'description', 'clientName', 'documentType', 'documentRef', 'managementAccount']) {
      if ((p[f] || '') !== (s[f] || '')) diffs.push(`${p.dedupeKey}.${f}: parser="${p[f]}" seed="${s[f]}"`);
    }
    if (!approx(p.entryAmount, s.entryAmount)) diffs.push(`${p.dedupeKey}.entrada ${p.entryAmount}≠${s.entryAmount}`);
    if (!approx(p.exitAmount, s.exitAmount)) diffs.push(`${p.dedupeKey}.saida ${p.exitAmount}≠${s.exitAmount}`);
    if (p.isInternalTransfer !== s.isInternalTransfer) diffs.push(`${p.dedupeKey}.transferencia divergente`);
  }
  check('parser da tela reproduz o seed campo a campo (zero divergência)', diffs.length === 0,
    diffs.slice(0, 5).join(' | '));

  console.log('\n── Idempotência ──');
  const again = [...readSheet(f1, '30108'), ...readSheet(f2, '30101')];
  check('reprocessar o mesmo arquivo gera exatamente as mesmas chaves',
    again.map((r) => r.dedupeKey).join('|') === parsed.map((r) => r.dedupeKey).join('|'));
  check('reimportar não cria documento novo (mesmos IDs)',
    new Set(again.map((r) => statementDocId(r.dedupeKey))).size === new Set(seedIds).size);

  const sum = summarizeRfn019(parsed);
  check('resumo confere as saídas reais', approx(sum.saidasReais, 3895237.39));
  check('resumo confere as transferências', sum.transferenciasCount === 797);

  console.log('\n── Importar a MESMA planilha na conta ERRADA ──');
  const wrong = readSheet(f2, '30108');
  const collide = wrong.filter((w) => seedByKey.has(w.dedupeKey) && seedByKey.get(w.dedupeKey).accountCode !== '30108');
  check('conta errada não sobrescreve lançamento da outra conta', collide.length === 0,
    `${collide.length} colisão(ões)`);
} else {
  console.log('\n(planilhas .xlsx não informadas — comparação com a origem pulada)');
}

console.log(`\n${'─'.repeat(56)}`);
console.log(`${passed} conferências ok, ${failed} falha(s).`);
process.exit(failed === 0 ? 0 : 1);
