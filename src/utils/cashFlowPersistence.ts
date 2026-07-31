/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NORMALIZAÇÃO E PERSISTÊNCIA DO FLUXO DE CAIXA
 * ─────────────────────────────────────────────
 * Este arquivo existe por causa de um bug específico e caro: valores digitados
 * pelo gestor nos campos de recebimento e pagamento "voltavam" ao número antigo
 * depois de sair e entrar na tela. Três defeitos somados produziam isso:
 *
 *  1. GRAVAÇÃO NÃO ERA ABSOLUTA. O save usava `setDoc(..., { merge: true })`, e
 *     no Firestore merge faz DEEP MERGE em mapas aninhados. `semanas` é um mapa.
 *     Todo sub-campo ausente no objeto novo mantinha o valor ANTIGO no banco.
 *     Como `recebRealizado`/`desembRealizado` são opcionais no tipo, bastava uma
 *     semana sem eles para o número velho sobreviver à gravação.
 *
 *  2. LEITURA NÃO NORMALIZAVA. `{ ...emptyWeeks(), ...data.semanas }` é spread
 *     RASO: a semana vinda do banco substituía a semana vazia inteira. Um doc
 *     com `sem01: { recebimentos: 100 }` produzia `aportes: undefined`, e
 *     `undefined` na gravação seguinte faz o SDK do Firestore lançar exceção
 *     (o projeto não liga `ignoreUndefinedProperties`).
 *
 *  3. Sem normalização, leitura e escrita discordavam sobre o formato — e o
 *     banco acumulava documentos com formatos diferentes conforme a época em
 *     que foram salvos.
 *
 * A regra agora é uma só: TODA semana tem SEMPRE os cinco campos numéricos,
 * sempre finitos, sempre arredondados a 2 casas. O documento gravado é o
 * espelho exato da tela. Nada de merge, nada de campo faltando, nada de
 * `undefined`.
 */

import { CashFlowPlan, CashFlowWeekKey, CashFlowWeekPlan } from '../types';

export const CASHFLOW_WEEKS: CashFlowWeekKey[] = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];

/**
 * Converte qualquer coisa em número finito de 2 casas. NaN/undefined/'' → 0.
 *
 * A regra do ponto: só é separador de milhar QUANDO HÁ VÍRGULA na string.
 * Tratar todo ponto como milhar é o erro clássico aqui — "7016.87" viraria
 * R$ 701.687,00, um valor cem vezes maior, gravado sem nenhum aviso. Com
 * vírgula presente ("7.016,87") o formato é pt-BR e aí sim o ponto é milhar.
 */
export const toMoney = (v: unknown): number => {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    const s = v.trim();
    n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  } else {
    n = NaN;
  }
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

/** Uma semana com os cinco campos garantidos. */
export const normalizeWeek = (w: Partial<CashFlowWeekPlan> | undefined | null): Required<CashFlowWeekPlan> => ({
  recebimentos: toMoney(w?.recebimentos),
  desembolsos: toMoney(w?.desembolsos),
  aportes: toMoney(w?.aportes),
  recebRealizado: toMoney(w?.recebRealizado),
  desembRealizado: toMoney(w?.desembRealizado),
});

/** As cinco semanas, sempre completas, na ordem. */
export const normalizeWeeks = (
  weeks: Partial<Record<CashFlowWeekKey, Partial<CashFlowWeekPlan>>> | undefined | null
): Record<CashFlowWeekKey, Required<CashFlowWeekPlan>> => {
  const out = {} as Record<CashFlowWeekKey, Required<CashFlowWeekPlan>>;
  for (const k of CASHFLOW_WEEKS) out[k] = normalizeWeek(weeks?.[k]);
  return out;
};

/**
 * Plano inteiro normalizado — a forma canônica usada tanto para gravar quanto
 * para comparar. Se dois planos normalizados têm o mesmo JSON, são o mesmo
 * plano; é sobre isso que a detecção de "alterações não salvas" se apoia.
 */
export const normalizePlan = (plan: CashFlowPlan): CashFlowPlan => ({
  id: plan.id || `${plan.year}_${plan.monthKey}`,
  year: Number(plan.year) || 0,
  monthKey: String(plan.monthKey || ''),
  saldoInicial: toMoney(plan.saldoInicial),
  useSaldoAutomatico: !!plan.useSaldoAutomatico,
  realizadoManual: plan.realizadoManual !== false,
  weeks: normalizeWeeks(plan.weeks),
  pendencias: (plan.pendencias || [])
    .filter((p) => p && (p.descricao?.trim() || toMoney(p.valor) !== 0))
    .map((p) => ({ descricao: String(p.descricao || '').trim(), valor: toMoney(p.valor) })),
  contasCaixa: (plan.contasCaixa || [])
    .filter((c) => c && (c.nome?.trim() || toMoney(c.saldo) !== 0))
    .map((c) => ({ nome: String(c.nome || '').trim(), saldo: toMoney(c.saldo) })),
  posicaoData: plan.posicaoData || '',
  horizonteAporteDias: Number(plan.horizonteAporteDias) > 0 ? Number(plan.horizonteAporteDias) : 30,
  notes: plan.notes || '',
  updatedAt: plan.updatedAt,
});

/**
 * Assinatura de conteúdo do plano, ignorando `updatedAt`.
 *
 * Serve para responder "o que está na tela é diferente do que está salvo?".
 * Comparar o objeto inteiro não funcionaria: `updatedAt` muda a cada gravação e
 * faria todo plano recém-salvo parecer sujo para sempre.
 */
export const planSignature = (plan: CashFlowPlan): string => {
  const n = normalizePlan(plan);
  return JSON.stringify([
    n.year, n.monthKey, n.saldoInicial, n.useSaldoAutomatico, n.realizadoManual,
    CASHFLOW_WEEKS.map((w) => [
      n.weeks[w].recebimentos, n.weeks[w].desembolsos, n.weeks[w].aportes,
      n.weeks[w].recebRealizado, n.weeks[w].desembRealizado,
    ]),
    n.pendencias, n.contasCaixa, n.posicaoData, n.horizonteAporteDias, n.notes,
  ]);
};

/** Plano zerado do mês — a referência quando ainda não existe nada salvo. */
export const emptyPlanFor = (year: number, monthKey: string): CashFlowPlan =>
  normalizePlan({
    id: `${year}_${monthKey}`,
    year,
    monthKey,
    saldoInicial: 0,
    useSaldoAutomatico: false,
    realizadoManual: true,
    weeks: normalizeWeeks(undefined),
    pendencias: [],
  });

/**
 * true quando o rascunho na tela diverge do que está salvo.
 *
 * Mês ainda não salvo compara contra o plano zerado: assim, abrir um mês novo e
 * não digitar nada NÃO conta como alteração pendente (senão o aviso de "não
 * salvo" apareceria o tempo todo e as pessoas aprenderiam a ignorá-lo — que é
 * como um aviso de perda de dados deixa de proteger alguém).
 */
export const isPlanDirty = (draft: CashFlowPlan, saved: CashFlowPlan | undefined): boolean =>
  planSignature(draft) !== planSignature(saved ?? emptyPlanFor(draft.year, draft.monthKey));

/** Documento Firestore (campos em português, padrão das demais coleções). */
export const planToFirestore = (plan: CashFlowPlan, updatedAtIso: string): Record<string, any> => {
  const n = normalizePlan(plan);
  return {
    ano: n.year,
    mes: n.monthKey,
    saldo_inicial: n.saldoInicial,
    saldo_automatico: n.useSaldoAutomatico,
    realizado_manual: n.realizadoManual,
    semanas: n.weeks,
    pendencias: n.pendencias,
    contas_caixa: n.contasCaixa,
    posicao_data: n.posicaoData,
    horizonte_aporte_dias: n.horizonteAporteDias,
    observacoes: n.notes,
    atualizado_em: updatedAtIso,
  };
};

export const planFromFirestore = (id: string, data: any): CashFlowPlan =>
  normalizePlan({
    id,
    year: Number(data?.ano) || 0,
    monthKey: (data?.mes || '').toString(),
    saldoInicial: data?.saldo_inicial,
    useSaldoAutomatico: !!data?.saldo_automatico,
    // Documentos antigos podem não ter o campo. O padrão passou a ser "o
    // realizado é o que está digitado", então a ausência significa true.
    realizadoManual: data?.realizado_manual !== false,
    weeks: data?.semanas,
    pendencias: Array.isArray(data?.pendencias) ? data.pendencias : [],
    contasCaixa: Array.isArray(data?.contas_caixa) ? data.contas_caixa : [],
    posicaoData: data?.posicao_data || '',
    horizonteAporteDias: data?.horizonte_aporte_dias,
    notes: data?.observacoes || '',
    updatedAt: data?.atualizado_em || undefined,
  } as CashFlowPlan);
