/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * financialAudit.ts — Ciclo operacional (Faturado → Recebido → Pago),
 * memória de cálculo e conferências de auditoria financeira.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O painel mostrava só o regime de COMPETÊNCIA (DRE) e o SALDO de caixa. Faltava
 * a pergunta que o dono da empresa faz primeiro: "vendi quanto, recebi quanto,
 * paguei quanto?". São três números de origens diferentes, e é justamente a
 * DIFERENÇA entre eles que revela problema:
 *
 *   FATURADO  → o que saiu em nota fiscal (RPR014 / faturamento_mensal)
 *   RECEBIDO  → o que efetivamente entrou no caixa (resultado_financeiro)
 *   PAGO      → o que efetivamente saiu do caixa (resultado_financeiro)
 *
 * Faturar sem receber é inadimplência. Receber menos do que paga é queima de
 * caixa. Pagar mais do que o ERP registra em Contas a Pagar é lançamento sem
 * respaldo documental. Cada uma dessas leituras vira uma conferência abaixo.
 *
 * REGRA DE OURO DESTE MÓDULO: nenhuma função aqui "conserta" número. Quando duas
 * fontes divergem, o módulo REPORTA a divergência — não escolhe uma e esconde a
 * outra. Um painel que maquia diferença não serve para auditoria.
 *
 * Tudo aqui é função pura (sem Firestore, sem React) justamente para poder ser
 * conferido de fora — ver scripts/testFinancialAudit.mjs.
 */

import {
  BillingMonthSummary,
  EconomicMonthData,
  FinancialMonthData,
  FinancialStatementEntry,
  PayableTitle,
} from '../types';

export const ALL_MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * O faturamento pode vir de duas origens, e o painel precisa dizer QUAL usou:
 * - 'notas': faturamento_mensal (RPR014), a fonte primária — nota fiscal emitida;
 * - 'dre': receita bruta do Resultado Econômico, usada como aproximação quando a
 *   base de notas ainda não foi importada/carregada;
 * - 'ausente': nenhuma das duas tem valor para o mês.
 */
export type FaturamentoSource = 'notas' | 'dre' | 'ausente';

export interface OperatingMonthRow {
  monthKey: string;
  label: string;
  faturado: number;
  faturadoSource: FaturamentoSource;
  receitaDre: number;
  recebido: number;
  recebidoBancos: number;
  recebidoTesouraria: number;
  pago: number;
  pagoErp: number;          // Contas a Pagar (RFN006) com data de pagamento no mês
  extratoEntradas: number;  // Extrato bancário/caixa — entradas
  extratoSaidas: number;    // Extrato bancário/caixa — saídas
  resultadoCaixa: number;   // recebido − pago
  conversao: number;        // recebido ÷ faturado × 100
  cobertura: number;        // recebido ÷ pago × 100
}

export interface OperatingTotals {
  faturado: number;
  receitaDre: number;
  recebido: number;
  pago: number;
  pagoErp: number;
  extratoEntradas: number;
  extratoSaidas: number;
  resultadoCaixa: number;
  resultadoEconomico: number;
  cmv: number;
  margemBruta: number;
  despesasFixas: number;
  inadimplenciaAcumulada: number;
  estoqueMedio: number;
  conversao: number;
  cobertura: number;
  mesesComDados: number;
  faturamentoDeNotas: boolean;
}

export type AuditSeverity = 'ok' | 'atencao' | 'critico' | 'sem-dados';

export interface AuditCheck {
  id: string;
  label: string;
  question: string;      // a pergunta de auditoria que a conferência responde
  baseLabel: string;
  baseValue: number;
  compareLabel: string;
  compareValue: number;
  diff: number;          // base − comparação
  diffPct: number;       // |diff| ÷ |base| × 100
  severity: AuditSeverity;
  finding: string;       // o que a diferença significa
  action: string;        // o que fazer a respeito
}

export interface CalcMemoryLine {
  id: string;
  label: string;
  formula: string;       // fórmula genérica
  substitution: string;  // fórmula com os números do período substituídos
  result: string;        // resultado formatado
  reading: string;       // interpretação em linguagem de gestão
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Divisão protegida: denominador zero devolve 0 em vez de Infinity/NaN. */
export const safeDiv = (numerator: number, denominator: number): number =>
  !denominator || !isFinite(denominator) ? 0 : numerator / denominator;

const brl = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const pct = (v: number): string =>
  `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0)}%`;

/**
 * Classifica uma divergência entre duas fontes que DEVERIAM bater.
 * Faixas escolhidas para conciliação financeira: até 1% é ruído de arredondamento
 * e corte de data; até 5% pede explicação; acima disso é erro de lançamento até
 * prova em contrário.
 */
export const classifyDivergence = (diffPct: number, hasData: boolean): AuditSeverity => {
  if (!hasData) return 'sem-dados';
  const abs = Math.abs(diffPct);
  if (abs <= 1) return 'ok';
  if (abs <= 5) return 'atencao';
  return 'critico';
};

// ─── Ciclo operacional mês a mês ────────────────────────────────────────────

/**
 * Monta a linha Faturado × Recebido × Pago de cada mês, cruzando as quatro bases
 * do sistema. Meses sem nenhum movimento são omitidos (não poluem o gráfico com
 * zeros de meses que ainda não aconteceram).
 */
export const buildOperatingRows = (params: {
  economicMonths: Record<string, EconomicMonthData>;
  financialMonths: Record<string, FinancialMonthData>;
  billingSummaries?: BillingMonthSummary[];
  payables?: PayableTitle[];
  statementEntries?: FinancialStatementEntry[];
  year: number;
}): OperatingMonthRow[] => {
  const { economicMonths, financialMonths, billingSummaries = [], payables = [], statementEntries = [], year } = params;

  // Faturamento por mês vindo das notas fiscais (fonte primária)
  const billingByMonth = new Map<string, number>();
  billingSummaries
    .filter((b) => b.year === year)
    .forEach((b) => billingByMonth.set(b.monthKey, (billingByMonth.get(b.monthKey) || 0) + (b.grossRevenue || 0)));

  // Contas a pagar liquidadas por mês.
  //
  // A CHAVE AQUI É `paidMonthKey`, NÃO `monthKey`.
  // No modelo unificado do RFN046, `monthKey` é o mês do VENCIMENTO (a
  // competência do compromisso) e `paidMonthKey` é o mês do PAGAMENTO (quando o
  // dinheiro saiu). Este confronto é contra o EXTRATO, que só conhece a data em
  // que o banco debitou — usar o vencimento jogaria um título vencido em 30/06 e
  // pago em 03/07 no mês errado e criaria uma divergência que não existe.
  //
  // Só entra o que o ERP deu por pago: compromisso em aberto não tem contrapartida
  // no extrato para ser confrontada.
  const payablesByMonth = new Map<string, number>();
  payables
    .filter((p) => p.isPaid && p.paidYear === year)
    .forEach((p) => payablesByMonth.set(p.paidMonthKey, (payablesByMonth.get(p.paidMonthKey) || 0) + (p.amount || 0)));

  // Extrato (banco + tesouraria) por mês
  const stmtInByMonth = new Map<string, number>();
  const stmtOutByMonth = new Map<string, number>();
  statementEntries
    .filter((s) => s.year === year)
    .forEach((s) => {
      stmtInByMonth.set(s.monthKey, (stmtInByMonth.get(s.monthKey) || 0) + (s.entryAmount || 0));
      stmtOutByMonth.set(s.monthKey, (stmtOutByMonth.get(s.monthKey) || 0) + (s.exitAmount || 0));
    });

  const rows: OperatingMonthRow[] = [];

  for (const monthKey of ALL_MONTH_KEYS) {
    const eco = economicMonths[monthKey];
    const fin = financialMonths[monthKey];

    const receitaDre = eco?.receitaBruta || 0;
    const faturadoNotas = billingByMonth.get(monthKey) || 0;
    const faturado = faturadoNotas > 0 ? faturadoNotas : receitaDre;
    const faturadoSource: FaturamentoSource =
      faturadoNotas > 0 ? 'notas' : receitaDre > 0 ? 'dre' : 'ausente';

    const recebidoBancos = fin?.entradasBancos || 0;
    const recebidoTesouraria = fin?.entradasTesouraria || 0;
    const recebido = fin?.totalEntradas || recebidoBancos + recebidoTesouraria;
    const pago = fin?.totalSaidas || 0;

    // Mês sem qualquer movimento em qualquer base: não entra no painel.
    if (faturado === 0 && recebido === 0 && pago === 0) continue;

    rows.push({
      monthKey,
      label: monthKey.toUpperCase(),
      faturado: round2(faturado),
      faturadoSource,
      receitaDre: round2(receitaDre),
      recebido: round2(recebido),
      recebidoBancos: round2(recebidoBancos),
      recebidoTesouraria: round2(recebidoTesouraria),
      pago: round2(pago),
      pagoErp: round2(payablesByMonth.get(monthKey) || 0),
      extratoEntradas: round2(stmtInByMonth.get(monthKey) || 0),
      extratoSaidas: round2(stmtOutByMonth.get(monthKey) || 0),
      resultadoCaixa: round2(recebido - pago),
      conversao: round2(safeDiv(recebido, faturado) * 100),
      cobertura: round2(safeDiv(recebido, pago) * 100),
    });
  }

  return rows;
};

/** Consolida as linhas mensais no total do período exibido. */
export const buildOperatingTotals = (
  rows: OperatingMonthRow[],
  economicMonths: Record<string, EconomicMonthData>,
  financialMonths: Record<string, FinancialMonthData>
): OperatingTotals => {
  const sum = (pick: (r: OperatingMonthRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);

  const faturado = sum((r) => r.faturado);
  const recebido = sum((r) => r.recebido);
  const pago = sum((r) => r.pago);

  const monthsWithStock = rows.filter((r) => (financialMonths[r.monthKey]?.estoque || 0) > 0);
  const estoqueMedio = monthsWithStock.length
    ? monthsWithStock.reduce((acc, r) => acc + (financialMonths[r.monthKey]?.estoque || 0), 0) / monthsWithStock.length
    : 0;

  // Inadimplência é SALDO, não fluxo: usa a do último mês com dado, nunca a soma.
  const lastWithInad = [...rows].reverse().find((r) => (financialMonths[r.monthKey]?.inadimplenciaAcumulada || 0) > 0);
  const inadimplenciaAcumulada = lastWithInad
    ? financialMonths[lastWithInad.monthKey]?.inadimplenciaAcumulada || 0
    : 0;

  return {
    faturado: round2(faturado),
    receitaDre: round2(sum((r) => r.receitaDre)),
    recebido: round2(recebido),
    pago: round2(pago),
    pagoErp: round2(sum((r) => r.pagoErp)),
    extratoEntradas: round2(sum((r) => r.extratoEntradas)),
    extratoSaidas: round2(sum((r) => r.extratoSaidas)),
    resultadoCaixa: round2(recebido - pago),
    resultadoEconomico: round2(rows.reduce((acc, r) => acc + (economicMonths[r.monthKey]?.resultadoEconomico || 0), 0)),
    cmv: round2(rows.reduce((acc, r) => acc + (economicMonths[r.monthKey]?.cmv || 0), 0)),
    margemBruta: round2(rows.reduce((acc, r) => acc + (economicMonths[r.monthKey]?.margemBruta || 0), 0)),
    despesasFixas: round2(rows.reduce((acc, r) => acc + (economicMonths[r.monthKey]?.despesasFixas || 0), 0)),
    inadimplenciaAcumulada: round2(inadimplenciaAcumulada),
    estoqueMedio: round2(estoqueMedio),
    conversao: round2(safeDiv(recebido, faturado) * 100),
    cobertura: round2(safeDiv(recebido, pago) * 100),
    mesesComDados: rows.length,
    faturamentoDeNotas: rows.some((r) => r.faturadoSource === 'notas'),
  };
};

// ─── Memória de cálculo ─────────────────────────────────────────────────────

/**
 * Cada indicador do painel com a fórmula, os números substituídos e a leitura
 * gerencial. Existe para que ninguém precise confiar no painel: dá para refazer
 * a conta na mão a partir do que está escrito na tela.
 */
export const buildCalcMemory = (t: OperatingTotals): CalcMemoryLine[] => {
  const diasPeriodo = t.mesesComDados * 30;
  const faturamentoDiario = safeDiv(t.faturado, diasPeriodo);

  const lines: CalcMemoryLine[] = [
    {
      id: 'conversao',
      label: 'Conversão de faturamento em caixa',
      formula: 'Recebido ÷ Faturado × 100',
      substitution: `${brl(t.recebido)} ÷ ${brl(t.faturado)} × 100`,
      result: pct(t.conversao),
      reading:
        t.conversao >= 95
          ? 'Praticamente tudo que foi vendido virou dinheiro no período.'
          : t.conversao >= 80
          ? 'Parte do faturamento ainda está na carteira (prazo ou atraso). Acompanhar.'
          : 'Fatia relevante do que foi vendido não entrou no caixa — revisar prazo médio concedido e cobrança.',
    },
    {
      id: 'cobertura',
      label: 'Cobertura de pagamentos',
      formula: 'Recebido ÷ Pago × 100',
      substitution: `${brl(t.recebido)} ÷ ${brl(t.pago)} × 100`,
      result: pct(t.cobertura),
      reading:
        t.cobertura >= 100
          ? 'O que entrou cobriu o que saiu: operação se sustentou sozinha no período.'
          : 'O que entrou NÃO cobriu o que saiu: a diferença veio de saldo anterior, aporte ou dívida.',
    },
    {
      id: 'geracao',
      label: 'Geração (queima) de caixa',
      formula: 'Recebido − Pago',
      substitution: `${brl(t.recebido)} − ${brl(t.pago)}`,
      result: brl(t.resultadoCaixa),
      reading:
        t.resultadoCaixa >= 0
          ? 'Caixa cresceu no período pela própria operação.'
          : 'Caixa encolheu no período: a operação consumiu recursos em vez de gerar.',
    },
    {
      id: 'margem',
      label: 'Margem bruta',
      formula: '(Receita Bruta − CMV) ÷ Receita Bruta × 100',
      substitution: `(${brl(t.receitaDre)} − ${brl(t.cmv)}) ÷ ${brl(t.receitaDre)} × 100`,
      result: pct(safeDiv(t.margemBruta, t.receitaDre) * 100),
      reading: 'Quanto sobra de cada real vendido para pagar despesa fixa e gerar lucro.',
    },
    {
      id: 'equilibrio',
      label: 'Ponto de equilíbrio do período',
      formula: 'Despesas Fixas ÷ Margem Bruta %',
      substitution: `${brl(t.despesasFixas)} ÷ ${pct(safeDiv(t.margemBruta, t.receitaDre) * 100)}`,
      result: brl(safeDiv(t.despesasFixas, safeDiv(t.margemBruta, t.receitaDre))),
      reading: 'Faturamento mínimo para o resultado econômico ser zero. Abaixo disso, prejuízo.',
    },
    {
      id: 'inad-fat',
      label: 'Inadimplência sobre faturamento',
      formula: 'Inadimplência Acumulada ÷ Faturado × 100',
      substitution: `${brl(t.inadimplenciaAcumulada)} ÷ ${brl(t.faturado)} × 100`,
      result: pct(safeDiv(t.inadimplenciaAcumulada, t.faturado) * 100),
      reading: 'Percentual do que foi vendido no período que hoje está vencido e não pago.',
    },
    {
      id: 'dias-parados',
      label: 'Dias de faturamento parados em atraso',
      formula: 'Inadimplência Acumulada ÷ (Faturado ÷ dias do período)',
      substitution: `${brl(t.inadimplenciaAcumulada)} ÷ ${brl(faturamentoDiario)} por dia`,
      result: `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(
        safeDiv(t.inadimplenciaAcumulada, faturamentoDiario)
      )} dias`,
      reading: 'Quantos dias de venda estão travados na carteira vencida. Quanto maior, pior o giro do recebível.',
    },
    {
      id: 'caixa-x-competencia',
      label: 'Caixa × Competência',
      formula: 'Resultado de Caixa − Resultado Econômico',
      substitution: `${brl(t.resultadoCaixa)} − ${brl(t.resultadoEconomico)}`,
      result: brl(t.resultadoCaixa - t.resultadoEconomico),
      reading:
        'Diferença entre o lucro apurado (competência) e o dinheiro que sobrou (caixa). Explicada por prazo de recebimento, estoque e investimentos.',
    },
    {
      id: 'estoque-giro',
      label: 'Estoque sobre faturamento mensal',
      formula: 'Estoque Médio ÷ (Faturado ÷ meses)',
      substitution: `${brl(t.estoqueMedio)} ÷ ${brl(safeDiv(t.faturado, t.mesesComDados))} por mês`,
      result: `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(
        safeDiv(t.estoqueMedio, safeDiv(t.faturado, t.mesesComDados))
      )} meses de venda`,
      reading: 'Quantos meses de venda estão imobilizados em mercadoria parada.',
    },
  ];

  return lines;
};

// ─── Conferências de auditoria ──────────────────────────────────────────────

/**
 * Cruzamentos entre bases independentes. A lógica é sempre a mesma: dois números
 * que precisam bater, a diferença entre eles, e o que a diferença significa.
 *
 * Quando uma das bases não está carregada (ex: Contas a Pagar do ano ainda não
 * importado), a conferência aparece como 'sem-dados' em vez de acusar
 * divergência de 100% — acusar erro onde só falta informação destrói a
 * credibilidade do painel inteiro.
 */
export const buildAuditChecks = (params: {
  totals: OperatingTotals;
  payables?: PayableTitle[];
  year: number;
}): AuditCheck[] => {
  const { totals: t, payables = [], year } = params;
  const checks: AuditCheck[] = [];

  const mk = (
    id: string,
    label: string,
    question: string,
    baseLabel: string,
    baseValue: number,
    compareLabel: string,
    compareValue: number,
    hasData: boolean,
    findings: { ok: string; diverge: string },
    action: string
  ): AuditCheck => {
    const diff = round2(baseValue - compareValue);
    const diffPct = round2(Math.abs(safeDiv(diff, baseValue)) * 100);
    const severity = classifyDivergence(diffPct, hasData);
    return {
      id,
      label,
      question,
      baseLabel,
      baseValue: round2(baseValue),
      compareLabel,
      compareValue: round2(compareValue),
      diff,
      diffPct,
      severity,
      finding: severity === 'sem-dados' ? 'Base ainda não carregada para este ano.' : severity === 'ok' ? findings.ok : findings.diverge,
      action: severity === 'sem-dados' ? 'Importar a base correspondente para habilitar a conferência.' : action,
    };
  };

  // 1. Nota fiscal emitida × Receita reconhecida no DRE
  checks.push(
    mk(
      'faturamento-x-dre',
      'Faturamento (notas) × Receita Bruta (DRE)',
      'Tudo que foi emitido em nota está reconhecido no resultado econômico?',
      'Notas fiscais (RPR014)',
      t.faturamentoDeNotas ? t.faturado : 0,
      'Receita Bruta (DRE)',
      t.receitaDre,
      t.faturamentoDeNotas && t.receitaDre > 0,
      {
        ok: 'Nota fiscal e DRE contam a mesma história. Receita reconhecida corretamente.',
        diverge: 'Existe receita em nota que não está no DRE (ou vice-versa): risco de resultado subavaliado/superavaliado.',
      },
      'Conferir notas canceladas, devoluções e o corte de competência do último dia do mês.'
    )
  );

  // 2. Entradas oficiais × Extrato (conciliação bancária de recebimentos)
  checks.push(
    mk(
      'recebido-x-extrato',
      'Recebido (oficial) × Extrato Financeiro',
      'O que o painel diz que entrou realmente aparece no banco e na tesouraria?',
      'Entradas — Resultado Financeiro',
      t.recebido,
      'Entradas — Extrato importado',
      t.extratoEntradas,
      t.extratoEntradas > 0,
      {
        ok: 'Recebimentos conciliados com o extrato. Entrada de caixa comprovada por documento.',
        diverge: 'Há entradas declaradas sem lastro no extrato (ou lançamentos no extrato não considerados).',
      },
      'Rodar a conciliação no Extrato Financeiro e identificar os lançamentos sem correspondência.'
    )
  );

  // 3. Saídas oficiais × Extrato (conciliação bancária de pagamentos)
  checks.push(
    mk(
      'pago-x-extrato',
      'Pago (oficial) × Extrato Financeiro',
      'Todo pagamento declarado tem saída correspondente no banco?',
      'Saídas — Resultado Financeiro',
      t.pago,
      'Saídas — Extrato importado',
      t.extratoSaidas,
      t.extratoSaidas > 0,
      {
        ok: 'Pagamentos conciliados com o extrato.',
        diverge: 'Saída declarada sem lastro bancário é o achado mais sensível de uma auditoria de caixa.',
      },
      'Priorizar esta diferença: identificar pagamento por pagamento qual não tem comprovante bancário.'
    )
  );

  // 4. Saídas oficiais × Contas a Pagar (lastro documental do ERP)
  checks.push(
    mk(
      'pago-x-erp',
      'Pago (oficial) × Contas a Pagar (RFN006)',
      'O que saiu do caixa tem título correspondente no contas a pagar?',
      'Saídas — Resultado Financeiro',
      t.pago,
      'Títulos pagos — ERP',
      t.pagoErp,
      t.pagoErp > 0,
      {
        ok: 'Saídas de caixa lastreadas em títulos do ERP.',
        diverge: 'Pagamento sem título no ERP indica despesa fora do fluxo de aprovação.',
      },
      'Listar as saídas do período sem título vinculado e exigir documento de respaldo.'
    )
  );

  // 5. Títulos pagos ainda não conciliados (baixa pendente)
  //
  // "Pago sem baixa" é o título que o ERP diz ter liquidado e que não encontrou
  // par no extrato. Título EM ABERTO não conta aqui: ele não tem baixa porque
  // ainda não foi pago, e misturar os dois transformaria a previsão do mês em
  // falha de conciliação.
  const pagosDoAno = payables.filter((p) => p.isPaid && p.paidYear === year);
  const abertos = pagosDoAno.filter((p) => p.status === 'Em Aberto' || p.status === 'Conferir');
  const valorAberto = abertos.reduce((acc, p) => acc + (p.amount || 0), 0);
  const totalTitulos = pagosDoAno;
  const pctAberto = round2(safeDiv(valorAberto, totalTitulos.reduce((a, p) => a + (p.amount || 0), 0)) * 100);
  checks.push({
    id: 'baixas-pendentes',
    label: 'Títulos pagos sem baixa conciliada',
    question: 'Quanto do contas a pagar ainda não foi confrontado com o extrato?',
    baseLabel: 'Valor em títulos não conciliados',
    baseValue: round2(valorAberto),
    compareLabel: 'Quantidade de títulos',
    compareValue: abertos.length,
    diff: round2(valorAberto),
    diffPct: pctAberto,
    severity: totalTitulos.length === 0 ? 'sem-dados' : pctAberto <= 5 ? 'ok' : pctAberto <= 20 ? 'atencao' : 'critico',
    finding:
      totalTitulos.length === 0
        ? 'Contas a Pagar ainda não importado para este ano.'
        : abertos.length === 0
        ? 'Todos os títulos do período estão conciliados com o extrato.'
        : `${abertos.length} título(s) pagos no ERP seguem sem confronto com o extrato bancário.`,
    action:
      totalTitulos.length === 0
        ? 'Importar o RFN006 para habilitar a conferência.'
        : 'Executar a baixa automática em Contas a Pagar e tratar manualmente o que sobrar.',
  });

  // 6. Inadimplência sobre faturamento (qualidade do recebível)
  const inadPct = round2(safeDiv(t.inadimplenciaAcumulada, t.faturado) * 100);
  checks.push({
    id: 'inadimplencia',
    label: 'Inadimplência sobre faturamento',
    question: 'Qual fatia do que vendemos virou carteira vencida?',
    baseLabel: 'Inadimplência acumulada',
    baseValue: t.inadimplenciaAcumulada,
    compareLabel: 'Faturado no período',
    compareValue: t.faturado,
    diff: round2(t.inadimplenciaAcumulada),
    diffPct: inadPct,
    severity: t.faturado === 0 ? 'sem-dados' : inadPct <= 5 ? 'ok' : inadPct <= 12 ? 'atencao' : 'critico',
    finding:
      t.faturado === 0
        ? 'Sem faturamento no período para calcular a proporção.'
        : `${pct(inadPct)} do faturamento do período está vencido e não recebido.`,
    action: 'Cruzar a carteira vencida por cliente e vendedor no Relatório de Cobrança e suspender crédito dos críticos.',
  });

  // 7. Caixa × Competência (a diferença que sempre precisa ter explicação)
  const gap = round2(t.resultadoCaixa - t.resultadoEconomico);
  const gapPct = round2(Math.abs(safeDiv(gap, t.receitaDre)) * 100);
  checks.push({
    id: 'caixa-x-competencia',
    label: 'Resultado de Caixa × Resultado Econômico',
    question: 'O lucro apurado virou dinheiro?',
    baseLabel: 'Resultado de Caixa',
    baseValue: t.resultadoCaixa,
    compareLabel: 'Resultado Econômico',
    compareValue: t.resultadoEconomico,
    diff: gap,
    diffPct: gapPct,
    severity: t.receitaDre === 0 ? 'sem-dados' : gapPct <= 3 ? 'ok' : gapPct <= 8 ? 'atencao' : 'critico',
    finding:
      t.receitaDre === 0
        ? 'Sem receita reconhecida no período.'
        : gap < 0
        ? 'O lucro contábil não se converteu em caixa: dinheiro preso em estoque, prazo de recebimento ou amortização de dívida.'
        : 'Entrou mais caixa do que o lucro do período — típico de recebimento de vendas antigas ou aporte.',
    action: 'Abrir a ponte caixa × competência: variação de estoque, de recebíveis e de contas a pagar no período.',
  });

  return checks;
};

/** Resumo para o cabeçalho do bloco de auditoria. */
export const summarizeAudit = (checks: AuditCheck[]) => ({
  ok: checks.filter((c) => c.severity === 'ok').length,
  atencao: checks.filter((c) => c.severity === 'atencao').length,
  critico: checks.filter((c) => c.severity === 'critico').length,
  semDados: checks.filter((c) => c.severity === 'sem-dados').length,
  total: checks.length,
});
