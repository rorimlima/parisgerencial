/**
 * Conferência da CONTA DE ORIGEM dos títulos e das somas por conta.
 *
 * Roda com: node scripts/testContasOrigem.mjs [caminho-do-extrato.xlsx]
 * Padrão: scripts/data/extratogeral.xlsx (usado para montar lançamentos reais)
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. PRECEDÊNCIA. A escolha do gestor tem que vencer a conta inferida pela
 *    baixa. Se a baixa sobrescrevesse, a correção do gestor duraria até a
 *    próxima conciliação e ele teria que refazê-la para sempre — o tipo de bug
 *    que faz o usuário desistir do campo e voltar para a planilha paralela.
 * 2. AS TRÊS SOMAS FECHAM NO MESMO TOTAL. Por conta, por forma de pagamento e
 *    por classificação de despesa somam exatamente o total pago. Uma soma que
 *    omite o que não sabe classificar mostra um número menor que o real sem dar
 *    nenhum sinal — e desse painel saem decisões.
 * 3. FORMA DERIVADA DA CONTA. Caixa é sempre Dinheiro, conta corrente é sempre
 *    Banco. Se isso se soltar, o total por forma para de bater com o por conta.
 * 4. REGISTRO ÚNICO. O parser do Extrato Geral e o seletor de origem leem a
 *    MESMA lista de contas. Quando eram duas listas, cadastrar um caixa em uma
 *    e não na outra fazia o dinheiro entrar no extrato e sumir das somas.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

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
    if (spec.startsWith('.')) return loadTs(resolve(dirname(abs), spec).replace(root + '/', '') + '.ts');
    return Module.createRequire(abs)(spec);
  };
  cache.set(relPath, m.exports);
  m._compile(js, abs);
  cache.set(relPath, m.exports);
  return m.exports;
};

const {
  PAYMENT_ACCOUNTS,
  PAYMENT_ACCOUNT_BY_CODE,
  buildStatementIndex,
  findAccountByBankText,
  findAccountByStatementEntry,
  resolveTituloOrigin,
  summarizeByOrigin,
  tituloExpenseClass,
  tituloPaidAmount,
} = loadTs('src/utils/paymentAccounts.ts');
const { parseExtratoGeralRows, toStatementEntry, resolveAccount } = loadTs('src/utils/extratoGeralParser.ts');
const { statementDocId } = loadTs('src/utils/statementKeys.ts');
const { normalizePersonCode } = loadTs('src/utils/linking.ts');

let passed = 0;
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

console.log('\n═══ CONTA DE ORIGEM E SOMAS POR CONTA ═══\n');

// ─── 1. O registro de contas ────────────────────────────────────────────────

console.log('1) Registro de contas e caixas');
check('todas as contas têm code, label e forma', PAYMENT_ACCOUNTS.every((a) => a.code && a.label && a.paymentForm));
check(
  'code é único',
  new Set(PAYMENT_ACCOUNTS.map((a) => a.code)).size === PAYMENT_ACCOUNTS.length
);
check(
  'FORMA DERIVA DA CONTA: caixa=Dinheiro, banco=Banco',
  PAYMENT_ACCOUNTS.every((a) =>
    a.origin === 'caixa' ? a.paymentForm === 'Dinheiro' : a.paymentForm === 'Banco'
  ),
  'se soltar, o total por forma para de bater com o por conta'
);
check(
  'toda conta de caixa tem código contábil 301.xx',
  PAYMENT_ACCOUNTS.filter((a) => a.origin === 'caixa').every((a) => /^301\d{2}$/.test(a.accountCode))
);
check(
  'Alba e Caixa 30110 são a MESMA conta contábil, com rótulos distintos',
  PAYMENT_ACCOUNT_BY_CODE.alba30110.accountCode === '30110' &&
    PAYMENT_ACCOUNT_BY_CODE.caixa30110.accountCode === '30110' &&
    PAYMENT_ACCOUNT_BY_CODE.alba30110.label !== PAYMENT_ACCOUNT_BY_CODE.caixa30110.label
);

console.log('\n2) Reconhecimento pelo texto da coluna BANCO');
for (const [texto, esperado] of [
  ['BRADESCO', 'bradesco'],
  ['PagBank', 'pagbank'],
  ['PAGSEGURO', 'pagbank'],
  ['CAIXA30107', 'caixa30107'],
  ['caixa 301.07', 'caixa30107'],
  ['ALBA30110', 'alba30110'],
  ['TESOURARIA', 'tesouraria30101'],
]) {
  const a = findAccountByBankText(texto);
  check(`'${texto}' → ${esperado}`, a?.code === esperado, a ? `veio ${a.code}` : 'não resolveu');
}
check('texto desconhecido não recebe palpite', findAccountByBankText('BANCO XPTO') === null);
check('vazio não resolve', findAccountByBankText('') === null && findAccountByBankText(null) === null);
check(
  'conta 301.xx nova é reconhecida como caixa/dinheiro',
  (() => {
    const a = findAccountByBankText('CAIXA 301.55');
    return a && a.accountCode === '30155' && a.paymentForm === 'Dinheiro';
  })()
);

// REGISTRO ÚNICO: o parser do extrato e o seletor têm que concordar conta a conta.
console.log('\n3) Registro único — parser do Extrato Geral x seletor de origem');
for (const a of PAYMENT_ACCOUNTS) {
  const doParser = resolveAccount(a.label, a.origin === 'caixa' ? 'DINHEIRO' : 'BANCO');
  check(
    `${a.label.padEnd(18)} parser e registro concordam`,
    !!doParser && doParser.origin === a.origin && doParser.accountCode === a.accountCode,
    doParser ? `parser: ${doParser.origin}/${doParser.accountCode || '-'}` : 'parser não resolveu'
  );
}

// ─── 2. Precedência da origem ───────────────────────────────────────────────

console.log('\n4) De onde vem a conta do título (precedência)');

const lancamento = {
  id: 'ext_1',
  origin: 'banco',
  source: 'bradesco',
  sourceLabel: 'Bradesco',
  accountCode: '',
  accountLabel: '',
  date: '2026-03-10',
  year: 2026,
  monthKey: 'mar',
  description: 'PAGTO ELETRON COBRANCA',
  entryAmount: 0,
  exitAmount: 1000,
  dedupeKey: 'k1',
};
const lancamentoCaixa = {
  ...lancamento,
  id: 'ext_2',
  origin: 'caixa',
  source: 'tesouraria',
  sourceLabel: 'Caixa 30107',
  accountCode: '30107',
  accountLabel: 'Caixa 30107',
};
const idx = buildStatementIndex([lancamento, lancamentoCaixa]);

const baseTitulo = {
  id: 't1',
  movType: 'P',
  titleCode: 'T1',
  personCode: '100',
  personName: 'FORNECEDOR X',
  amount: 1000,
  balance: 0,
  isPaid: true,
  status: 'Baixado Automático',
  paymentDate: '2026-03-10',
  dueDate: '2026-03-10',
};

const semNada = resolveTituloOrigin({ ...baseTitulo, status: 'Em Aberto', reconciledStatementId: '' }, idx);
check(
  'título pago sem baixa e sem escolha fica SEM origem',
  semNada.source === 'nenhuma' && semNada.accountKey === '',
  'não pode ser diluído numa conta qualquer'
);

const pelaBaixa = resolveTituloOrigin({ ...baseTitulo, reconciledStatementId: 'ext_1' }, idx);
check('baixado no extrato → conta vem do lançamento', pelaBaixa.accountKey === 'bradesco' && pelaBaixa.source === 'baixa');
check('forma de pagamento acompanha a conta', pelaBaixa.paymentForm === 'Banco');

const pelaBaixaCaixa = resolveTituloOrigin({ ...baseTitulo, reconciledStatementId: 'ext_2' }, idx);
check(
  'baixado contra caixa → Dinheiro, com o código da conta',
  pelaBaixaCaixa.accountKey === 'caixa30107' &&
    pelaBaixaCaixa.paymentForm === 'Dinheiro' &&
    pelaBaixaCaixa.accountCode === '30107'
);

const escolhaDoGestor = resolveTituloOrigin(
  { ...baseTitulo, reconciledStatementId: 'ext_1', originAccountKey: 'caixa30107' },
  idx
);
check(
  'A ESCOLHA DO GESTOR VENCE A BAIXA',
  escolhaDoGestor.accountKey === 'caixa30107' && escolhaDoGestor.source === 'gestor',
  'se a baixa vencesse, a correção do gestor seria desfeita na próxima conciliação'
);
check('e a forma muda junto', escolhaDoGestor.paymentForm === 'Dinheiro');

const limpou = resolveTituloOrigin(
  { ...baseTitulo, reconciledStatementId: 'ext_1', originAccountKey: '' },
  idx
);
check(
  'limpar a escolha devolve o título à conta da baixa',
  limpou.accountKey === 'bradesco' && limpou.source === 'baixa',
  'sem caminho de volta, uma conta clicada por engano fica presa para sempre'
);

// Extrato trocado: o lançamento não existe mais, mas o rótulo gravado na baixa
// ainda diz de qual conta era. É o que mantém o histórico legível depois de uma
// substituição de extrato.
const orfao = resolveTituloOrigin(
  { ...baseTitulo, reconciledStatementId: 'ext_apagado', reconciledSource: 'Caixa 30107' },
  idx
);
check(
  'lançamento apagado: a conta sobrevive pelo rótulo da baixa',
  orfao.accountKey === 'caixa30107' && orfao.source === 'baixa'
);

const semIndice = resolveTituloOrigin({ ...baseTitulo, originAccountKey: 'pagbank' });
check('resolve sem índice de extrato quando a escolha é do gestor', semIndice.accountKey === 'pagbank');

// ─── 3. As somas ────────────────────────────────────────────────────────────

console.log('\n5) As três somas fecham no mesmo total');

const clientes = [
  { id: 'c1', code: '100', name: 'FORNECEDOR FIXO', expenseClassification: 'Despesa Fixa' },
  { id: 'c2', code: '200', name: 'FORNECEDOR VAR', expenseClassification: 'Despesa Variável' },
  { id: 'c3', code: '300', name: 'FORNECEDOR SEM CLASSE', expenseClassification: 'Nenhuma' },
];
const customerByCode = new Map(clientes.map((c) => [normalizePersonCode(c.code), c]));

const titulos = [
  // pagos, baixados no Bradesco
  { ...baseTitulo, id: 'a', personCode: '100', amount: 1000, reconciledStatementId: 'ext_1' },
  { ...baseTitulo, id: 'b', personCode: '200', amount: 250.55, reconciledStatementId: 'ext_1' },
  // pago, baixado no caixa
  { ...baseTitulo, id: 'c', personCode: '100', amount: 400, reconciledStatementId: 'ext_2' },
  // pago, conta apontada na mão (contra a baixa)
  { ...baseTitulo, id: 'd', personCode: '300', amount: 90.1, reconciledStatementId: 'ext_1', originAccountKey: 'caixa30110' },
  // pago sem baixa e sem escolha → sem origem
  { ...baseTitulo, id: 'e', personCode: '300', amount: 33.33, status: 'Baixado Manual', reconciledStatementId: '' },
  // EM ABERTO: não pode entrar em soma nenhuma
  { ...baseTitulo, id: 'f', personCode: '100', amount: 99999, isPaid: false, status: 'Em Aberto', reconciledStatementId: '' },
];

const s = summarizeByOrigin(titulos, idx, customerByCode, normalizePersonCode);
const totalPagoEsperado = 1000 + 250.55 + 400 + 90.1 + 33.33;

check(`só os pagos entram: ${s.paidCount} de ${titulos.length} títulos`, s.paidCount === 5);
check(
  `total pago = ${money(s.paidAmount)}`,
  approx(s.paidAmount, totalPagoEsperado),
  `esperado ${money(totalPagoEsperado)}`
);
check(
  'título EM ABERTO não entra em nenhuma soma',
  !s.byAccount.some((a) => a.amount >= 99999) && s.paidAmount < 99999,
  'compromisso não pago não tem "conta de onde saiu"'
);

const somaContas = s.byAccount.reduce((a, x) => a + x.amount, 0);
const somaFormas = s.byForm.reduce((a, x) => a + x.amount, 0);
const somaDespesas = s.byExpense.reduce((a, x) => a + x.amount, 0);
check(`soma por CONTA fecha: ${money(somaContas)}`, approx(somaContas, s.paidAmount));
check(`soma por FORMA fecha: ${money(somaFormas)}`, approx(somaFormas, s.paidAmount));
check(`soma por DESPESA fecha: ${money(somaDespesas)}`, approx(somaDespesas, s.paidAmount));
check(
  'contagens também fecham',
  s.byAccount.reduce((a, x) => a + x.count, 0) === s.paidCount &&
    s.byForm.reduce((a, x) => a + x.count, 0) === s.paidCount &&
    s.byExpense.reduce((a, x) => a + x.count, 0) === s.paidCount
);

const bradesco = s.byAccount.find((a) => a.accountKey === 'bradesco');
check(
  `Bradesco: 2 títulos, ${money(1250.55)}`,
  bradesco && bradesco.count === 2 && approx(bradesco.amount, 1250.55),
  bradesco ? `veio ${bradesco.count} / ${money(bradesco.amount)}` : 'conta ausente'
);
const c30110 = s.byAccount.find((a) => a.accountKey === 'caixa30110');
check(
  'a escolha do gestor move o valor para a conta escolhida, não para a da baixa',
  c30110 && approx(c30110.amount, 90.1)
);
check(
  'quantos vieram da baixa sem confirmação humana é reportado',
  s.inferredFromBaixa.count === 3 && approx(s.inferredFromBaixa.amount, 1650.55),
  `veio ${s.inferredFromBaixa.count} / ${money(s.inferredFromBaixa.amount)}`
);

const semOrigem = s.byAccount.find((a) => !a.accountKey);
check(
  'pago sem conta identificada aparece como linha própria, não some',
  semOrigem && semOrigem.count === 1 && approx(semOrigem.amount, 33.33)
);
check('e é reportado à parte para o gestor resolver', s.withoutOrigin.count === 1 && approx(s.withoutOrigin.amount, 33.33));

const banco = s.byForm.find((f) => f.form === 'Banco');
const dinheiro = s.byForm.find((f) => f.form === 'Dinheiro');
check(`Banco: ${money(1250.55)}`, banco && approx(banco.amount, 1250.55));
check(`Dinheiro: ${money(490.1)}`, dinheiro && approx(dinheiro.amount, 490.1), 'caixa 30107 + caixa 30110');

console.log('\n6) Despesa fixa x variável (vem do cadastro, pelo código da pessoa)');
check('fornecedor classificado como fixo', tituloExpenseClass({ personCode: '100' }, customerByCode, normalizePersonCode) === 'Despesa Fixa');
check('fornecedor classificado como variável', tituloExpenseClass({ personCode: '200' }, customerByCode, normalizePersonCode) === 'Despesa Variável');
check("cadastro com 'Nenhuma' cai em Não classificado", tituloExpenseClass({ personCode: '300' }, customerByCode, normalizePersonCode) === 'Não classificado');
check('pessoa fora do cadastro cai em Não classificado', tituloExpenseClass({ personCode: '999' }, customerByCode, normalizePersonCode) === 'Não classificado');
const fixa = s.byExpense.find((e) => e.classification === 'Despesa Fixa');
const varia = s.byExpense.find((e) => e.classification === 'Despesa Variável');
check(`Despesa Fixa: ${money(1400)}`, fixa && approx(fixa.amount, 1400), 'títulos a (1000) + c (400)');
check(`Despesa Variável: ${money(250.55)}`, varia && approx(varia.amount, 250.55));

console.log('\n7) Valor que se moveu');
check('título pago usa o valor', tituloPaidAmount({ amount: 500, balance: 0 }) === 500);
check('pago parcial cai para o saldo quando o valor vem zerado', tituloPaidAmount({ amount: 0, balance: 120 }) === 120);
check('sem valor nenhum é zero, não NaN', tituloPaidAmount({}) === 0);

// ─── 4. Contra o extrato real ───────────────────────────────────────────────

const sheetPath = process.argv[2] || resolve(root, 'scripts/data/extratogeral.xlsx');
if (!existsSync(sheetPath)) {
  console.log(`\n(planilha não encontrada em ${sheetPath} — teste com extrato real pulado)`);
} else {
  console.log('\n8) Contra o extrato real');
  const wb = XLSX.read(readFileSync(sheetPath), { type: 'buffer', cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const rows = parseExtratoGeralRows(raw).filter((r) => r.valid);
  const entradas = rows.map((r) => ({ ...toStatementEntry(r), id: statementDocId(r.dedupeKey) }));

  const semConta = entradas.filter((e) => !findAccountByStatementEntry(e));
  check(
    'TODO lançamento do extrato resolve para uma conta cadastrada',
    semConta.length === 0,
    `${semConta.length} sem conta — ex.: ${semConta[0]?.sourceLabel || '?'}`
  );

  const formaErrada = entradas.filter((e) => {
    const a = findAccountByStatementEntry(e);
    return a && ((e.origin === 'caixa') !== (a.paymentForm === 'Dinheiro'));
  });
  check('origem do lançamento e forma da conta nunca se contradizem', formaErrada.length === 0, `${formaErrada.length} divergência(s)`);

  // Títulos sintéticos baixados contra o extrato real: a soma por conta tem que
  // reproduzir a soma do próprio extrato, conta por conta.
  const amostra = entradas.filter((e) => e.exitAmount > 0).slice(0, 400);
  const titulosReais = amostra.map((e, i) => ({
    ...baseTitulo,
    id: `r${i}`,
    personCode: String(100 + (i % 3) * 100),
    amount: e.exitAmount,
    reconciledStatementId: e.id,
  }));
  const idxReal = buildStatementIndex(entradas);
  const sr = summarizeByOrigin(titulosReais, idxReal, customerByCode, normalizePersonCode);

  const esperadoPorConta = new Map();
  for (const e of amostra) {
    const a = findAccountByStatementEntry(e);
    const k = a?.code || '';
    esperadoPorConta.set(k, (esperadoPorConta.get(k) || 0) + e.exitAmount);
  }
  let contasOk = true;
  for (const a of sr.byAccount) {
    const esperado = esperadoPorConta.get(a.accountKey) || 0;
    if (!approx(a.amount, esperado)) contasOk = false;
  }
  check(
    `${sr.byAccount.length} conta(s) somam igual ao extrato de origem`,
    contasOk && sr.byAccount.length === esperadoPorConta.size
  );
  check(
    `total ${money(sr.paidAmount)} = soma das saídas da amostra`,
    approx(sr.paidAmount, amostra.reduce((a, e) => a + e.exitAmount, 0))
  );
  check('nenhum título baixado ficou sem conta', sr.withoutOrigin.count === 0);

  console.log('\n── PAGAMENTOS POR CONTA (amostra do extrato real) ──────────');
  for (const a of sr.byAccount) {
    console.log(
      `  ${a.label.padEnd(20)} ${String(a.count).padStart(4)} título(s)  ${money(a.amount).padStart(18)}  ${a.paymentForm}`
    );
  }
  console.log('  ─────────────────────────────────────────────────────────');
  for (const f of sr.byForm) {
    console.log(`  ${f.form.padEnd(20)} ${String(f.count).padStart(4)} título(s)  ${money(f.amount).padStart(18)}`);
  }
}

console.log(`\n═══ ${passed} ok, ${failed} falha(s) ═══\n`);
process.exit(failed > 0 ? 1 : 0);
