/**
 * Teste do parser + motor de auditoria do RPR001 contra o arquivo real.
 *
 * Valida os números contra os totais conferidos independentemente em pandas.
 * Rodar: node testSalesParser.mjs <caminho-do-xlsx>
 */
import * as XLSX from 'xlsx';
import { parseSalesRows } from './src/utils/sheetParsers.ts';
import { auditSales, buildSellerSummaries, buildProductSummaries } from './src/utils/salesAudit.ts';

const file = process.argv[2];
if (!file) { console.error('uso: node testSalesParser.mjs <arquivo.xlsx>'); process.exit(1); }

const wb = XLSX.readFile(file, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
console.log('linhas cruas:', rows.length);

const p = parseSalesRows(rows);
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sum = (f) => p.items.reduce((a, i) => a + f(i), 0);

// ── Esperado (conferido em pandas sobre o mesmo arquivo) ────────────────────
const EXPECTED = {
  linhas: 16593,
  chaves: 16593,
  notas: 9949,
  clientes: 3657,
  produtos: 4257,
  receita: 34088262.18,
  desconto: 4255937.19,
  acrescimo: 8470.90,
  custo: 25559698.67,
  margemErp: 8032129.51,
  icms: 461753.46,
  pisCofins: 277787.54,
  // 377 linhas têm NFItem_VlBruto ≠ NFItem_VlUnit, mas 4 delas têm VlBruto
  // VAZIO — ausência de dado não é divergência de preço, e contá-la geraria um
  // alerta que o usuário não teria como resolver. O parser só marca as 373 em
  // que os dois valores existem e discordam.
  unitPriceMismatch: 373,
  // 1.130 linhas falham em `margem ≠ Total − Custo`. Mas a margem do ERP é
  // LÍQUIDA de ICMS e PIS/COFINS: descontando os impostos, 823 continuam sem
  // fechar. São essas 823 que representam problema real de dado; as outras 307
  // eram só a fórmula errada do lado de quem confere.
  marginMismatch: 823,
  totalMismatch: 0,
};

const got = {
  linhas: rows.length,
  chaves: p.items.length,
  notas: new Set(p.items.map((i) => `${i.companyCode}|${i.invoiceCode}`)).size,
  clientes: new Set(p.items.map((i) => i.customerCode)).size,
  produtos: new Set(p.items.map((i) => i.productCode)).size,
  receita: sum((i) => i.netAmount),
  desconto: sum((i) => i.discountAmount),
  acrescimo: sum((i) => i.surchargeAmount),
  custo: sum((i) => i.lineCost),
  margemErp: sum((i) => i.marginErp),
  icms: sum((i) => i.taxIcms),
  pisCofins: sum((i) => i.taxPisCofins),
  unitPriceMismatch: p.integrity.unitPriceMismatch,
  marginMismatch: p.integrity.marginMismatch,
  totalMismatch: p.integrity.totalMismatch,
};

let fail = 0;
console.log('\n─── CONFERÊNCIA CONTRA O PANDAS ───');
for (const [k, exp] of Object.entries(EXPECTED)) {
  const v = got[k];
  const ok = typeof exp === 'number' && !Number.isInteger(exp)
    ? Math.abs(v - exp) < 0.05
    : v === exp;
  if (!ok) fail++;
  const fmt = (n) => (Number.isInteger(exp) ? String(n) : brl(n));
  console.log(`${ok ? '  OK  ' : ' FALHA'} ${k.padEnd(20)} esperado ${fmt(exp).padStart(18)} | obtido ${fmt(v).padStart(18)}`);
}

console.log('\n─── INVARIANTES DO PARSER ───');
const inv = [
  ['chave única', new Set(p.items.map((i) => i.dedupeKey)).size === p.items.length],
  ['sem linha sem data', p.items.every((i) => i.issueDate && i.year > 0)],
  ['grossAmount = unit × qtde', p.items.every((i) => Math.abs(i.grossAmount - i.unitPrice * i.quantity) < 0.01)],
  ['netAmount = bruto − desc + acres', p.items.every((i) => Math.abs(i.netAmount - (i.grossAmount - i.discountAmount + i.surchargeAmount)) < 0.01)],
  ['margemCalc = líquido − custo − impostos', p.items.every((i) => Math.abs(i.marginCalculated - (i.netAmount - i.lineCost - i.taxTotal)) < 0.01)],
  ['unitCost = lineCost / qtde', p.items.every((i) => i.quantity <= 0 || Math.abs(i.unitCost - i.lineCost / i.quantity) < 0.01)],
  ['sem cabeçalho faltando', p.missingHeaders.length === 0],
];
inv.forEach(([label, ok]) => { if (!ok) fail++; console.log(`${ok ? '  OK  ' : ' FALHA'} ${label}`); });
if (p.extraHeaders.length) console.log('  info  colunas extras:', p.extraHeaders.join(', '));

console.log('\n─── AUDITORIA (sem estoque/clientes: só as regras próprias) ───');
const a = auditSales(p.items, [], []);
console.log('itens apontados        :', a.flagged.length, `(${((a.flagged.length / a.audited.length) * 100).toFixed(1)}%)`);
console.log('prejuízo direto        :', brl(a.risk.negativeMarginAmount), `em ${a.risk.negativeMarginLines} itens`);
console.log('desconto excedente     :', brl(a.risk.excessDiscountAmount), `em ${a.risk.excessDiscountLines} itens`);
console.log('margem faltante        :', brl(a.risk.marginGapAmount), `em ${a.risk.marginGapLines} itens`);
console.log('preço fora da curva    :', brl(a.risk.priceGapAmount), `em ${a.risk.priceGapLines} itens`);
console.log('partes relacionadas    :', brl(a.risk.relatedPartyRevenue), `em ${a.risk.relatedPartyInvoices} notas`);
console.log('total em risco         :', brl(a.risk.totalRiskAmount));
console.log('margem recalculada     :', brl(a.totals.marginCalculated), `(${a.totals.marginPercent.toFixed(2)}%)`);
console.log('divergência ERP × calc :', brl(a.totals.marginDivergence));

console.log('\n─── VENDEDORES ───');
buildSellerSummaries(a.audited).slice(0, 8).forEach((s) => {
  console.log(
    `${s.sellerName.padEnd(38)} #${String(s.sellerCode).padStart(3)} ` +
    `rec ${brl(s.netAmount).padStart(16)} desc ${s.discountPercent.toFixed(1).padStart(5)}% ` +
    `marg ${s.marginPercent.toFixed(1).padStart(5)}% desvio ${s.marginDeviation >= 0 ? '+' : ''}${s.marginDeviation.toFixed(1).padStart(5)}pp ` +
    `neg ${String(s.negativeLines).padStart(4)}`
  );
});

console.log('\n─── PRODUTOS COM MAIOR DISPERSÃO DE PREÇO (>=8 vendas) ───');
buildProductSummaries(a.audited, [])
  .filter((x) => x.lines >= 8)
  .sort((x, y) => y.priceSpread - x.priceSpread)
  .slice(0, 6)
  .forEach((x) => {
    console.log(
      `${x.productDescription.slice(0, 40).padEnd(42)} ${String(x.lines).padStart(4)} vendas  ` +
      `${brl(x.minUnitPrice).padStart(12)} → ${brl(x.maxUnitPrice).padStart(14)}  ${x.priceSpread.toFixed(1)}x`
    );
  });

console.log('\n─── EQUIPE DE VENDAS DETECTADA (para cadastro) ───');
const team = new Map();
p.items.forEach((i) => {
  const k = i.sellerCode || i.sellerName;
  const c = team.get(k) || { code: i.sellerCode, name: i.sellerName, lines: 0 };
  c.lines++;
  team.set(k, c);
});
[...team.values()].sort((x, y) => y.lines - x.lines).forEach((v) => {
  console.log(`  #${String(v.code).padStart(3)}  ${v.name.padEnd(40)} ${String(v.lines).padStart(5)} itens`);
});
const nameCodes = new Map();
team.forEach((v) => {
  const n = v.name.trim().toUpperCase();
  const set = nameCodes.get(n) || new Set();
  set.add(v.code);
  nameCodes.set(n, set);
});
[...nameCodes.entries()].filter(([, c]) => c.size > 1).forEach(([n, c]) => {
  console.log(`  ATENÇÃO duplicidade no ERP: "${n}" com códigos ${[...c].join(', ')}`);
});

console.log(fail === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${fail} VERIFICAÇÃO(ÕES) FALHARAM`);
process.exit(fail === 0 ? 0 : 1);
