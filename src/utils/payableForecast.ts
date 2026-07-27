/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * payableForecast.ts — Regras de cálculo da previsão de pagamento.
 *
 * Vive fora dos componentes de propósito: a mesma soma aparece em duas telas
 * (Contas a Pagar → Previsão de Pagamento e Fluxo de Caixa → coluna AUTOM.) e
 * duas implementações da mesma regra viram, com o tempo, dois números
 * diferentes para a mesma pergunta.
 */

import { PayableForecastTitle } from '../types';

export type ForecastWeekKey = 'sem01' | 'sem02' | 'sem03' | 'sem04' | 'sem05';

export const FORECAST_WEEKS: ForecastWeekKey[] = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];

/**
 * Semana do mês pelo dia do vencimento — mesma régua do Fluxo de Caixa:
 * 1–7 → S1, 8–14 → S2, 15–21 → S3, 22–28 → S4, 29–31 → S5.
 */
export const weekOfMonthFromIso = (iso: string): ForecastWeekKey => {
  const day = parseInt((iso || '').slice(8, 10), 10);
  if (isNaN(day)) return 'sem01';
  const idx = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
  return FORECAST_WEEKS[idx];
};

/** Data de hoje em ISO local (YYYY-MM-DD), sem passar por UTC. */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Soma dias a uma data ISO devolvendo ISO. */
export const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Formata ISO como DD/MM/AAAA (para leitura humana em cabeçalhos). */
export const formatIsoBr = (iso: string): string => {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

/**
 * Um título só entra na previsão se ainda tem saldo e não foi pago. O ERP às
 * vezes devolve no RFN046 títulos já quitados no dia da extração; deixá-los
 * passar transformaria dinheiro que já saiu em saída futura.
 */
export const isOpenForecast = (t: PayableForecastTitle): boolean =>
  (t.balance || 0) > 0 && !t.paymentDate;

/** Títulos em aberto com vencimento dentro do intervalo [start, end] (inclusivo). */
export const forecastInRange = (
  titles: PayableForecastTitle[],
  startIso: string,
  endIso: string
): PayableForecastTitle[] =>
  titles.filter((t) => isOpenForecast(t) && t.dueDate >= startIso && t.dueDate <= endIso);

/** Soma o saldo a pagar de uma lista de títulos. */
export const sumForecast = (titles: PayableForecastTitle[]): number =>
  titles.reduce((acc, t) => acc + (t.balance || 0), 0);

/**
 * Previsão de desembolso por semana de um mês (só títulos em aberto).
 * Devolve valores POSITIVOS — quem consome decide o sinal.
 */
export const forecastByWeek = (
  titles: PayableForecastTitle[],
  year: number,
  monthKey: string
): Record<ForecastWeekKey, number> => {
  const weeks: Record<ForecastWeekKey, number> = {
    sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0,
  };
  for (const t of titles) {
    if (!isOpenForecast(t)) continue;
    if (t.year !== year || t.monthKey !== monthKey) continue;
    weeks[weekOfMonthFromIso(t.dueDate)] += t.balance || 0;
  }
  return weeks;
};

/** Agrupamento genérico por chave, somando saldo e contando títulos. */
export const groupForecast = (
  titles: PayableForecastTitle[],
  keyOf: (t: PayableForecastTitle) => string
): { key: string; total: number; count: number }[] => {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of titles) {
    const k = keyOf(t) || '—';
    const cur = map.get(k) || { total: 0, count: 0 };
    cur.total += t.balance || 0;
    cur.count += 1;
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total);
};
