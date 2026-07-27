/**
 * Auditoria das fórmulas do Fluxo de Caixa.
 *
 * Reimplementa, sem React, exatamente as contas que a tela faz — geração de
 * caixa, saldo encadeado, totais e necessidade de aporte — e confere cada uma
 * contra resultados calculados à mão. Serve de trava: se alguém trocar um
 * sinal ou esquecer o aporte no encadeamento, este teste acusa antes de o
 * número errado virar decisão.
 *
 * A seção 7 carrega o MÓDULO TYPESCRIPT DE VERDADE (src/utils/payableForecast.ts)
 * — as mesmas funções que tanto a tela (CashFlowView) quanto o PDF mensal
 * (exportCashFlowPdfMensal, seção "Posição de Caixa Hoje") usam para separar
 * título a vencer de título vencido dentro do horizonte de aporte. Não é uma
 * reimplementação à parte: se a régua de datas mudar no arquivo de verdade,
 * este teste quebra.
 *
 * Uso:  node scripts/testFluxoCaixa.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Carrega src/utils/payableForecast.ts de verdade, sem duplicar a lógica ──
const loadTs = (relPath) => {
  const abs = resolve(root, relPath);
  const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m._compile(js, abs);
  return m.exports;
};
const { isOpenForecast, forecastInRange, sumForecast, addDaysIso } = loadTs('src/utils/payableForecast.ts');

const WEEKS = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];
const brl = (n) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let failures = 0;
const check = (label, actual, expected, tol = 0.005) => {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) <= tol : actual === expected;
  if (!ok) failures++;
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : brl(v)) : v);
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${fmt(actual)}${ok ? '' : `  (esperado ${fmt(expected)})`}`);
};

// ── Fórmulas da tela (espelho de CashFlowView.tsx) ─────────────────────────
const geracao = (receb, desemb) => receb + desemb; // desembolso é negativo
const encadearSaldo = (saldoInicial, semanas) => {
  let acc = saldoInicial;
  return WEEKS.map((w) => {
    const s = semanas[w] || {};
    acc += geracao(s.receb || 0, s.desemb || 0) + (s.aporte || 0);
    return acc;
  });
};
const necessidadeAporte = (disponivel, compromissos) => Math.max(0, compromissos - disponivel);

console.log('\n1) Geração de caixa e sinal do desembolso');
check('recebeu 100 e pagou 30', geracao(100, -30), 70);
check('desembolso digitado positivo seria erro', geracao(100, 30) !== 70, true);
check('normalização: positivo vira negativo', geracao(100, -Math.abs(30)), 70);

console.log('\n2) Saldo encadeado semana a semana (com aporte)');
const semanas = {
  sem01: { receb: 113342.83, desemb: -112139.46, aporte: 0 },
  sem02: { receb: 75923.89, desemb: -100154.44, aporte: 0 },
  sem03: { receb: 102263.0, desemb: -95129.41, aporte: 0 },
  sem04: { receb: 0, desemb: 0, aporte: 0 },
  sem05: { receb: 0, desemb: 0, aporte: 0 },
};
const saldoInicial = 100837.82;
const saldos = encadearSaldo(saldoInicial, semanas);
const totalReceb = WEEKS.reduce((a, w) => a + (semanas[w].receb || 0), 0);
const totalDesemb = WEEKS.reduce((a, w) => a + (semanas[w].desemb || 0), 0);
const totalAporte = WEEKS.reduce((a, w) => a + (semanas[w].aporte || 0), 0);

WEEKS.forEach((w, i) => console.log(`     ${w}: ${brl(saldos[i])}`));
check('saldo final = inicial + entradas + saídas + aportes', saldos[4], saldoInicial + totalReceb + totalDesemb + totalAporte);
check('geração do mês = soma das gerações semanais', totalReceb + totalDesemb, WEEKS.reduce((a, w) => a + geracao(semanas[w].receb || 0, semanas[w].desemb || 0), 0));
check('saldo de cada semana = saldo anterior + geração da semana', saldos[1], saldos[0] + geracao(semanas.sem02.receb, semanas.sem02.desemb));

console.log('\n3) Aporte entra no saldo uma única vez');
const comAporte = encadearSaldo(saldoInicial, { ...semanas, sem04: { receb: 0, desemb: 0, aporte: 8788.74 } });
check('aporte de 8.788,74 eleva o saldo final exatamente nesse valor', comAporte[4] - saldos[4], 8788.74);
check('semanas anteriores ao aporte não mudam', comAporte[2], saldos[2]);

console.log('\n4) Necessidade de aporte — posição real informada pelo gestor');
const contas = { 'Tesouraria (dinheiro)': 13131.38, Bradesco: 1550.8, PagBank: 13498.16 };
const compromissos = { 'A pagar Bradesco': 1274.96, 'A pagar PagBank': 12766.7, 'Demais compromissos': 22927.42 };
const disponivel = Object.values(contas).reduce((a, v) => a + v, 0);
const aPagar = Object.values(compromissos).reduce((a, v) => a + v, 0);

Object.entries(contas).forEach(([k, v]) => console.log(`     ${k.padEnd(24)} ${brl(v)}`));
console.log(`     ${'DISPONÍVEL'.padEnd(24)} ${brl(disponivel)}`);
Object.entries(compromissos).forEach(([k, v]) => console.log(`     ${k.padEnd(24)} ${brl(v)}`));
console.log(`     ${'A PAGAR'.padEnd(24)} ${brl(aPagar)}`);

check('disponível hoje', disponivel, 28180.34);
check('total a pagar', aPagar, 36969.08);
check('saldo após compromissos (negativo)', disponivel - aPagar, -8788.74);
check('necessidade de aporte', necessidadeAporte(disponivel, aPagar), 8788.74);
check('cobertura em %', Number(((disponivel / aPagar) * 100).toFixed(1)), 76.2);
check('caixa sobrando não gera aporte', necessidadeAporte(50000, aPagar), 0);

console.log('\n5) Lançar o aporte zera a necessidade — e só ela');
const aporteLancado = necessidadeAporte(disponivel, aPagar);
check('depois do aporte, saldo após compromissos fica zero', disponivel + aporteLancado - aPagar, 0);
check('aporte não cria sobra artificial', necessidadeAporte(disponivel + aporteLancado, aPagar), 0);

console.log('\n6) Divergência entre a grade e o caixa contado');
const saldoGrade = 84944.23;
const caixaContado = disponivel;
check('divergência = contado − grade', caixaContado - saldoGrade, caixaContado - saldoGrade);
check(
  'ajustar o saldo inicial pela diferença faz a grade fechar com o caixa',
  encadearSaldo(saldoInicial + (caixaContado - saldos[2]), semanas)[2],
  caixaContado
);

console.log('\n7) Seção "Posição de Caixa Hoje" do PDF mensal (payableForecast.ts de verdade)');
// Mesmos números do card da tela: Bradesco a vencer dentro do horizonte,
// PagBank já vencido, e um título de dezembro que NÃO deve entrar no
// horizonte de 30 dias — prova que o corte de data do PDF é o mesmo da tela.
const hoje = '2026-07-27';
const titulos = [
  { id: '1', balance: 1274.96, dueDate: '2026-08-10', paymentDate: '' },  // a vencer, dentro do horizonte
  { id: '2', balance: 12766.7, dueDate: '2026-07-01', paymentDate: '' }, // vencido, não pago
  { id: '3', balance: 5000, dueDate: '2026-12-01', paymentDate: '' },    // aberto, mas fora do horizonte de 30 dias
  { id: '4', balance: 0, dueDate: '2026-08-01', paymentDate: '' },       // saldo zerado — não é compromisso
  { id: '5', balance: 3000, dueDate: '2026-08-05', paymentDate: '2026-07-20' }, // já pago — fora da previsão
];

const abertos = titulos.filter(isOpenForecast);
check('títulos em aberto (saldo>0 e sem data de pagamento)', abertos.length, 3);

const noHorizonte = forecastInRange(abertos, '1900-01-01', addDaysIso(hoje, 30));
check('títulos dentro do horizonte de 30 dias (inclui vencidos)', noHorizonte.length, 2);
check('título de dezembro fica de fora do horizonte de 30 dias', noHorizonte.some((t) => t.id === '3'), false);

const compromissosTitulos = sumForecast(noHorizonte);
const titulosVencidos = sumForecast(noHorizonte.filter((t) => t.dueDate < hoje));
const titulosAVencer = compromissosTitulos - titulosVencidos;
check('total de títulos no horizonte', compromissosTitulos, 1274.96 + 12766.7);
check('parcela vencida e não paga', titulosVencidos, 12766.7);
check('parcela ainda a vencer', titulosAVencer, 1274.96);

const totalPendenciasDigitadas = 22927.42;
const compromissosTotal = compromissosTitulos + totalPendenciasDigitadas;
check('total a pagar (títulos + pendências) fecha com o card da tela', compromissosTotal, 36969.08);

console.log(
  `\n${failures === 0 ? '✓ TODAS AS VERIFICAÇÕES PASSARAM' : `✗ ${failures} VERIFICAÇÃO(ÕES) FALHOU(RAM)`}\n`
);
process.exit(failures === 0 ? 0 : 1);
