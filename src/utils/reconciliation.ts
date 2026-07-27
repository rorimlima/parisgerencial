/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reconciliation.ts — Motor de baixa automática (título ⇄ extrato).
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ===========================
 * O ERP diz que o título foi pago; o banco diz que saiu dinheiro. Ninguém diz
 * que os dois são o mesmo evento. Sem essa amarração, o fluxo de caixa conta a
 * mesma saída duas vezes — uma pelo título, outra pelo extrato — e o saldo
 * projetado despenca sem que nada de errado tenha acontecido de verdade.
 *
 * Este módulo procura, para cada título, o lançamento de extrato que é ele.
 *
 * AS QUATRO EVIDÊNCIAS
 * --------------------
 * Nenhuma sozinha basta. Valor igual acontece o tempo todo (duas parcelas de
 * R$ 353,33 no mesmo dia); nome igual acontece com fornecedor recorrente; data
 * igual acontece com todo mundo que paga na sexta. O motor pontua as quatro e
 * só baixa sozinho quando a soma passa do corte:
 *
 *   VALOR (até 45 pts) — quanto mais perto do exato, mais pontos. Fora da
 *       tolerância configurada, o par nem é considerado: valor é eliminatório.
 *   DATA  (até 25 pts) — mesmo dia vale tudo; cada dia de distância derruba.
 *   NOME  (até 20 pts) — similaridade por tokens entre a pessoa do título e o
 *       texto do lançamento. Sobrenome comum não engana porque a régua é o
 *       conjunto de palavras, não a substring.
 *   TÍTULO (até 10 pts) — número do título / parcela / nosso número aparecendo
 *       dentro da descrição do extrato. É a prova mais forte quando existe, e
 *       por isso ganha bônus mesmo com o resto no limite.
 *
 * DIREÇÃO DO DINHEIRO É INEGOCIÁVEL
 * ---------------------------------
 * Título 'R' (receber) só casa com CRÉDITO no extrato; título 'P' (pagar) só
 * casa com DÉBITO. Sem essa trava, um recebimento de R$ 1.000 casaria com um
 * pagamento de R$ 1.000 no mesmo dia e o sistema daria baixa dos dois — com o
 * caixa parecendo certo e as duas contas erradas.
 *
 * CADA LADO SÓ USA UMA VEZ
 * ------------------------
 * Um lançamento de extrato não pode quitar dois títulos, nem um título ser
 * quitado por dois lançamentos. Os pares são ordenados por score e consumidos
 * de forma gulosa: o casamento mais evidente escolhe primeiro. É o que evita
 * que um par ruim roube o lançamento de um par perfeito.
 */

import {
  FinancialStatementEntry,
  ReconciliationMatch,
  ReconciliationSettings,
  TituloFinanceiro,
} from '../types';

// ─── Normalização de texto ───────────────────────────────────────────────────

/** Remove acento, pontuação e caixa — 'JOSÉ & CIA LTDA.' → 'jose cia ltda'. */
export const normalizeText = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Palavras que aparecem em quase todo nome de empresa e em quase toda descrição
 * de extrato. Mantê-las na comparação faria "ME LTDA" casar com "EIRELI LTDA"
 * com 50% de similaridade — ruído puro.
 */
const STOPWORDS = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'cia', 'com', 'comercio', 'e', 'de', 'da', 'do', 'das', 'dos',
  'pix', 'ted', 'doc', 'transferencia', 'pagamento', 'pago', 'recebido', 'enviado', 'credito', 'debito',
  'titulo', 'boleto', 'cobranca', 'liquidacao', 'deposito', 'ref', 'referente', 'valor', 'conta', 'banco',
]);

const tokenize = (s: string): Set<string> =>
  new Set(
    normalizeText(s)
      .split(' ')
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );

/**
 * Similaridade de nomes (0–100) pelo coeficiente de Dice sobre tokens.
 *
 * Por que tokens e não Levenshtein: o extrato não escreve o nome errado, ele
 * escreve um PEDAÇO do nome ('PIX ENVIADO DKAR RODAS'). Distância de edição
 * pune o texto extra e daria similaridade baixa para um casamento perfeito;
 * sobreposição de palavras premia exatamente o que interessa.
 */
export const nameSimilarity = (a: string, b: string): number => {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter += 1;
  });
  return Math.round((200 * inter) / (ta.size + tb.size));
};

/** Data ISO → milissegundos, sem passar por fuso (evita o erro de 1 dia). */
const toTime = (iso: string): number => {
  if (!iso || iso.length < 10) return NaN;
  return new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();
};

const daysBetween = (a: string, b: string): number => {
  const ta = toTime(a);
  const tb = toTime(b);
  if (isNaN(ta) || isNaN(tb)) return NaN;
  return Math.abs(ta - tb) / 86400000;
};

/**
 * Procura o número do título / parcela / nosso número dentro do texto do
 * lançamento. Só considera sequências de 4+ dígitos: com 3 ou menos, qualquer
 * data ou valor no meio da descrição daria falso positivo.
 */
export const findTitleInDescription = (t: TituloFinanceiro, text: string): boolean => {
  const digits = normalizeText(text).replace(/\D+/g, ' ');
  const haystack = ` ${digits} `;
  const needles = [t.titleNumber, t.titleCode, t.nossoNumero, (t.parcela || '').split('-')[0], t.invoiceCode]
    .map((n) => (n || '').replace(/\D+/g, ''))
    .filter((n) => n.length >= 4);
  return needles.some((n) => haystack.includes(` ${n} `));
};

// ─── Pontuação de um par ─────────────────────────────────────────────────────

const PESO_VALOR = 45;
const PESO_DATA = 25;
const PESO_NOME = 20;
const PESO_TITULO = 10;

/**
 * A data de referência do título para bater com o extrato: o pagamento, quando
 * existe. Título pago sem data cai no vencimento — impreciso, mas é o único
 * ancoradouro disponível e a janela de dias cobre o resto.
 */
export const tituloCashDate = (t: TituloFinanceiro): string => t.paymentDate || t.dueDate;

/** O valor que deve aparecer no extrato: o pago (amount) ou o saldo em aberto. */
export const tituloCashAmount = (t: TituloFinanceiro): number =>
  t.isPaid ? t.amount || t.balance : t.balance || t.amount;

const scorePair = (
  t: TituloFinanceiro,
  e: FinancialStatementEntry,
  cfg: ReconciliationSettings
): ReconciliationMatch | null => {
  const tAmount = tituloCashAmount(t);
  const eAmount = t.movType === 'R' ? e.entryAmount : e.exitAmount;
  if (!(tAmount > 0) || !(eAmount > 0)) return null;

  // ── Valor: eliminatório ────────────────────────────────────────────────────
  const diff = Math.abs(tAmount - eAmount);
  const allowed = Math.max(cfg.amountToleranceAbs, (tAmount * cfg.amountTolerancePercent) / 100);
  if (diff > allowed + 1e-9) return null;
  const valorScore = allowed <= 0 ? PESO_VALOR : PESO_VALOR * (1 - Math.min(1, diff / allowed));

  // ── Data: eliminatória ─────────────────────────────────────────────────────
  const refDate = tituloCashDate(t);
  const dDays = daysBetween(refDate, e.date);
  if (isNaN(dDays) || dDays > cfg.dateWindowDays) return null;
  const dataScore = cfg.dateWindowDays <= 0 ? PESO_DATA : PESO_DATA * (1 - dDays / (cfg.dateWindowDays + 1));

  // ── Nome: confirmação ──────────────────────────────────────────────────────
  const nameText = `${e.clientName || ''} ${e.description || ''}`;
  const sim = nameSimilarity(t.personName, nameText);
  const nameOk = sim >= cfg.minNameSimilarity;
  const nomeScore = (PESO_NOME * Math.min(100, sim)) / 100;

  // ── Número do título: prova documental ─────────────────────────────────────
  const titleHit = findTitleInDescription(t, `${e.description || ''} ${e.documentRef || ''} ${e.notes || ''}`);
  const tituloScore = titleHit ? PESO_TITULO : 0;

  if (cfg.requireNameMatch && !nameOk && !titleHit) return null;

  const score = Math.round(valorScore + dataScore + nomeScore + tituloScore);

  const partes: string[] = [
    diff === 0 ? 'valor exato' : `valor com diferença de R$ ${diff.toFixed(2)}`,
    dDays === 0 ? 'mesma data' : `${Math.round(dDays)} dia(s) de diferença`,
  ];
  if (sim > 0) partes.push(`nome ${sim}% compatível`);
  if (titleHit) partes.push('nº do título citado no extrato');

  return {
    tituloId: t.id,
    titleCode: t.titleCode,
    movType: t.movType,
    statementId: e.id,
    statementSource: e.sourceLabel || e.source,
    statementDate: e.date,
    statementDescription: e.description || e.clientName || '',
    tituloAmount: tAmount,
    statementAmount: eAmount,
    amountDiff: diff,
    daysDiff: Math.round(dDays),
    nameSimilarity: sim,
    titleInDescription: titleHit,
    score,
    reason: `${e.sourceLabel || e.source}: ${partes.join(', ')}`,
    decision: score >= cfg.autoMatchMinScore ? 'auto' : 'sugestao',
  };
};

// ─── Motor ───────────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  auto: ReconciliationMatch[];
  suggestions: ReconciliationMatch[];
  /** Títulos que não acharam nenhum candidato dentro dos parâmetros. */
  unmatchedTitulos: TituloFinanceiro[];
  stats: {
    titulosConsiderados: number;
    lancamentosDisponiveis: number;
    autoCount: number;
    autoAmount: number;
    sugestaoCount: number;
    sugestaoAmount: number;
    semParCount: number;
    semParAmount: number;
  };
}

/**
 * Concilia uma lista de títulos contra o extrato.
 *
 * AS DUAS LISTAS PRECISAM VIR COMPLETAS (todos os anos). Um título pago em
 * 30/12 compensa no extrato em 03/01 — ano diferente. Filtrando por ano, esse
 * título nunca acha o par e fica "Em Aberto" para sempre; pior, um lançamento
 * já usado numa baixa de outro ano não entraria em `usados` e seria vinculado
 * uma segunda vez, com a mesma saída quitando dois títulos.
 */
export const reconcile = (
  titulos: TituloFinanceiro[],
  entries: FinancialStatementEntry[],
  cfg: ReconciliationSettings
): ReconciliationResult => {
  // Só títulos que o ERP já deu por movimentados e que ainda não têm baixa.
  const pendentes = titulos.filter((t) => t.isPaid && t.status === 'Em Aberto');

  // Lançamentos já amarrados a algum título saem do jogo.
  const usados = new Set(
    titulos.map((t) => t.reconciledStatementId).filter((id): id is string => !!id)
  );
  const disponiveis = entries.filter(
    (e) => !usados.has(e.id) && !e.isInternalTransfer && (e.entryAmount > 0 || e.exitAmount > 0)
  );

  // Índice por valor em centavos. Sem ele, 400 títulos × 8.000 lançamentos são
  // 3,2 milhões de comparações a cada clique; com ele, cada título olha só o
  // punhado de lançamentos que tem valor compatível.
  const porCentavo = new Map<number, FinancialStatementEntry[]>();
  const push = (cents: number, e: FinancialStatementEntry) => {
    const b = porCentavo.get(cents);
    if (b) b.push(e);
    else porCentavo.set(cents, [e]);
  };
  for (const e of disponiveis) {
    if (e.entryAmount > 0) push(Math.round(e.entryAmount * 100), e);
    if (e.exitAmount > 0) push(Math.round(e.exitAmount * 100), e);
  }

  const candidatos: ReconciliationMatch[] = [];
  const comCandidato = new Set<string>();

  for (const t of pendentes) {
    const alvo = tituloCashAmount(t);
    if (!(alvo > 0)) continue;
    const centavos = Math.round(alvo * 100);
    const janela = Math.ceil(
      Math.max(cfg.amountToleranceAbs, (alvo * cfg.amountTolerancePercent) / 100) * 100
    );

    // Varre só as faixas de centavos dentro da tolerância. Acima de 5 reais de
    // tolerância isso viraria varredura pesada, então cai para o caminho longo.
    const vistos = new Set<string>();
    const buckets: FinancialStatementEntry[] = [];
    if (janela <= 500) {
      for (let d = -janela; d <= janela; d++) {
        const b = porCentavo.get(centavos + d);
        if (b) for (const e of b) if (!vistos.has(e.id)) { vistos.add(e.id); buckets.push(e); }
      }
    } else {
      for (const e of disponiveis) buckets.push(e);
    }

    for (const e of buckets) {
      const m = scorePair(t, e, cfg);
      if (m && m.score >= cfg.suggestionMinScore) {
        candidatos.push(m);
        comCandidato.add(t.id);
      }
    }
  }

  // Guloso por score: o par mais evidente escolhe primeiro e trava os dois lados.
  candidatos.sort((a, b) => b.score - a.score || a.daysDiff - b.daysDiff || a.amountDiff - b.amountDiff);

  const tituloTravado = new Set<string>();
  const lancamentoTravado = new Set<string>();
  const auto: ReconciliationMatch[] = [];
  const suggestions: ReconciliationMatch[] = [];

  for (const c of candidatos) {
    if (tituloTravado.has(c.tituloId) || lancamentoTravado.has(c.statementId)) continue;
    tituloTravado.add(c.tituloId);
    lancamentoTravado.add(c.statementId);
    if (c.decision === 'auto') auto.push(c);
    else suggestions.push(c);
  }

  const unmatchedTitulos = pendentes.filter((t) => !tituloTravado.has(t.id));
  const soma = (arr: ReconciliationMatch[]) => arr.reduce((a, m) => a + m.tituloAmount, 0);

  return {
    auto,
    suggestions,
    unmatchedTitulos,
    stats: {
      titulosConsiderados: pendentes.length,
      lancamentosDisponiveis: disponiveis.length,
      autoCount: auto.length,
      autoAmount: soma(auto),
      sugestaoCount: suggestions.length,
      sugestaoAmount: soma(suggestions),
      semParCount: unmatchedTitulos.length,
      semParAmount: unmatchedTitulos.reduce((a, t) => a + tituloCashAmount(t), 0),
    },
  };
};

/** Código legível da baixa, para rastrear a conciliação no histórico. */
export const buildBaixaCode = (movType: 'R' | 'P', year: number, seq: number): string =>
  `${movType === 'R' ? 'RC' : 'BX'}-${year}-${String(seq).padStart(5, '0')}`;
