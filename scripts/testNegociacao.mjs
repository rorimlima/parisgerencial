/**
 * Conferência do motor de negociação de dívida (src/utils/negotiation.ts).
 *
 * Roda com: node scripts/testNegociacao.mjs
 *
 * O caso central é o do centavo: R$ 1.000,00 em 3x não divide exato, e a regra
 * da casa é jogar TODO o resíduo na última parcela para que
 * `entrada + Σ parcelas === total acordado` sem sobra. Se alguém "simplificar"
 * o arredondamento, este teste quebra — e é para quebrar mesmo: resíduo de
 * centavo em acordo assinado vira saldo devedor fantasma meses depois.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import Module from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

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
  composeDebt,
  applyDiscount,
  buildSchedule,
  recomputeAgreement,
  addMonthsIso,
  validateAgreementDraft,
  money,
} = load('src/utils/negotiation.ts');

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  ✗ ${name}\n      esperado: ${JSON.stringify(expected)}\n      obtido:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
};

console.log('\n── Composição da dívida ─────────────────────────────────────────');
{
  // R$ 10.000 vencidos há 60 dias, multa 2%, juros 1% a.m.
  // multa  = 10.000 × 2%            = 200,00
  // juros  = 10.000 × (1/30)% × 60  = 200,00
  const comp = composeDebt([{ originalAmount: 10000, daysOverdue: 60 }], 2, 1);
  check('principal', comp.originalDebt, 10000);
  check('multa 2%', comp.penaltyAmount, 200);
  check('juros 1% a.m. por 60 dias', comp.interestAmount, 200);
  check('dívida atualizada', comp.updatedDebt, 10400);

  // Título sem atraso não gera juros, mas gera multa (multa é por vencer, não por dia).
  const semAtraso = composeDebt([{ originalAmount: 1000, daysOverdue: 0 }], 2, 1);
  check('sem atraso: juros zerados', semAtraso.interestAmount, 0);
  check('sem atraso: multa aplicada', semAtraso.penaltyAmount, 20);

  // Entrada suja não pode virar NaN e contaminar o acordo inteiro.
  const sujo = composeDebt([{ originalAmount: NaN, daysOverdue: -5 }], 2, 1);
  check('entrada inválida vira zero', sujo.updatedDebt, 0);
}

console.log('\n── Desconto ─────────────────────────────────────────────────────');
{
  const comp = composeDebt([{ originalAmount: 10000, daysOverdue: 60 }], 2, 1);

  // 100% sobre encargos abate 400 (juros+multa) e preserva o principal.
  const soEncargos = applyDiscount(comp, 100, 'encargos');
  check('100% s/ encargos abate só juros+multa', soEncargos.discountAmount, 400);
  check('100% s/ encargos preserva o principal', soEncargos.agreedTotal, 10000);

  // 50% sobre o total abate metade da dívida cheia.
  const total = applyDiscount(comp, 50, 'total');
  check('50% s/ total', total.discountAmount, 5200);
  check('50% s/ total — acordado', total.agreedTotal, 5200);

  // Percentual fora da faixa é grampeado, não explode.
  check('desconto negativo é grampeado em 0', applyDiscount(comp, -30, 'total').discountAmount, 0);
  check('desconto acima de 100 é grampeado', applyDiscount(comp, 500, 'total').agreedTotal, 0);
}

console.log('\n── Cronograma de parcelas ───────────────────────────────────────');
{
  // O caso da dízima: 1.000,00 em 3x → 333,33 + 333,33 + 333,34
  const s = buildSchedule(1000, 0, 3, '2026-08-10');
  check('3x de 1000 — parcela nominal', s.installmentAmount, 333.33);
  check('3x de 1000 — valores', s.installments.map((p) => p.expectedAmount), [333.33, 333.33, 333.34]);
  check('3x de 1000 — soma fecha exata', s.scheduleTotal, 1000);
  check('3x de 1000 — vencimentos mensais', s.installments.map((p) => p.dueDate), [
    '2026-08-10', '2026-09-10', '2026-10-10',
  ]);

  // Com entrada: 1.000 = 250 de entrada + 3x de 250
  const comEntrada = buildSchedule(1000, 250, 3, '2026-08-10');
  check('com entrada — soma fecha', comEntrada.scheduleTotal, 1000);
  check('com entrada — saldo financiado', comEntrada.financedAmount, 750);
  check('com entrada — parcela', comEntrada.installments.map((p) => p.expectedAmount), [250, 250, 250]);

  // Pagamento à vista: entrada cobre tudo, nenhuma parcela é gerada.
  const aVista = buildSchedule(1000, 1000, 0, '2026-08-10');
  check('à vista — sem parcelas', aVista.installments.length, 0);
  check('à vista — soma fecha', aVista.scheduleTotal, 1000);

  // Entrada maior que o total é grampeada (não gera parcela negativa).
  const excesso = buildSchedule(500, 900, 3, '2026-08-10');
  check('entrada acima do total é grampeada', excesso.scheduleTotal, 500);

  // Valor cabeludo em 7x — o teste que pega erro de arredondamento acumulado.
  const cabeludo = buildSchedule(10437.77, 1000, 7, '2026-08-31');
  const soma = money(1000 + cabeludo.installments.reduce((a, p) => a + p.expectedAmount, 0));
  check('10.437,77 em 7x com entrada — soma fecha', soma, 10437.77);
}

console.log('\n── Datas ────────────────────────────────────────────────────────');
{
  check('31/01 + 1 mês = 28/02 (não vaza para março)', addMonthsIso('2026-01-31', 1), '2026-02-28');
  check('31/12 + 1 mês = 31/01 do ano seguinte', addMonthsIso('2026-12-31', 1), '2027-01-31');
  check('30/04 + 2 meses', addMonthsIso('2026-04-30', 2), '2026-06-30');
}

console.log('\n── Status derivado do acordo ────────────────────────────────────');
{
  const base = {
    agreedTotal: 900, downPayment: 0, status: 'Ativo',
    installments: [
      { number: 1, dueDate: '2026-01-10', expectedAmount: 300, paidAmount: 300, status: 'Pendente' },
      { number: 2, dueDate: '2026-02-10', expectedAmount: 300, paidAmount: 300, status: 'Pendente' },
      { number: 3, dueDate: '2026-03-10', expectedAmount: 300, paidAmount: 300, status: 'Pendente' },
    ],
  };
  const hoje = new Date('2026-04-01T12:00:00Z');

  check('todas pagas → Cumprido', recomputeAgreement(base, hoje).status, 'Cumprido');
  check('todas pagas → saldo zero', recomputeAgreement(base, hoje).totalOutstanding, 0);

  // Uma parcela vencida e não paga quebra o acordo — sem tolerância.
  const quebrado = { ...base, installments: base.installments.map((p, i) => (i === 1 ? { ...p, paidAmount: 0 } : p)) };
  check('parcela vencida sem pagamento → Quebrado', recomputeAgreement(quebrado, hoje).status, 'Quebrado');
  check('quebrado → saldo remanescente', recomputeAgreement(quebrado, hoje).totalOutstanding, 300);

  // Pagamento a menor não pode "fechar" a parcela.
  const parcial = { ...base, installments: base.installments.map((p, i) => (i === 2 ? { ...p, paidAmount: 100 } : p)) };
  const r = recomputeAgreement(parcial, hoje);
  check('pagamento a menor não quita', r.installments[2].status, 'Atrasada');
  check('pagamento a menor → saldo de 200', r.totalOutstanding, 200);

  // Parcela futura sem pagamento é Pendente, e o acordo segue Ativo.
  const futuro = {
    agreedTotal: 600, downPayment: 300, status: 'Ativo',
    installments: [{ number: 1, dueDate: '2026-12-10', expectedAmount: 300, paidAmount: 0, status: 'Pendente' }],
  };
  const rf = recomputeAgreement(futuro, hoje);
  check('parcela futura → Ativo', rf.status, 'Ativo');
  check('entrada entra no total pago', rf.totalPaid, 300);

  // Cancelado é decisão humana e o cálculo não sobrescreve.
  check('cancelado permanece cancelado', recomputeAgreement({ ...base, status: 'Cancelado' }, hoje).status, 'Cancelado');
}

console.log('\n── Validação do rascunho ────────────────────────────────────────');
{
  const ok = validateAgreementDraft({
    titleIds: ['t1'], agreedTotal: 1000, updatedDebt: 1200, downPayment: 250,
    installmentCount: 3, firstDueDate: '2026-08-10', discountPercent: 10, scheduleTotal: 1000,
  });
  check('rascunho válido não acusa nada', ok, []);

  const semTitulo = validateAgreementDraft({
    titleIds: [], agreedTotal: 1000, updatedDebt: 1200, downPayment: 0,
    installmentCount: 1, firstDueDate: '2026-08-10', discountPercent: 0, scheduleTotal: 1000,
  });
  check('sem título é impedido', semTitulo.length > 0, true);

  const naoFecha = validateAgreementDraft({
    titleIds: ['t1'], agreedTotal: 1000, updatedDebt: 1200, downPayment: 0,
    installmentCount: 3, firstDueDate: '2026-08-10', discountPercent: 0, scheduleTotal: 999.99,
  });
  check('cronograma que não fecha é impedido', naoFecha.length > 0, true);

  const saldoSemParcela = validateAgreementDraft({
    titleIds: ['t1'], agreedTotal: 1000, updatedDebt: 1200, downPayment: 200,
    installmentCount: 0, firstDueDate: '', discountPercent: 0, scheduleTotal: 200,
  });
  check('saldo sem parcela é impedido', saldoSemParcela.length > 0, true);
}

console.log(
  failures === 0
    ? '\n✅ Motor de negociação: todos os cenários conferem.\n'
    : `\n❌ ${failures} cenário(s) divergente(s).\n`
);
process.exit(failures === 0 ? 0 : 1);
