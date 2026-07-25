/**
 * Conferência do motor de auditoria financeira (src/utils/financialAudit.ts).
 *
 * Roda com: node scripts/testFinancialAudit.mjs
 *
 * Os números de referência são os OFICIAIS de 2026 (planilha RESULTADO
 * FINANCEIRO GERAL, abas 2026 e DRE), conferidos na mão. Se o motor mudar e
 * algum total sair diferente disso, o teste quebra — que é exatamente o ponto:
 * indicador financeiro que muda sem ninguém perceber vira decisão errada.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import Module from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Transpila o módulo TS em memória (sem depender de build) e o carrega.
const load = (relPath) => {
  const source = readFileSync(resolve(root, relPath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(relPath);
  m._compile(js, resolve(root, relPath));
  return m.exports;
};

const {
  buildOperatingRows,
  buildOperatingTotals,
  buildCalcMemory,
  buildAuditChecks,
  classifyDivergence,
  safeDiv,
  summarizeAudit,
} = load('src/utils/financialAudit.ts');

let passed = 0;
let failed = 0;

const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

const check = (label, condition, detail = '') => {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// ── Dados oficiais 2026 (Jan–Jun) ──────────────────────────────────────────
const financialMonths = {
  jan: { monthKey: 'jan', entradasBancos: 363360.65, entradasTesouraria: 52945.0, totalEntradas: 416305.65, totalSaidas: 486128.44, resultadoFinanceiro: -69822.79, estoque: 3096333.1, inadimplenciaMensal: 32723.19, inadimplenciaAcumulada: 247895.79 },
  fev: { monthKey: 'fev', entradasBancos: 343203.62, entradasTesouraria: 104959.5, totalEntradas: 448163.12, totalSaidas: 400303.22, resultadoFinanceiro: 47859.9, estoque: 3066970.66, inadimplenciaMensal: 49696.03, inadimplenciaAcumulada: 266259.03 },
  mar: { monthKey: 'mar', entradasBancos: 448402.09, entradasTesouraria: 82075.0, totalEntradas: 530477.09, totalSaidas: 470947.67, resultadoFinanceiro: 59529.42, estoque: 3085527.22, inadimplenciaMensal: 93237.01, inadimplenciaAcumulada: 274578.0 },
  abr: { monthKey: 'abr', entradasBancos: 618932.21, entradasTesouraria: 57553.0, totalEntradas: 676485.21, totalSaidas: 728214.36, resultadoFinanceiro: -51729.15, estoque: 3021020.62, inadimplenciaMensal: 120262.92, inadimplenciaAcumulada: 324385.87 },
  mai: { monthKey: 'mai', entradasBancos: 505053.52, entradasTesouraria: 81104.63, totalEntradas: 586158.15, totalSaidas: 625704.02, resultadoFinanceiro: -39545.87, estoque: 3396248.94, inadimplenciaMensal: 91534.79, inadimplenciaAcumulada: 372590.1 },
  jun: { monthKey: 'jun', entradasBancos: 440508.65, entradasTesouraria: 64469.0, totalEntradas: 504977.65, totalSaidas: 572018.05, resultadoFinanceiro: -67040.4, estoque: 3313253.68, inadimplenciaMensal: 98381.11, inadimplenciaAcumulada: 410206.24 },
  jul: { monthKey: 'jul', entradasBancos: 0, entradasTesouraria: 0, totalEntradas: 0, totalSaidas: 0, resultadoFinanceiro: 0, estoque: 0, inadimplenciaMensal: 0, inadimplenciaAcumulada: 0 },
};

const economicMonths = {
  jan: { monthKey: 'jan', receitaBruta: 478317.96, cmv: 348429.12, margemBruta: 129888.84, despesasFixas: 141766.31, resultadoEconomico: -11877.47 },
  fev: { monthKey: 'fev', receitaBruta: 407662.97, cmv: 296007.43, margemBruta: 111655.54, despesasFixas: 137509.75, resultadoEconomico: -25854.21 },
  mar: { monthKey: 'mar', receitaBruta: 623080.63, cmv: 454524.2, margemBruta: 168556.43, despesasFixas: 138546.16, resultadoEconomico: 30010.27 },
  abr: { monthKey: 'abr', receitaBruta: 655737.82, cmv: 480545.77, margemBruta: 175192.05, despesasFixas: 147458.19, resultadoEconomico: 27733.86 },
  mai: { monthKey: 'mai', receitaBruta: 716433.77, cmv: 538068.94, margemBruta: 178364.83, despesasFixas: 155857.07, resultadoEconomico: 22507.76 },
  jun: { monthKey: 'jun', receitaBruta: 605405.88, cmv: 457875.31, margemBruta: 147530.57, despesasFixas: 138502.33, resultadoEconomico: 9028.24 },
  jul: { monthKey: 'jul', receitaBruta: 0, cmv: 0, margemBruta: 0, despesasFixas: 0, resultadoEconomico: 0 },
};

console.log('\n── Ciclo operacional: linhas mensais ──');
const rows = buildOperatingRows({ economicMonths, financialMonths, year: 2026 });

check('só meses com movimento entram (Jan–Jun, sem Jul)', rows.length === 6, `veio ${rows.length}`);
check('meses na ordem correta', rows.map((r) => r.monthKey).join(',') === 'jan,fev,mar,abr,mai,jun');
check(
  'sem base de notas, faturado cai para a receita do DRE',
  rows.every((r) => r.faturadoSource === 'dre')
);
check('Jan: recebido = bancos + tesouraria', approx(rows[0].recebido, 363360.65 + 52945.0));
check('Jan: saldo do mês = recebido − pago', approx(rows[0].resultadoCaixa, 416305.65 - 486128.44));
check('Jan: saldo do mês bate com o oficial da planilha', approx(rows[0].resultadoCaixa, -69822.79));

console.log('\n── Totais do período ──');
const totals = buildOperatingTotals(rows, economicMonths, financialMonths);

// Somas conferidas na mão a partir da planilha
const RECEBIDO_OFICIAL = 3162566.87;
const PAGO_OFICIAL = 3283315.76;
const RESULTADO_OFICIAL = -120748.89;
const RECEITA_DRE_OFICIAL = 3486639.03;

check('total recebido = R$ 3.162.566,87', approx(totals.recebido, RECEBIDO_OFICIAL), `veio ${totals.recebido}`);
check('total pago = R$ 3.283.315,76', approx(totals.pago, PAGO_OFICIAL), `veio ${totals.pago}`);
check('resultado de caixa = R$ -120.748,89', approx(totals.resultadoCaixa, RESULTADO_OFICIAL), `veio ${totals.resultadoCaixa}`);
check('receita DRE = R$ 3.486.639,03', approx(totals.receitaDre, RECEITA_DRE_OFICIAL), `veio ${totals.receitaDre}`);
check(
  'inadimplência usa SALDO do último mês (410.206,24), nunca a soma',
  approx(totals.inadimplenciaAcumulada, 410206.24),
  `veio ${totals.inadimplenciaAcumulada}`
);
check(
  'estoque médio = média dos 6 meses',
  approx(totals.estoqueMedio, (3096333.1 + 3066970.66 + 3085527.22 + 3021020.62 + 3396248.94 + 3313253.68) / 6, 0.05),
  `veio ${totals.estoqueMedio}`
);
check('conversão = recebido ÷ faturado', approx(totals.conversao, (RECEBIDO_OFICIAL / RECEITA_DRE_OFICIAL) * 100, 0.05));
check('cobertura = recebido ÷ pago', approx(totals.cobertura, (RECEBIDO_OFICIAL / PAGO_OFICIAL) * 100, 0.05));
check('cobertura abaixo de 100% (período queimou caixa)', totals.cobertura < 100);

console.log('\n── Faturamento vindo das notas fiscais ──');
const billingSummaries = [
  { id: '2026_jan', year: 2026, monthKey: 'jan', grossRevenue: 478317.96 },
  { id: '2026_fev', year: 2026, monthKey: 'fev', grossRevenue: 407662.97 },
  { id: '2025_jan', year: 2025, monthKey: 'jan', grossRevenue: 999999.99 }, // outro ano: deve ser ignorado
];
const rowsNotas = buildOperatingRows({ economicMonths, financialMonths, billingSummaries, year: 2026 });
check('Jan passa a usar a nota fiscal como fonte', rowsNotas[0].faturadoSource === 'notas');
check('faturamento de outro ano é ignorado', approx(rowsNotas[0].faturado, 478317.96));
check('mês sem nota continua caindo para o DRE', rowsNotas[2].faturadoSource === 'dre');

console.log('\n── Contas a pagar e extrato por mês ──');
const payables = [
  { id: 'p1', year: 2026, monthKey: 'jan', amount: 200000, status: 'Baixado Automático' },
  { id: 'p2', year: 2026, monthKey: 'jan', amount: 100000, status: 'Em Aberto' },
  { id: 'p3', year: 2025, monthKey: 'jan', amount: 500000, status: 'Em Aberto' },
];
const statementEntries = [
  { id: 's1', year: 2026, monthKey: 'jan', entryAmount: 416305.65, exitAmount: 0 },
  { id: 's2', year: 2026, monthKey: 'jan', entryAmount: 0, exitAmount: 486128.44 },
  { id: 's3', year: 2025, monthKey: 'jan', entryAmount: 111111, exitAmount: 0 },
];
const rowsFull = buildOperatingRows({ economicMonths, financialMonths, payables, statementEntries, year: 2026 });
check('contas a pagar do ano somam no mês certo', approx(rowsFull[0].pagoErp, 300000));
check('contas a pagar de outro ano são ignoradas', approx(rowsFull[1].pagoErp, 0));
check('extrato: entradas do mês', approx(rowsFull[0].extratoEntradas, 416305.65));
check('extrato: saídas do mês', approx(rowsFull[0].extratoSaidas, 486128.44));

console.log('\n── Classificação de divergência ──');
check('0,5% → conforme', classifyDivergence(0.5, true) === 'ok');
check('3% → atenção', classifyDivergence(3, true) === 'atencao');
check('9% → crítico', classifyDivergence(9, true) === 'critico');
check('divergência negativa usa valor absoluto', classifyDivergence(-9, true) === 'critico');
check('sem base carregada → sem-dados (não acusa erro)', classifyDivergence(100, false) === 'sem-dados');

console.log('\n── Divisão protegida ──');
check('divisão por zero devolve 0, não Infinity', safeDiv(100, 0) === 0);
check('divisão normal funciona', safeDiv(10, 4) === 2.5);

console.log('\n── Conferências de auditoria ──');
const totalsFull = buildOperatingTotals(rowsFull, economicMonths, financialMonths);
const checks = buildAuditChecks({ totals: totalsFull, payables, year: 2026 });
const byId = Object.fromEntries(checks.map((c) => [c.id, c]));

check('gera as 7 conferências', checks.length === 7, `veio ${checks.length}`);
check(
  'extrato parcial (só Jan) acusa divergência contra o recebido do período',
  byId['recebido-x-extrato'].severity === 'critico'
);
check(
  'sem base de notas, a conferência Faturamento×DRE fica sem-dados',
  byId['faturamento-x-dre'].severity === 'sem-dados'
);
check(
  'títulos em aberto de outro ano não entram na conferência de baixas',
  approx(byId['baixas-pendentes'].baseValue, 100000)
);
check('conferência de baixas conta os títulos certos', byId['baixas-pendentes'].compareValue === 1);
// Número real de 2026: 410.206,24 ÷ 3.486.639,03 = 11,77% — dentro da faixa de
// atenção (≤12%), a um passo do crítico. Vale registrar: qualquer piora na
// carteira estoura a faixa, e o painel passa a marcar como crítico sozinho.
check(
  'inadimplência real de 2026 = 11,77% do faturamento',
  approx(byId['inadimplencia'].diffPct, 11.77, 0.01),
  `veio ${byId['inadimplencia'].diffPct}%`
);
check(
  'inadimplência de 11,77% cai na faixa de atenção (limite crítico = 12%)',
  byId['inadimplencia'].severity === 'atencao',
  `veio ${byId['inadimplencia'].severity}`
);
check(
  'toda conferência traz achado e recomendação preenchidos',
  checks.every((c) => c.finding.length > 0 && c.action.length > 0)
);

const semDados = buildAuditChecks({ totals, payables: [], year: 2026 });
const semDadosById = Object.fromEntries(semDados.map((c) => [c.id, c]));
check(
  'sem contas a pagar importado, a conferência não acusa erro',
  semDadosById['baixas-pendentes'].severity === 'sem-dados'
);
check(
  'sem extrato importado, a conciliação não acusa erro',
  semDadosById['recebido-x-extrato'].severity === 'sem-dados'
);

const resumo = summarizeAudit(checks);
check('resumo soma o total das conferências', resumo.ok + resumo.atencao + resumo.critico + resumo.semDados === resumo.total);

console.log('\n── Memória de cálculo ──');
const memory = buildCalcMemory(totals);
check('gera as 9 linhas de memória', memory.length === 9, `veio ${memory.length}`);
check(
  'toda linha tem fórmula, substituição, resultado e leitura',
  memory.every((m) => m.formula && m.substitution && m.result && m.reading)
);
const conv = memory.find((m) => m.id === 'conversao');
check('memória da conversão mostra os dois valores substituídos', conv.substitution.includes('3.162.566,87') && conv.substitution.includes('3.486.639,03'), conv.substitution);
const ger = memory.find((m) => m.id === 'geracao');
check('memória da geração de caixa aponta queima no período', ger.reading.includes('encolheu'));

console.log('\n── Robustez com bases vazias ──');
const vazio = buildOperatingRows({ economicMonths: {}, financialMonths: {}, year: 2026 });
check('sem nenhum dado, não quebra e devolve lista vazia', Array.isArray(vazio) && vazio.length === 0);
const totaisVazios = buildOperatingTotals(vazio, {}, {});
check('totais zerados não geram NaN', Object.values(totaisVazios).every((v) => typeof v !== 'number' || !isNaN(v)));
const memVazia = buildCalcMemory(totaisVazios);
check('memória de cálculo com zero não gera NaN/Infinity', memVazia.every((m) => !/NaN|Infinity/.test(m.result)));
const checksVazios = buildAuditChecks({ totals: totaisVazios, payables: [], year: 2026 });
check('auditoria com base vazia não acusa falso positivo', checksVazios.every((c) => c.severity === 'sem-dados'));

console.log(`\n${'─'.repeat(56)}`);
console.log(`${passed} conferências ok, ${failed} falha(s).`);
process.exit(failed === 0 ? 0 : 1);
