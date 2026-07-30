/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * paymentAccounts.ts — AS CONTAS E CAIXAS DA EMPRESA, EM UM SÓ LUGAR.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ===========================
 * A lista de contas estava espalhada: `TESOURARIA_ACCOUNTS` em statementKeys.ts
 * conhecia os caixas 301.xx, o `BANK_MAP` do extratoGeralParser conhecia também
 * Bradesco e PagBank, e a tela de Títulos não conhecia nenhuma — não havia como
 * dizer de que conta saiu um pagamento. Três listas para a mesma pergunta é como
 * nasce o relatório que não fecha: abre-se uma conta nova no ERP, cadastra-se em
 * duas, e a terceira passa a jogar o dinheiro em "não identificada".
 *
 * Agora a lista mora AQUI e só aqui. O parser do Extrato Geral, o seletor de
 * origem dos títulos e as somas por conta leem todos deste registro.
 *
 * `code` × `accountCode` — DUAS CHAVES, DE PROPÓSITO
 * -------------------------------------------------
 * `code` identifica a conta no sistema ('caixa30107', 'alba30110'). `accountCode`
 * é a conta CONTÁBIL do plano de contas ('30107', '30110'). Não são a mesma
 * coisa: no extrato real, `ALBA30110` e `CAIXA30110` são dois nomes operacionais
 * da MESMA conta contábil 301.10. Fundir os dois num só registro apagaria a
 * informação de quem movimentou; usar só o nome operacional impediria de somar a
 * conta 301.10 inteira. Guardar os dois resolve as duas perguntas.
 *
 * FORMA DE PAGAMENTO É DERIVADA, NUNCA DIGITADA
 * ---------------------------------------------
 * "Dinheiro" ou "Banco" não é um campo que alguém preenche: é consequência da
 * conta. Caixa é dinheiro em espécie, conta corrente é banco. Deixar isso como
 * campo livre garante que um dia alguém marque "Dinheiro" num pagamento do
 * Bradesco e o total por forma pare de bater com o total por conta.
 */

import { Customer, FinancialStatementEntry, StatementOrigin, StatementSource, TituloFinanceiro } from '../types';
import { extractCashAccountFromText, normalizeKeyText } from './statementKeys';

// ─── Modelo ──────────────────────────────────────────────────────────────────

/** Como o dinheiro se move. Derivado da conta, nunca escolhido à mão. */
export type PaymentForm = 'Banco' | 'Dinheiro';

export interface PaymentAccount {
  /** Chave da conta no sistema. É o que fica gravado no título. */
  code: string;
  /** Conta contábil do plano de contas (301.xx). Vazio para conta bancária. */
  accountCode: string;
  label: string;
  shortLabel: string;
  origin: StatementOrigin;
  paymentForm: PaymentForm;
  /** Fonte correspondente no Extrato Financeiro. */
  statementSource: StatementSource;
  /**
   * Como a coluna BANCO do Extrato Geral escreve esta conta. Normalizado
   * (minúsculo, sem acento, sem separador) — ver `normalizeAccountToken`.
   */
  bankTokens: string[];
  description: string;
}

/** 'CAIXA 301.07' → 'caixa30107'. Tolera espaço, ponto, hífen e acento. */
export const normalizeAccountToken = (raw: any): string =>
  normalizeKeyText(raw).replace(/[^a-z0-9]+/g, '');

/**
 * REGISTRO DAS CONTAS.
 *
 * Para cadastrar uma conta nova: acrescente uma entrada aqui. Ela passa a
 * aparecer no seletor de origem dos títulos, nas somas por conta e no
 * roteamento do Extrato Geral de uma vez — não há segundo lugar para editar.
 */
export const PAYMENT_ACCOUNTS: PaymentAccount[] = [
  {
    code: 'bradesco',
    accountCode: '',
    label: 'Bradesco',
    shortLabel: 'Bradesco',
    origin: 'banco',
    paymentForm: 'Banco',
    statementSource: 'bradesco',
    bankTokens: ['bradesco'],
    description: 'Conta corrente Bradesco — cobrança, PIX e tributos.',
  },
  {
    code: 'pagbank',
    accountCode: '',
    label: 'PagBank',
    shortLabel: 'PagBank',
    origin: 'banco',
    paymentForm: 'Banco',
    statementSource: 'pagseguro',
    bankTokens: ['pagbank', 'pagseguro'],
    description: 'Conta PagBank/PagSeguro — recebimento de cartão e PIX.',
  },
  {
    code: 'tesouraria30101',
    accountCode: '30101',
    label: 'Tesouraria 30101',
    shortLabel: 'Tesouraria',
    origin: 'caixa',
    paymentForm: 'Dinheiro',
    statementSource: 'tesouraria',
    bankTokens: ['tesouraria', 'caixa30101', 'tesouraria30101'],
    description: 'Tesouraria central — pagamentos em espécie de títulos e borderôs.',
  },
  {
    code: 'caixa30107',
    accountCode: '30107',
    label: 'Caixa 30107',
    shortLabel: 'Caixa 30107',
    origin: 'caixa',
    paymentForm: 'Dinheiro',
    statementSource: 'tesouraria',
    bankTokens: ['caixa30107'],
    description: 'Caixa 301.07 — recebimentos em espécie no balcão.',
  },
  {
    code: 'caixa30108',
    accountCode: '30108',
    label: 'Caixa 30108',
    shortLabel: 'Caixa 30108',
    origin: 'caixa',
    paymentForm: 'Dinheiro',
    statementSource: 'tesouraria',
    bankTokens: ['caixa30108'],
    description: 'Caixa 301.08 — caixa da loja.',
  },
  {
    code: 'caixa30110',
    accountCode: '30110',
    label: 'Caixa 30110',
    shortLabel: 'Caixa 30110',
    origin: 'caixa',
    paymentForm: 'Dinheiro',
    statementSource: 'tesouraria',
    bankTokens: ['caixa30110'],
    description: 'Caixa 301.10 — recebimentos em espécie.',
  },
  {
    code: 'alba30110',
    accountCode: '30110',
    label: 'Alba 30110',
    shortLabel: 'Alba 30110',
    origin: 'caixa',
    paymentForm: 'Dinheiro',
    statementSource: 'tesouraria',
    bankTokens: ['alba30110', 'alba'],
    description: 'Alba — mesma conta contábil 301.10, sob outro nome operacional.',
  },
];

export const PAYMENT_ACCOUNT_BY_CODE: Record<string, PaymentAccount> = PAYMENT_ACCOUNTS.reduce(
  (acc, a) => {
    acc[a.code] = a;
    return acc;
  },
  {} as Record<string, PaymentAccount>
);

/** Índice token da coluna BANCO → conta. Montado uma vez, no carregamento. */
const TOKEN_INDEX: Map<string, PaymentAccount> = (() => {
  const m = new Map<string, PaymentAccount>();
  for (const a of PAYMENT_ACCOUNTS) {
    m.set(normalizeAccountToken(a.code), a);
    for (const t of a.bankTokens) m.set(normalizeAccountToken(t), a);
  }
  return m;
})();

/**
 * Resolve a conta a partir do texto da coluna BANCO (ou de qualquer rótulo).
 *
 * Devolve `null` quando não reconhece — de propósito. Chutar a conta joga o
 * dinheiro na linha errada do Resultado Financeiro, e o erro só aparece meses
 * depois, quando o gerencial não fecha. Quem chama decide se rejeita a linha ou
 * pergunta ao usuário.
 */
export const findAccountByBankText = (raw: any): PaymentAccount | null => {
  const token = normalizeAccountToken(raw);
  if (!token) return null;

  const direct = TOKEN_INDEX.get(token);
  if (direct) return direct;

  // Conta 301.xx aberta no ERP depois deste cadastro: o código no nome é prova
  // suficiente de que é caixa em espécie. Reconhecer aqui evita que uma conta
  // nova volte a cair em "não identificada" em silêncio.
  const cashCode = extractCashAccountFromText(raw);
  if (cashCode) {
    const known = PAYMENT_ACCOUNTS.find((a) => a.accountCode === cashCode);
    if (known) return known;
    const nome = (raw ?? '').toString().trim();
    return {
      code: `caixa${cashCode}`,
      accountCode: cashCode,
      label: nome || `Caixa ${cashCode}`,
      shortLabel: nome || `Caixa ${cashCode}`,
      origin: 'caixa',
      paymentForm: 'Dinheiro',
      statementSource: 'tesouraria',
      bankTokens: [],
      description: `Conta ${cashCode} — reconhecida pelo código, não cadastrada.`,
    };
  }

  return null;
};

/**
 * Resolve a conta a partir de um lançamento do Extrato Financeiro.
 *
 * A ordem tenta o dado mais específico primeiro: o rótulo da conta de caixa, o
 * código contábil, o rótulo da fonte e, por último, a fonte genérica. Um
 * lançamento antigo pode ter só a fonte gravada; começar por ela perderia a
 * distinção entre os caixas, que é justamente o que se quer saber.
 */
export const findAccountByStatementEntry = (e: FinancialStatementEntry | undefined | null): PaymentAccount | null => {
  if (!e) return null;
  return (
    findAccountByBankText(e.accountLabel) ||
    (e.accountCode ? PAYMENT_ACCOUNTS.find((a) => a.accountCode === e.accountCode) || null : null) ||
    findAccountByBankText(e.sourceLabel) ||
    (e.source === 'bradesco'
      ? PAYMENT_ACCOUNT_BY_CODE.bradesco
      : e.source === 'pagseguro'
      ? PAYMENT_ACCOUNT_BY_CODE.pagbank
      : null)
  );
};

// ─── Origem do título ────────────────────────────────────────────────────────

/** De onde veio a informação de conta — decide quem pode sobrescrever quem. */
export type OriginSource = 'gestor' | 'baixa' | 'nenhuma';

export interface TituloOrigin {
  /** `code` da conta, '' quando desconhecida. */
  accountKey: string;
  accountCode: string;
  label: string;
  paymentForm: PaymentForm | '';
  source: OriginSource;
}

const ORIGIN_UNKNOWN: TituloOrigin = {
  accountKey: '',
  accountCode: '',
  label: '',
  paymentForm: '',
  source: 'nenhuma',
};

const originFromAccount = (a: PaymentAccount, source: OriginSource): TituloOrigin => ({
  accountKey: a.code,
  accountCode: a.accountCode,
  label: a.label,
  paymentForm: a.paymentForm,
  source,
});

/**
 * DE QUAL CONTA SAIU (ou entrou) O DINHEIRO DESTE TÍTULO.
 *
 * A ESCOLHA DO GESTOR VENCE A BAIXA — e a razão não é hierarquia, é informação.
 * A baixa automática casa valor, data e nome; ela sabe qual LANÇAMENTO pagou o
 * título, e daí infere a conta. Quando o gestor abre o dropdown e escolhe outra
 * conta, ele está corrigindo justamente essa inferência — normalmente porque o
 * pagamento saiu do caixa e só foi reembolsado pelo banco depois. Se a baixa
 * sobrescrevesse a escolha, a correção duraria até a próxima conciliação e o
 * gestor teria que refazê-la para sempre.
 *
 * Na ausência de escolha manual, a conta vem do lançamento conciliado: é dado
 * observado, melhor que campo vazio. Título pago sem baixa e sem escolha fica
 * 'nenhuma' — aparece separado nas somas, nunca diluído numa conta qualquer.
 */
export const resolveTituloOrigin = (
  titulo: TituloFinanceiro,
  statementById?: Map<string, FinancialStatementEntry>
): TituloOrigin => {
  // 1. Escolha explícita do gestor.
  if (titulo.originAccountKey) {
    const a = PAYMENT_ACCOUNT_BY_CODE[titulo.originAccountKey] || findAccountByBankText(titulo.originAccountKey);
    if (a) return originFromAccount(a, 'gestor');
  }

  // 2. Conta do lançamento de extrato que baixou o título.
  if (titulo.reconciledStatementId && statementById) {
    const a = findAccountByStatementEntry(statementById.get(titulo.reconciledStatementId));
    if (a) return originFromAccount(a, 'baixa');
  }

  // 3. Último recurso: o rótulo da fonte gravado na baixa ('Caixa 30107'),
  //    que sobrevive mesmo quando o lançamento é apagado numa troca de extrato.
  if (titulo.reconciledSource) {
    const a = findAccountByBankText(titulo.reconciledSource);
    if (a) return originFromAccount(a, 'baixa');
  }

  return ORIGIN_UNKNOWN;
};

/** Índice id → lançamento, para resolver a origem sem varrer o extrato por título. */
export const buildStatementIndex = (entries: FinancialStatementEntry[]): Map<string, FinancialStatementEntry> => {
  const m = new Map<string, FinancialStatementEntry>();
  for (const e of entries) m.set(e.id, e);
  return m;
};

// ─── Somas ───────────────────────────────────────────────────────────────────

/**
 * Valor que efetivamente se moveu no título.
 *
 * `amount` é o valor do título; `balance` é o que falta. Num título pago o saldo
 * costuma vir zerado, então somar `balance` daria zero e as contas apareceriam
 * todas vazias. O fallback existe para o título pago parcialmente, em que o ERP
 * mantém o valor no saldo.
 */
export const tituloPaidAmount = (t: TituloFinanceiro): number => t.amount || t.balance || 0;

export interface AccountTotal {
  accountKey: string;
  accountCode: string;
  label: string;
  paymentForm: PaymentForm | '';
  count: number;
  amount: number;
  /** Quantos desses vieram da baixa (sem confirmação humana da conta). */
  fromBaixa: number;
}

export interface FormTotal {
  form: PaymentForm | 'Sem origem';
  count: number;
  amount: number;
}

export type ExpenseClass = 'Despesa Fixa' | 'Despesa Variável' | 'Não classificado';

export interface ExpenseTotal {
  classification: ExpenseClass;
  count: number;
  amount: number;
}

export interface OriginSummary {
  /** Só títulos pagos entram: a pergunta é onde o dinheiro passou. */
  paidCount: number;
  paidAmount: number;
  byAccount: AccountTotal[];
  byForm: FormTotal[];
  byExpense: ExpenseTotal[];
  /** Pagos sem conta identificada — o que falta o gestor apontar. */
  withoutOrigin: { count: number; amount: number };
  /** Conta preenchida pela baixa, ainda sem confirmação do gestor. */
  inferredFromBaixa: { count: number; amount: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Classificação de despesa do título, herdada do cadastro da pessoa.
 *
 * O ERP não classifica despesa por título — quem sabe se um fornecedor é custo
 * fixo ou variável é o cadastro (`Customer.expenseClassification`). O vínculo é
 * pelo `personCode`, o mesmo código nas duas bases.
 */
export const tituloExpenseClass = (
  titulo: TituloFinanceiro,
  customerByCode: Map<string, Customer>,
  normalizeCode: (c: any) => string
): ExpenseClass => {
  const c = customerByCode.get(normalizeCode(titulo.personCode));
  const raw = (c?.expenseClassification || '').toString().trim();
  if (raw === 'Despesa Fixa') return 'Despesa Fixa';
  if (raw === 'Despesa Variável') return 'Despesa Variável';
  return 'Não classificado';
};

/**
 * Somas de tudo que foi pago (ou recebido), por conta, por forma de pagamento e
 * por classificação de despesa.
 *
 * AS TRÊS SOMAS FECHAM COM O MESMO TOTAL, sempre. É por isso que "Sem origem" e
 * "Não classificado" são linhas de verdade em vez de serem omitidas: uma soma
 * que ignora o que não sabe classificar dá um total menor que o real, e quem lê
 * o painel não tem como perceber o que ficou de fora.
 */
export const summarizeByOrigin = (
  titulos: TituloFinanceiro[],
  statementById: Map<string, FinancialStatementEntry>,
  customerByCode: Map<string, Customer>,
  normalizeCode: (c: any) => string
): OriginSummary => {
  const pagos = titulos.filter((t) => t.isPaid);

  const accounts = new Map<string, AccountTotal>();
  const forms = new Map<string, FormTotal>();
  const expenses = new Map<ExpenseClass, ExpenseTotal>();
  let semOrigemCount = 0;
  let semOrigemAmount = 0;
  let inferidoCount = 0;
  let inferidoAmount = 0;

  for (const t of pagos) {
    const valor = tituloPaidAmount(t);
    const origem = resolveTituloOrigin(t, statementById);

    // Por conta
    const key = origem.accountKey || '__sem_origem__';
    const cur =
      accounts.get(key) ||
      {
        accountKey: origem.accountKey,
        accountCode: origem.accountCode,
        label: origem.label || 'Sem origem definida',
        paymentForm: origem.paymentForm,
        count: 0,
        amount: 0,
        fromBaixa: 0,
      };
    cur.count += 1;
    cur.amount += valor;
    if (origem.source === 'baixa') cur.fromBaixa += 1;
    accounts.set(key, cur);

    // Por forma de pagamento
    const formKey: PaymentForm | 'Sem origem' = origem.paymentForm || 'Sem origem';
    const f = forms.get(formKey) || { form: formKey, count: 0, amount: 0 };
    f.count += 1;
    f.amount += valor;
    forms.set(formKey, f);

    // Por classificação de despesa
    const cls = tituloExpenseClass(t, customerByCode, normalizeCode);
    const ex = expenses.get(cls) || { classification: cls, count: 0, amount: 0 };
    ex.count += 1;
    ex.amount += valor;
    expenses.set(cls, ex);

    if (origem.source === 'nenhuma') {
      semOrigemCount += 1;
      semOrigemAmount += valor;
    } else if (origem.source === 'baixa') {
      inferidoCount += 1;
      inferidoAmount += valor;
    }
  }

  const ordemForma: (PaymentForm | 'Sem origem')[] = ['Banco', 'Dinheiro', 'Sem origem'];
  const ordemDespesa: ExpenseClass[] = ['Despesa Fixa', 'Despesa Variável', 'Não classificado'];

  return {
    paidCount: pagos.length,
    paidAmount: round2(pagos.reduce((a, t) => a + tituloPaidAmount(t), 0)),
    byAccount: [...accounts.values()]
      .map((a) => ({ ...a, amount: round2(a.amount) }))
      .sort((a, b) => b.amount - a.amount),
    byForm: ordemForma
      .map((form) => forms.get(form))
      .filter((x): x is FormTotal => !!x)
      .map((f) => ({ ...f, amount: round2(f.amount) })),
    byExpense: ordemDespesa
      .map((c) => expenses.get(c))
      .filter((x): x is ExpenseTotal => !!x)
      .map((e) => ({ ...e, amount: round2(e.amount) })),
    withoutOrigin: { count: semOrigemCount, amount: round2(semOrigemAmount) },
    inferredFromBaixa: { count: inferidoCount, amount: round2(inferidoAmount) },
  };
};
