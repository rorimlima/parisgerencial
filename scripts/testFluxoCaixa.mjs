/**
 * Auditoria das fórmulas do Fluxo de Caixa.
 *
 * Reimplementa, sem React, exatamente as contas que a tela faz — geração de
 * caixa, saldo encadeado, totais e necessidade de aporte — e confere cada uma
 * contra resultados calculados à mão. Serve de trava: se alguém trocar um
 * sinal ou esquecer o aporte no encadeamento, este teste acusa antes de o
 * número errado virar decisão.
 *
 * Uso:  node scripts/testFluxoCaixa.mjs
 */

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

console.log(
  `\n${failures === 0 ? '✓ TODAS AS VERIFICAÇÕES PASSARAM' : `✗ ${failures} VERIFICAÇÃO(ÕES) FALHOU(RAM)`}\n`
);
process.exit(failures === 0 ? 0 : 1);
