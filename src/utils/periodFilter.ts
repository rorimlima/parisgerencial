/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * periodFilter.ts — Recorte de período e aritmética de datas do sistema.
 *
 * POR QUE UM MÓDULO SÓ PARA ISSO
 * ==============================
 * "Junho" não é uma pergunta única. Em Contas a Receber existem três junhos
 * diferentes para o mesmo título:
 *
 *   • junho por EMISSÃO   — quando a obrigação nasceu
 *   • junho por VENCIMENTO — quando ela deveria ser liquidada (competência)
 *   • junho por PAGAMENTO  — quando o dinheiro efetivamente andou (caixa)
 *
 * Um título emitido em 20/05, vencido em 30/06 e pago em 03/07 aparece em três
 * meses distintos conforme a pergunta. Relatório que não diz qual das três datas
 * usou é relatório que ninguém consegue conferir — e é assim que dois setores da
 * mesma empresa apresentam números diferentes para "o faturamento de junho".
 *
 * Por isso o filtro carrega SEMPRE a data-base junto com o intervalo, e a tela é
 * obrigada a mostrar qual está em uso.
 *
 * ARITMÉTICA DE DATA SEM FUSO
 * ---------------------------
 * Tudo aqui trabalha com string ISO `YYYY-MM-DD` e comparação lexicográfica.
 * Passar por `new Date()` em horário local e voltar para string é a origem
 * clássica do erro de um dia: `new Date('2026-06-01')` é meia-noite UTC, que no
 * Brasil (UTC-3) é 31/05 às 21h — e o título do dia 1º some do mês de junho.
 */

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const MONTH_LABELS: Record<string, string> = {
  jan: 'Janeiro', fev: 'Fevereiro', mar: 'Março', abr: 'Abril',
  mai: 'Maio', jun: 'Junho', jul: 'Julho', ago: 'Agosto',
  set: 'Setembro', out: 'Outubro', nov: 'Novembro', dez: 'Dezembro',
};

export const MONTH_SHORT: Record<string, string> = {
  jan: 'Jan', fev: 'Fev', mar: 'Mar', abr: 'Abr', mai: 'Mai', jun: 'Jun',
  jul: 'Jul', ago: 'Ago', set: 'Set', out: 'Out', nov: 'Nov', dez: 'Dez',
};

// ─── Datas em ISO local ──────────────────────────────────────────────────────

/** Hoje em ISO local (`YYYY-MM-DD`), sem passar por UTC. */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Soma dias a uma data ISO, devolvendo ISO. Aceita negativo. */
export const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso;
  // UTC de propósito: aqui não há horário envolvido, só contagem de dias, e o
  // UTC é o único calendário que não muda de dia sozinho no horário de verão.
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
};

/** Diferença em dias entre duas datas ISO (b − a). */
export const diffDaysIso = (a: string, b: string): number => {
  const pa = (a || '').split('-').map(Number);
  const pb = (b || '').split('-').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || !pa[0] || !pb[0]) return NaN;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
};

/** Último dia do mês (28/29/30/31), respeitando ano bissexto. */
export const lastDayOfMonth = (year: number, month1a12: number): number =>
  new Date(Date.UTC(year, month1a12, 0)).getUTCDate();

export const firstDayOfMonthIso = (year: number, month1a12: number): string =>
  `${year}-${String(month1a12).padStart(2, '0')}-01`;

export const lastDayOfMonthIso = (year: number, month1a12: number): string =>
  `${year}-${String(month1a12).padStart(2, '0')}-${String(lastDayOfMonth(year, month1a12)).padStart(2, '0')}`;

export const monthKeyFromIso = (iso: string): string => {
  const m = parseInt((iso || '').slice(5, 7), 10);
  return isNaN(m) || m < 1 || m > 12 ? '' : MONTH_KEYS[m - 1];
};

export const yearFromIso = (iso: string): number => parseInt((iso || '').slice(0, 4), 10) || 0;

/** Formata ISO como DD/MM/AAAA. */
export const formatIsoBr = (iso: string): string =>
  !iso || iso.length < 10 ? '—' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Formata um intervalo de forma curta e legível. */
export const formatRangeBr = (start: string, end: string): string => {
  if (!start && !end) return 'todo o período';
  if (start && end) return `${formatIsoBr(start)} a ${formatIsoBr(end)}`;
  return start ? `a partir de ${formatIsoBr(start)}` : `até ${formatIsoBr(end)}`;
};

// ─── Semana do mês ───────────────────────────────────────────────────────────

export type WeekKey = 'sem01' | 'sem02' | 'sem03' | 'sem04' | 'sem05';
export const WEEK_KEYS: WeekKey[] = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];

/**
 * Semana do mês por blocos fixos de 7 dias: 1–7, 8–14, 15–21, 22–28, 29–31.
 *
 * NÃO é semana de calendário (domingo a sábado), e isso é deliberado. O fluxo de
 * caixa é preenchido à mão pelo gestor em cinco colunas fixas; se a régua fosse
 * o calendário, um mês teria 4 semanas e outro 6, e as colunas deixariam de
 * significar a mesma coisa entre meses. A contrapartida honesta é que a S5 tem
 * 1 a 3 dias — por isso ela costuma parecer "fraca" e não deve ser comparada
 * com as outras sem esse contexto.
 */
export const weekOfMonthIso = (iso: string): WeekKey => {
  const day = parseInt((iso || '').slice(8, 10), 10);
  if (isNaN(day)) return 'sem01';
  return WEEK_KEYS[Math.min(4, Math.max(0, Math.floor((day - 1) / 7)))];
};

/** Intervalo de dias que cada semana cobre no mês — usado nos rótulos da tela. */
export const weekRangeLabel = (year: number, month1a12: number, week: WeekKey): string => {
  const idx = WEEK_KEYS.indexOf(week);
  const ini = idx * 7 + 1;
  const fim = Math.min(lastDayOfMonth(year, month1a12), ini + 6);
  return ini > fim ? '—' : `${String(ini).padStart(2, '0')}–${String(fim).padStart(2, '0')}`;
};

// ─── Precisão monetária ──────────────────────────────────────────────────────

/**
 * Arredonda para centavos.
 *
 * Ponto flutuante binário não representa 0,1 nem 0,79 exatamente. Somando 196
 * títulos, o total da planilha (426.610,79) sai como 426610.79000000004 — e a
 * comparação com o número do ERP falha por 4×10⁻¹¹, uma diferença que não
 * existe no mundo real mas que quebra qualquer conferência automática.
 *
 * Regra do sistema: todo total exibido ou comparado passa por aqui.
 */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Soma uma lista em CENTAVOS INTEIROS e devolve reais.
 *
 * Diferente de somar e arredondar no fim: aqui cada parcela vira inteiro antes
 * da soma, então o erro não se acumula ao longo de milhares de linhas. É a forma
 * correta de totalizar dinheiro, e a diferença entre os dois métodos aparece
 * justamente nas bases grandes, onde ninguém confere linha a linha.
 */
export const sumMoney = (values: number[]): number => {
  let cents = 0;
  for (const v of values) cents += Math.round((v || 0) * 100);
  return cents / 100;
};

/** `sumMoney` com extrator, para somar um campo de uma lista de objetos. */
export const sumBy = <T,>(items: T[], get: (item: T) => number): number => {
  let cents = 0;
  for (const it of items) cents += Math.round((get(it) || 0) * 100);
  return cents / 100;
};

// ─── Filtro de período ───────────────────────────────────────────────────────

/** Qual data do título o filtro observa. */
export type DateBasis = 'vencimento' | 'pagamento' | 'emissao';

export const DATE_BASIS_LABEL: Record<DateBasis, string> = {
  vencimento: 'Vencimento',
  pagamento: 'Pagamento',
  emissao: 'Emissão',
};

export const DATE_BASIS_HINT: Record<DateBasis, string> = {
  vencimento: 'Competência — quando o compromisso vence. É a régua da previsão.',
  pagamento: 'Caixa — quando o dinheiro andou. É a régua do realizado.',
  emissao: 'Origem — quando a obrigação nasceu. Útil para conferir contra a nota.',
};

export type PeriodPreset =
  | 'ano'
  | 'mes'
  | 'trimestre'
  | 'semestre'
  | 'ultimos30'
  | 'ultimos60'
  | 'ultimos90'
  | 'proximos30'
  | 'personalizado';

export interface PeriodFilterState {
  preset: PeriodPreset;
  /** Ano de referência dos presets ancorados em calendário. */
  year: number;
  /** 1–12, usado por 'mes'. */
  month: number;
  /** 1–4, usado por 'trimestre'. */
  quarter: 1 | 2 | 3 | 4;
  /** 1–2, usado por 'semestre'. */
  semester: 1 | 2;
  /** Preenchidos por 'personalizado'. */
  startDate: string;
  endDate: string;
  basis: DateBasis;
}

export const defaultPeriodFilter = (year: number): PeriodFilterState => ({
  preset: 'ano',
  year,
  month: new Date().getMonth() + 1,
  quarter: (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4,
  semester: (new Date().getMonth() < 6 ? 1 : 2) as 1 | 2,
  startDate: '',
  endDate: '',
  basis: 'vencimento',
});

export interface ResolvedPeriod {
  start: string;
  end: string;
  label: string;
  basis: DateBasis;
}

/**
 * Converte o estado do filtro em um intervalo `[start, end]` fechado dos dois
 * lados. Fechado, e não semiaberto, porque o usuário digita "até 31/07" e espera
 * que o dia 31 entre — intervalo semiaberto silenciosamente descarta o último
 * dia, que costuma ser justamente o de maior movimento do mês.
 */
export const resolvePeriod = (f: PeriodFilterState): ResolvedPeriod => {
  const hoje = todayIso();
  const base = { basis: f.basis };

  switch (f.preset) {
    case 'mes':
      return {
        ...base,
        start: firstDayOfMonthIso(f.year, f.month),
        end: lastDayOfMonthIso(f.year, f.month),
        label: `${MONTH_LABELS[MONTH_KEYS[f.month - 1]]}/${f.year}`,
      };
    case 'trimestre': {
      const ini = (f.quarter - 1) * 3 + 1;
      return {
        ...base,
        start: firstDayOfMonthIso(f.year, ini),
        end: lastDayOfMonthIso(f.year, ini + 2),
        label: `${f.quarter}º trimestre/${f.year}`,
      };
    }
    case 'semestre': {
      const ini = f.semester === 1 ? 1 : 7;
      return {
        ...base,
        start: firstDayOfMonthIso(f.year, ini),
        end: lastDayOfMonthIso(f.year, ini + 5),
        label: `${f.semester}º semestre/${f.year}`,
      };
    }
    case 'ultimos30':
    case 'ultimos60':
    case 'ultimos90': {
      const dias = f.preset === 'ultimos30' ? 30 : f.preset === 'ultimos60' ? 60 : 90;
      // −(dias−1) para que "últimos 30 dias" some 30 dias contando hoje, e não 31.
      return { ...base, start: addDaysIso(hoje, -(dias - 1)), end: hoje, label: `Últimos ${dias} dias` };
    }
    case 'proximos30':
      return { ...base, start: hoje, end: addDaysIso(hoje, 30), label: 'Próximos 30 dias' };
    case 'personalizado':
      return {
        ...base,
        start: f.startDate,
        end: f.endDate,
        label: formatRangeBr(f.startDate, f.endDate),
      };
    case 'ano':
    default:
      return { ...base, start: `${f.year}-01-01`, end: `${f.year}-12-31`, label: `Exercício ${f.year}` };
  }
};

/** A data do título correspondente à base escolhida. */
export const dateForBasis = (
  t: { dueDate: string; paymentDate: string; issueDate: string },
  basis: DateBasis
): string => (basis === 'pagamento' ? t.paymentDate : basis === 'emissao' ? t.issueDate : t.dueDate);

/**
 * Um item pertence ao período?
 *
 * Item SEM a data da base escolhida fica de fora — e isso importa: filtrando por
 * PAGAMENTO, todo título em aberto some da lista, porque ele de fato ainda não
 * tem data de pagamento. É o comportamento correto, mas surpreende quem não
 * percebeu que trocou a régua; por isso a tela mostra a base em uso ao lado do
 * período, e o contador de itens fora do período fica visível.
 */
export const isInPeriod = (dateIso: string, period: ResolvedPeriod): boolean => {
  if (!dateIso) return false;
  const d = dateIso.slice(0, 10);
  if (period.start && d < period.start) return false;
  if (period.end && d > period.end) return false;
  return true;
};

/** Filtra uma lista de títulos pelo período, na base escolhida. */
export const filterByPeriod = <T extends { dueDate: string; paymentDate: string; issueDate: string }>(
  items: T[],
  period: ResolvedPeriod
): T[] => items.filter((t) => isInPeriod(dateForBasis(t, period.basis), period));

/** Anos presentes numa base — alimenta o seletor de exercício sem chute. */
export const yearsFromItems = <T,>(items: T[], get: (item: T) => string[]): number[] => {
  const anos = new Set<number>();
  for (const it of items) for (const d of get(it)) {
    const y = yearFromIso(d);
    if (y >= 2000 && y <= 2100) anos.add(y);
  }
  return Array.from(anos).sort((a, b) => b - a);
};
