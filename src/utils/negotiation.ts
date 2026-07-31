/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MOTOR DE NEGOCIAÇÃO DE DÍVIDA
 * ─────────────────────────────
 * Toda a aritmética do acordo mora aqui, fora do componente, por dois motivos
 * de auditoria:
 *
 *  1. Dinheiro não pode depender de render. Se o cálculo vive dentro do JSX,
 *     qualquer refatoração de UI pode mudar silenciosamente o valor de uma
 *     parcela assinada pelo cliente. Aqui a regra é isolada e testável.
 *
 *  2. Centavo tem dono. Parcelamento gera dízima (R$ 1.000,00 / 3), e se cada
 *     parcela for simplesmente arredondada, a soma não fecha com o total
 *     acordado — a diferença aparece meses depois como "saldo residual" que
 *     ninguém sabe explicar. A convenção adotada é a de mercado: parcelas
 *     iguais arredondadas para baixo e TODO o resíduo jogado na ÚLTIMA parcela.
 *     Assim `entrada + Σ parcelas === total acordado`, sempre, exatamente.
 */

import { DebtAgreement, AgreementInstallment, DelinquentTitle } from '../types';

/** Arredondamento monetário a 2 casas, imune ao erro de ponto flutuante. */
export const money = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
};

/** Converte qualquer entrada suja (string com vírgula, null, NaN) em número. */
export const safeNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

export interface DebtComposition {
  originalDebt: number;
  interestAmount: number;
  penaltyAmount: number;
  updatedDebt: number;
}

/**
 * Compõe a dívida de um conjunto de títulos aplicando a política de encargos.
 *
 * Convenção de mercado para duplicata/boleto vencido: multa FIXA sobre o valor
 * original (não recorrente) + juros de mora simples pro-rata die. Juros compostos
 * sobre mora exigem previsão contratual e, sem ela, o acordo é atacável — por
 * isso o cálculo é deliberadamente simples.
 */
export const composeDebt = (
  titles: DelinquentTitle[],
  penaltyPercent: number,
  monthlyInterestPercent: number
): DebtComposition => {
  let originalDebt = 0;
  let interestAmount = 0;
  let penaltyAmount = 0;

  const dailyInterest = safeNum(monthlyInterestPercent) / 30 / 100;
  const penaltyRate = safeNum(penaltyPercent) / 100;

  for (const t of titles) {
    const principal = Math.max(0, safeNum(t.originalAmount));
    const days = Math.max(0, safeNum(t.daysOverdue));
    originalDebt += principal;
    penaltyAmount += principal * penaltyRate;
    interestAmount += principal * dailyInterest * days;
  }

  originalDebt = money(originalDebt);
  penaltyAmount = money(penaltyAmount);
  interestAmount = money(interestAmount);

  return {
    originalDebt,
    penaltyAmount,
    interestAmount,
    updatedDebt: money(originalDebt + penaltyAmount + interestAmount),
  };
};

/**
 * Aplica o desconto negociado.
 *
 * `basis = 'encargos'` limita o abatimento a juros+multa — é o desconto que o
 * financeiro pode dar sem destruir margem, porque o principal (a mercadoria
 * entregue) permanece intacto. `basis = 'total'` permite abater o principal e
 * deve ser exceção aprovada pela gestão: o teto é cravado abaixo justamente
 * para impedir que um erro de digitação zere a dívida.
 */
export const applyDiscount = (
  comp: DebtComposition,
  discountPercent: number,
  basis: 'encargos' | 'total'
): { discountAmount: number; agreedTotal: number } => {
  const pct = Math.min(100, Math.max(0, safeNum(discountPercent)));
  const base = basis === 'encargos' ? comp.interestAmount + comp.penaltyAmount : comp.updatedDebt;
  const discountAmount = money(base * (pct / 100));
  const agreedTotal = money(Math.max(0, comp.updatedDebt - discountAmount));
  return { discountAmount, agreedTotal };
};

/** Soma meses a uma data ISO preservando o último dia do mês (31/01 + 1m = 28/02). */
export const addMonthsIso = (iso: string, months: number): string => {
  const base = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date().toISOString().slice(0, 10);
  const [y, m, d] = base.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
};

export interface ScheduleResult {
  installments: AgreementInstallment[];
  installmentAmount: number;   // valor nominal (parcelas 1..n-1)
  financedAmount: number;      // total acordado menos a entrada
  scheduleTotal: number;       // entrada + Σ parcelas — deve bater com agreedTotal
}

/**
 * Gera o cronograma de parcelas.
 *
 * O resíduo de arredondamento vai TODO na última parcela (ver cabeçalho). A
 * função devolve `scheduleTotal` de propósito: o chamador deve conferir que ele
 * é igual ao total acordado antes de gravar. É uma auto-verificação barata que
 * transforma um erro de centavos em erro visível na hora da negociação.
 */
export const buildSchedule = (
  agreedTotal: number,
  downPayment: number,
  installmentCount: number,
  firstDueDate: string
): ScheduleResult => {
  const total = money(Math.max(0, safeNum(agreedTotal)));
  const down = money(Math.min(total, Math.max(0, safeNum(downPayment))));
  const count = Math.max(0, Math.floor(safeNum(installmentCount)));
  const financedAmount = money(total - down);

  if (count <= 0 || financedAmount <= 0) {
    return { installments: [], installmentAmount: 0, financedAmount, scheduleTotal: money(down) };
  }

  // Arredonda para baixo em centavos; o que sobrar entra na última parcela.
  const baseCents = Math.floor((financedAmount * 100) / count);
  const base = money(baseCents / 100);
  const lastAmount = money(financedAmount - base * (count - 1));

  const installments: AgreementInstallment[] = [];
  for (let i = 0; i < count; i++) {
    installments.push({
      number: i + 1,
      dueDate: addMonthsIso(firstDueDate, i),
      expectedAmount: i === count - 1 ? lastAmount : base,
      status: 'Pendente',
    });
  }

  const sum = installments.reduce((acc, p) => acc + p.expectedAmount, 0);
  return {
    installments,
    installmentAmount: base,
    financedAmount,
    scheduleTotal: money(down + sum),
  };
};

/**
 * Recalcula o acompanhamento de um acordo a partir das parcelas.
 *
 * O status derivado é intencionalmente conservador: basta UMA parcela vencida e
 * não quitada para o acordo ser marcado como Quebrado. Acordo quebrado devolve o
 * cliente à régua de cobrança — tolerar atraso "pequeno" aqui é o mecanismo pelo
 * qual carteiras renegociadas viram prejuízo sem alarme.
 */
export const recomputeAgreement = (
  agreement: DebtAgreement,
  today: Date = new Date()
): Pick<DebtAgreement, 'installments' | 'totalPaid' | 'totalOutstanding' | 'status'> => {
  const todayIso = today.toISOString().slice(0, 10);
  let paid = money(safeNum(agreement.downPayment));
  let anyLate = false;
  let allPaid = true;

  const installments = agreement.installments.map((p): AgreementInstallment => {
    const expected = money(safeNum(p.expectedAmount));
    const received = money(safeNum(p.paidAmount));
    paid += received;

    let status: AgreementInstallment['status'];
    if (received >= expected && expected > 0) {
      status = 'Paga';
    } else if (received > 0) {
      status = p.dueDate < todayIso ? 'Atrasada' : 'Parcial';
    } else {
      status = p.dueDate < todayIso ? 'Atrasada' : 'Pendente';
    }

    if (status !== 'Paga') allPaid = false;
    if (status === 'Atrasada') anyLate = true;

    return { ...p, expectedAmount: expected, status };
  });

  paid = money(paid);
  const totalOutstanding = money(Math.max(0, safeNum(agreement.agreedTotal) - paid));

  // Cancelado é decisão humana e nunca é sobrescrito pelo cálculo.
  let status: DebtAgreement['status'] = agreement.status;
  if (agreement.status !== 'Cancelado') {
    if (allPaid && installments.length > 0) status = 'Cumprido';
    else if (totalOutstanding <= 0) status = 'Cumprido';
    else if (anyLate) status = 'Quebrado';
    else status = 'Ativo';
  }

  return { installments, totalPaid: paid, totalOutstanding, status };
};

/** Gera o código legível do acordo: ACO-2026-0001. */
export const nextAgreementCode = (existing: DebtAgreement[], year = new Date().getFullYear()): string => {
  const prefix = `ACO-${year}-`;
  const max = existing
    .filter((a) => a.code?.startsWith(prefix))
    .reduce((acc, a) => Math.max(acc, Number(a.code.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
};

/**
 * Validação de sanidade antes de gravar. Devolve a lista de impedimentos — se
 * vier vazia, o acordo pode ser assinado.
 */
export const validateAgreementDraft = (input: {
  titleIds: string[];
  agreedTotal: number;
  updatedDebt: number;
  downPayment: number;
  installmentCount: number;
  firstDueDate: string;
  discountPercent: number;
  scheduleTotal: number;
}): string[] => {
  const errs: string[] = [];
  if (!input.titleIds.length) errs.push('Selecione ao menos um título para negociar.');
  if (input.agreedTotal <= 0) errs.push('O total acordado precisa ser maior que zero.');
  if (input.downPayment < 0) errs.push('A entrada não pode ser negativa.');
  if (input.downPayment > input.agreedTotal) errs.push('A entrada não pode superar o total acordado.');
  if (input.installmentCount < 0 || input.installmentCount > 60)
    errs.push('O número de parcelas deve estar entre 0 e 60.');
  if (input.agreedTotal - input.downPayment > 0 && input.installmentCount === 0)
    errs.push('Há saldo a financiar: informe ao menos 1 parcela ou aumente a entrada.');
  if (input.installmentCount > 0 && !input.firstDueDate)
    errs.push('Informe o vencimento da primeira parcela.');
  if (input.discountPercent > 100) errs.push('Desconto não pode passar de 100%.');
  if (Math.abs(input.scheduleTotal - input.agreedTotal) > 0.005)
    errs.push(
      `Cronograma não fecha: entrada + parcelas = ${input.scheduleTotal.toFixed(2)} ` +
        `≠ total acordado ${input.agreedTotal.toFixed(2)}.`
    );
  return errs;
};
