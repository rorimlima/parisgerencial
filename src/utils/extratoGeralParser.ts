/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * extratoGeralParser.ts — Leitura do EXTRATO GERAL, o formato único de entrada
 * de extratos bancários e de caixa.
 *
 * POR QUE EXISTE UM FORMATO ÚNICO (leia antes de mexer)
 * ====================================================
 * Antes deste arquivo, cada fonte entrava por um caminho próprio: Bradesco em
 * XML do internet banking, PagBank em relatório .xlsx com metadados no topo,
 * caixa/tesouraria no RFN046/RFN019 do ERP. Três layouts, três parsers, três
 * jeitos de errar — e nenhuma forma de conferir o caixa da empresa num só
 * lugar sem antes cruzar três arquivos na mão.
 *
 * O EXTRATO GERAL resolve isso pelo lado certo: a normalização acontece FORA do
 * sistema, na planilha que a operação já mantém, e o sistema passa a ter uma só
 * porta de entrada. Oito colunas, nesta ordem:
 *
 *   ID          → nº da linha na planilha de origem (rastreabilidade)
 *   BANCO       → conta de origem do dinheiro (BRADESCO, PAGBANK, CAIXA30107...)
 *   LANCAMENTO  → histórico do movimento
 *   DATA        → data do lançamento
 *   ENTRADA     → valor recebido (positivo)
 *   SAIDA       → valor pago (NEGATIVO na planilha)
 *   TIPO        → ENTRADA | SAIDA (conferência, ver abaixo)
 *   CONTA       → BANCO | DINHEIRO
 *
 * O SINAL DO VALOR MANDA; "TIPO" É CONFERÊNCIA, NÃO COMANDO
 * ---------------------------------------------------------
 * Na planilha real, 14 linhas têm TIPO contradizendo o valor (ex.: um PIX de
 * R$ 2.000 na coluna ENTRADA marcado como SAIDA) e 31 têm TIPO vazio, 'NULO' ou
 * 'VERIFICAR'. Obedecer ao TIPO nesses casos inverteria o sinal de R$ 2.000 no
 * saldo do Bradesco — o extrato deixaria de fechar com o banco, que é a única
 * coisa que dá autoridade a este dado.
 *
 * Então a regra é: o valor decide (ENTRADA>0 → entrada; SAIDA<0 → saída) e o
 * TIPO é recalculado. Quando o TIPO da planilha discorda, a linha entra normal
 * mas fica marcada em `typeDivergence` e é listada na prévia da importação: o
 * número está certo, e o gestor ainda vê onde a planilha precisa de correção.
 *
 * LINHA SEM VALOR NÃO É LANÇAMENTO
 * --------------------------------
 * 33 linhas do arquivo não têm nem ENTRADA nem SAIDA: são "SALDO ANTERIOR" do
 * Bradesco e restos de "Saldo do dia" do PagBank. Saldo não é movimento; somar
 * ou até só gravar essas linhas polui a conciliação com lançamentos de valor
 * zero que nenhum título vai casar. São descartadas com motivo registrado.
 *
 * IDENTIDADE DA LINHA — POR QUE A CHAVE NÃO USA O "ID" DA PLANILHA
 * ---------------------------------------------------------------
 * O ID é o número da linha, e número de linha muda a cada reexportação: basta
 * inserir um lançamento em fevereiro para todo mundo depois dele mudar de ID. Se
 * a chave fosse o ID, a próxima importação gravaria a base inteira de novo, ao
 * lado da anterior — duplicidade total. Por isso a chave é o CONTEÚDO
 * (banco + data + histórico + valor) com contador de ocorrência para o caso
 * legítimo de dois lançamentos idênticos no mesmo dia, exatamente como já é
 * feito nos extratos bancários (ver statementKeys.ts). O ID vai gravado em
 * `documentRef`, para achar a linha na planilha quando alguém contestar um valor.
 */

import { StatementOrigin, StatementSource } from '../types';
import {
  buildExtratoGeralDedupeKey,
  extractCashAccountFromText,
  normalizeKeyText,
} from './statementKeys';

// ─── Cabeçalho esperado ──────────────────────────────────────────────────────

export const EXTRATO_GERAL_HEADERS = [
  'ID',
  'BANCO',
  'LANCAMENTO',
  'DATA',
  'ENTRADA',
  'SAIDA',
  'TIPO',
  'CONTA',
] as const;

/**
 * Aceita o cabeçalho com ou sem acento, maiúsculo ou minúsculo, e tolera
 * variações que a operação usa na prática ('LANÇAMENTO', 'SAÍDA').
 */
const HEADER_ALIASES: Record<string, string> = {
  id: 'ID',
  banco: 'BANCO',
  conta_banco: 'BANCO',
  lancamento: 'LANCAMENTO',
  historico: 'LANCAMENTO',
  descricao: 'LANCAMENTO',
  data: 'DATA',
  entrada: 'ENTRADA',
  entradas: 'ENTRADA',
  credito: 'ENTRADA',
  saida: 'SAIDA',
  saidas: 'SAIDA',
  debito: 'SAIDA',
  tipo: 'TIPO',
  conta: 'CONTA',
};

/** 'LANÇAMENTO' → 'lancamento'. Sem acento, sem espaço, minúsculo. */
const headerSlug = (raw: any): string =>
  normalizeKeyText(raw).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Reindexa a linha pelos nomes canônicos. Planilha exportada de fonte diferente
 * chega com o cabeçalho em outra grafia; sem esta camada o parser leria tudo
 * como vazio e descartaria o arquivo inteiro em silêncio.
 */
export const canonicalizeRow = (row: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const canon = HEADER_ALIASES[headerSlug(k)];
    if (canon && out[canon] === undefined) out[canon] = v;
  }
  return out;
};

/** Confere se a planilha tem as colunas indispensáveis antes de processar. */
export const validateExtratoGeralHeaders = (
  firstRow: Record<string, any>
): { ok: boolean; missing: string[] } => {
  const canon = canonicalizeRow(firstRow);
  const required = ['BANCO', 'DATA'];
  const missing = required.filter((c) => canon[c] === undefined);
  const hasValueColumn = canon['ENTRADA'] !== undefined || canon['SAIDA'] !== undefined;
  if (!hasValueColumn) missing.push('ENTRADA/SAIDA');
  return { ok: missing.length === 0, missing };
};

// ─── Contas: da coluna BANCO para a identidade do sistema ────────────────────

export interface ExtratoGeralAccount {
  /** Fonte do modelo do sistema — o que a tela e os filtros já conhecem. */
  source: StatementSource;
  /** 'banco' (Bradesco/PagBank) ou 'caixa' (dinheiro em espécie). */
  origin: StatementOrigin;
  /** Rótulo exibido na tela e no export. */
  label: string;
  /** Conta 301.xx, só para as contas de caixa. */
  accountCode?: string;
}

/**
 * BANCOS RECONHECIDOS.
 *
 * A decisão de projeto aqui é AGRUPAR: Bradesco e PagBank são banco; qualquer
 * caixa em espécie (CAIXA301xx, ALBA301xx, TESOURARIA) entra como
 * `source: 'tesouraria'` / `origin: 'caixa'`, guardando o código 301.xx em
 * `accountCode` e o nome próprio em `accountLabel`. Assim o Resultado Financeiro
 * continua separando "Entradas Bancos" de "Entradas Tesouraria" sem precisar de
 * um tipo novo a cada caixa que a empresa abrir, e o saldo de cada caixa segue
 * conferível pelo código.
 *
 * ALBA30110 e CAIXA30110 são a MESMA conta 301.10 com nomes operacionais
 * diferentes: o código é o mesmo, o rótulo preserva a origem.
 */
const BANK_MAP: Record<string, ExtratoGeralAccount> = {
  bradesco: { source: 'bradesco', origin: 'banco', label: 'Bradesco' },
  pagbank: { source: 'pagseguro', origin: 'banco', label: 'PagBank' },
  pagseguro: { source: 'pagseguro', origin: 'banco', label: 'PagBank' },
  tesouraria: { source: 'tesouraria', origin: 'caixa', label: 'Tesouraria 30101', accountCode: '30101' },
  caixa30101: { source: 'tesouraria', origin: 'caixa', label: 'Tesouraria 30101', accountCode: '30101' },
  caixa30107: { source: 'tesouraria', origin: 'caixa', label: 'Caixa 30107', accountCode: '30107' },
  caixa30108: { source: 'tesouraria', origin: 'caixa', label: 'Caixa 30108', accountCode: '30108' },
  caixa30110: { source: 'tesouraria', origin: 'caixa', label: 'Caixa 30110', accountCode: '30110' },
  alba30110: { source: 'tesouraria', origin: 'caixa', label: 'Alba 30110', accountCode: '30110' },
};

/** 'CAIXA 301.07' → 'caixa30107'. Tolera espaço, ponto e hífen. */
export const normalizeBankToken = (raw: any): string =>
  normalizeKeyText(raw).replace(/[^a-z0-9]+/g, '');

/**
 * Resolve a conta a partir da coluna BANCO.
 *
 * Banco desconhecido NÃO recebe palpite. Chutar 'banco' para um caixa (ou o
 * contrário) joga o dinheiro na linha errada do Resultado Financeiro, e o erro
 * só aparece meses depois, quando o gerencial não fecha. A linha é rejeitada com
 * o nome do banco no erro, para o gestor cadastrar aqui ou corrigir a planilha.
 */
export const resolveAccount = (banco: any, conta?: any): ExtratoGeralAccount | null => {
  const token = normalizeBankToken(banco);
  if (!token) return null;

  const direct = BANK_MAP[token];
  if (direct) return direct;

  // Conta de caixa nova (ex.: 'CAIXA30112' aberto no ERP depois desta lista):
  // o código 301.xx no nome é prova suficiente de que é caixa em espécie.
  const cashCode = extractCashAccountFromText(banco);
  if (cashCode) {
    const nome = (banco ?? '').toString().trim();
    return {
      source: 'tesouraria',
      origin: 'caixa',
      label: nome || `Caixa ${cashCode}`,
      accountCode: cashCode,
    };
  }

  // Último recurso: a própria planilha diz que é dinheiro na coluna CONTA.
  if (normalizeKeyText(conta) === 'dinheiro') {
    const nome = (banco ?? '').toString().trim();
    return { source: 'tesouraria', origin: 'caixa', label: nome || 'Caixa', accountCode: '' };
  }

  return null;
};

// ─── Datas e valores ─────────────────────────────────────────────────────────

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const monthKeyFromIso = (dateStr: string): string => {
  if (!dateStr) return '';
  const m = parseInt(dateStr.split('-')[1] || '', 10);
  return MONTH_KEYS[m - 1] || '';
};

/**
 * A data chega como Date (xlsx com cellDates), serial do Excel, ISO ou
 * DD/MM/AAAA, dependendo de quem salvou o arquivo. Tudo vira YYYY-MM-DD.
 */
export const normalizeExtratoDate = (raw: any): string => {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate()
      ).padStart(2, '0')}`;
    }
  }
  const s = raw.toString().trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }
  return '';
};

/**
 * Valor COM SINAL — diferente do `toAmount` do RFN019, que devolve módulo.
 *
 * Aqui o sinal é a informação principal: é ele que diz se o dinheiro entrou ou
 * saiu, já que a coluna SAIDA vem negativa e a coluna TIPO não é confiável.
 * Aceita 1.234,56 (pt-BR), 1234.56, (1.234,56) contábil e R$ na frente.
 */
export const toSignedAmount = (raw: any): number => {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return isFinite(raw) ? raw : 0;

  let s = raw.toString().trim().replace(/r\$\s*/i, '').replace(/\s/g, '');
  if (!s) return 0;

  // Parênteses = negativo no padrão contábil.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (s.includes(',') && s.includes('.')) {
    // '1.234,56' — ponto é milhar, vírgula é decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    // '1234,56'
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // '1.500' e '1.234.567': grupos de exatamente 3 dígitos depois do ponto só
    // existem como separador de milhar. Sem esta regra, '1.500' viraria R$ 1,50
    // — um erro de mil vezes no valor, e silencioso, porque 1,50 é um número
    // plausível para uma tarifa. '1.5' e '1.50' seguem como decimal.
    s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return negative ? -Math.abs(n) : n;
};

// ─── Saída do parser ─────────────────────────────────────────────────────────

export interface ExtratoGeralRow {
  /** Nº da linha na planilha (coluna ID), só para rastreabilidade. */
  sheetId: string;
  /** Nº da linha no arquivo lido — usado na prévia quando não há ID. */
  rowNumber: number;

  bankRaw: string;
  source: StatementSource;
  origin: StatementOrigin;
  sourceLabel: string;
  accountCode: string;
  accountLabel: string;

  date: string;
  year: number;
  monthKey: string;
  description: string;
  clientName: string;
  documentType: string;
  documentRef: string;

  entryAmount: number;
  exitAmount: number;
  /** Tipo derivado do sinal do valor — é este que vale. */
  derivedType: 'ENTRADA' | 'SAIDA';
  /** O que a planilha dizia na coluna TIPO (só para auditoria). */
  sheetType: string;
  /** true quando a coluna TIPO contradiz o sinal do valor. */
  typeDivergence: boolean;
  /** true quando a coluna CONTA contradiz a natureza do banco. */
  accountDivergence: boolean;

  notes: string;
  dedupeKey: string;
  isInternalTransfer: boolean;
  counterAccountCode: string;
  managementAccount: string;

  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Remanejo entre contas da própria casa (caixa ↔ tesouraria).
 *
 * Um real que sai do caixa 301.07 e entra na tesouraria 301.01 aparece DUAS
 * vezes na base; contar as duas como entrada infla o caixa com dinheiro que
 * nenhum cliente pagou. A regra: o histórico cita uma conta 301.xx DIFERENTE da
 * conta do próprio lançamento.
 *
 * A comparação com a própria conta é o detalhe que importa. 24 linhas do arquivo
 * têm como histórico apenas o nome da própria conta ('CAIXA30107' no extrato do
 * CAIXA30107) — isso não é transferência, é lançamento sem histórico, e tratá-lo
 * como remanejo apagaria R$ 101 mil de entrada de caixa do resultado. Essas
 * linhas entram normalmente e saem avisadas em `warnings`.
 */
export const detectInternalTransfer = (
  description: any,
  ownAccountCode: string
): { isTransfer: boolean; counterAccountCode: string } => {
  const cited = extractCashAccountFromText(description);
  if (!cited) return { isTransfer: false, counterAccountCode: '' };
  if (ownAccountCode && cited === ownAccountCode) return { isTransfer: false, counterAccountCode: '' };
  return { isTransfer: true, counterAccountCode: cited };
};

/**
 * Converte as linhas cruas do EXTRATO GERAL no modelo normalizado.
 *
 * Devolve TODAS as linhas, válidas e inválidas, com o motivo de cada rejeição.
 * A tela usa isso para mostrar a prévia antes de gravar; jogar as inválidas fora
 * aqui esconderia do gestor justamente as linhas que ele precisa corrigir.
 */
export const parseExtratoGeralRows = (rows: Record<string, any>[]): ExtratoGeralRow[] => {
  const out: ExtratoGeralRow[] = [];
  // Contador de ocorrência por chave-base: dois lançamentos idênticos no mesmo
  // dia são legítimos (duas tarifas iguais) e precisam de documentos separados.
  const seen = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const row = canonicalizeRow(raw);
    const rowNumber = idx + 2; // +1 do cabeçalho, +1 porque planilha começa em 1

    const errors: string[] = [];
    const warnings: string[] = [];

    const sheetId = (row['ID'] ?? '').toString().trim();
    const bankRaw = (row['BANCO'] ?? '').toString().trim();
    const description = (row['LANCAMENTO'] ?? '').toString().replace(/\s+/g, ' ').trim();
    const sheetType = (row['TIPO'] ?? '').toString().trim().toUpperCase();
    const contaRaw = (row['CONTA'] ?? '').toString().trim();

    const date = normalizeExtratoDate(row['DATA']);
    if (!date) errors.push('Data ausente ou inválida');

    // ── Valor: o sinal decide, o TIPO só confere ────────────────────────────
    const entradaRaw = toSignedAmount(row['ENTRADA']);
    const saidaRaw = toSignedAmount(row['SAIDA']);
    // Soma com sinal: cobre o caso da SAIDA vir negativa (padrão do arquivo),
    // da SAIDA vir positiva (outra exportação) e da ENTRADA vir negativa.
    const net =
      Math.round((entradaRaw + (saidaRaw > 0 && entradaRaw === 0 ? -saidaRaw : saidaRaw)) * 100) / 100;

    if (net === 0) {
      const rotulo = /saldo/i.test(description) ? 'Linha de saldo, não é lançamento' : 'Lançamento sem valor';
      errors.push(rotulo);
    }

    const entryAmount = net > 0 ? net : 0;
    const exitAmount = net < 0 ? Math.abs(net) : 0;
    const derivedType: 'ENTRADA' | 'SAIDA' = net >= 0 ? 'ENTRADA' : 'SAIDA';

    const typeDivergence =
      (sheetType === 'ENTRADA' || sheetType === 'SAIDA') && net !== 0 && sheetType !== derivedType;
    if (typeDivergence) {
      warnings.push(
        `Coluna TIPO diz ${sheetType}, mas o valor é de ${derivedType.toLowerCase()} — valeu o valor`
      );
    } else if (net !== 0 && sheetType && sheetType !== 'ENTRADA' && sheetType !== 'SAIDA') {
      warnings.push(`Coluna TIPO com valor não reconhecido ('${sheetType}') — tipo derivado do valor`);
    } else if (net !== 0 && !sheetType) {
      warnings.push('Coluna TIPO vazia — tipo derivado do valor');
    }

    // ── Conta de origem ─────────────────────────────────────────────────────
    const account = resolveAccount(bankRaw, contaRaw);
    if (!account) {
      errors.push(
        bankRaw
          ? `Banco/conta '${bankRaw}' não cadastrado — cadastre em extratoGeralParser.ts ou corrija a planilha`
          : 'Coluna BANCO vazia'
      );
    }

    const origin = account?.origin ?? 'banco';
    const contaNorm = normalizeKeyText(contaRaw);
    const accountDivergence =
      !!account &&
      ((contaNorm === 'dinheiro' && origin !== 'caixa') || (contaNorm === 'banco' && origin !== 'banco'));
    if (accountDivergence) {
      warnings.push(
        `Coluna CONTA diz '${contaRaw}', mas ${account?.label} é ${origin === 'banco' ? 'banco' : 'dinheiro'} — valeu o banco`
      );
    }

    const accountCode = account?.accountCode || '';
    const { isTransfer, counterAccountCode } = detectInternalTransfer(description, accountCode);

    if (!description) {
      warnings.push('Lançamento sem histórico');
    } else if (origin === 'caixa' && normalizeBankToken(description) === normalizeBankToken(bankRaw)) {
      warnings.push('Histórico é só o nome da própria conta — confira se é recebimento ou remanejo');
    }

    const dedupeBase = buildExtratoGeralDedupeKey({
      bank: bankRaw,
      date,
      description,
      netAmount: net,
    });
    const n = seen.get(dedupeBase) || 0;
    seen.set(dedupeBase, n + 1);

    out.push({
      sheetId,
      rowNumber,
      bankRaw,
      source: account?.source ?? 'bradesco',
      origin,
      sourceLabel: account?.label ?? bankRaw,
      accountCode,
      accountLabel: origin === 'caixa' ? account?.label ?? bankRaw : '',
      date,
      year: date ? parseInt(date.slice(0, 4), 10) : 0,
      monthKey: monthKeyFromIso(date),
      description,
      // No extrato geral o histórico É o nome do cliente na maioria das linhas
      // de caixa ('RICARDO BEZERRA FERNANDES'). Manter os dois campos com o
      // mesmo texto é o que permite ao motor de baixa achar o nome do título.
      clientName: description,
      documentType: derivedType === 'ENTRADA' ? 'Entrada' : 'Saída',
      // O ID da planilha vive aqui: não serve de chave (muda a cada exportação),
      // mas é o que localiza a linha original quando um valor é contestado.
      documentRef: sheetId,
      entryAmount,
      exitAmount,
      derivedType,
      sheetType,
      typeDivergence,
      accountDivergence,
      notes: '',
      dedupeKey: `${dedupeBase}#${n}`,
      isInternalTransfer: isTransfer,
      counterAccountCode,
      managementAccount: '',
      valid: errors.length === 0,
      errors,
      warnings,
    });
  });

  return out;
};

// ─── Resumo para a prévia e para o script de carga ───────────────────────────

export interface ExtratoGeralBankSummary {
  bank: string;
  label: string;
  origin: StatementOrigin;
  accountCode: string;
  count: number;
  entrada: number;
  saida: number;
  saldo: number;
}

export interface ExtratoGeralSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  entradaTotal: number;
  saidaTotal: number;
  saldo: number;
  periodStart: string;
  periodEnd: string;
  years: number[];
  byBank: ExtratoGeralBankSummary[];
  typeDivergences: ExtratoGeralRow[];
  accountDivergences: ExtratoGeralRow[];
  internalTransfers: { count: number; entrada: number; saida: number };
  discarded: { rowNumber: number; sheetId: string; bank: string; date: string; reason: string }[];
  duplicateKeys: number;
}

export const summarizeExtratoGeral = (rows: ExtratoGeralRow[]): ExtratoGeralSummary => {
  const valid = rows.filter((r) => r.valid);
  const invalid = rows.filter((r) => !r.valid);

  const byBank = new Map<string, ExtratoGeralBankSummary>();
  for (const r of valid) {
    const key = normalizeBankToken(r.bankRaw) || 'sem_banco';
    const cur =
      byBank.get(key) ||
      {
        bank: r.bankRaw,
        label: r.sourceLabel,
        origin: r.origin,
        accountCode: r.accountCode,
        count: 0,
        entrada: 0,
        saida: 0,
        saldo: 0,
      };
    cur.count += 1;
    cur.entrada += r.entryAmount;
    cur.saida += r.exitAmount;
    cur.saldo = cur.entrada - cur.saida;
    byBank.set(key, cur);
  }

  const dates = valid.map((r) => r.date).filter(Boolean).sort();
  const transfers = valid.filter((r) => r.isInternalTransfer);

  // Duas linhas com a MESMA chave final significariam um lançamento sobrescrito
  // pelo outro no banco. O contador de ocorrência existe para que isso seja
  // sempre zero; conferir aqui é o que garante que ele está funcionando.
  const keys = new Set(valid.map((r) => r.dedupeKey));

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    totalRows: rows.length,
    validRows: valid.length,
    invalidRows: invalid.length,
    entradaTotal: round(valid.reduce((a, r) => a + r.entryAmount, 0)),
    saidaTotal: round(valid.reduce((a, r) => a + r.exitAmount, 0)),
    saldo: round(valid.reduce((a, r) => a + r.entryAmount - r.exitAmount, 0)),
    periodStart: dates[0] || '',
    periodEnd: dates[dates.length - 1] || '',
    years: Array.from(new Set(valid.map((r) => r.year).filter(Boolean))).sort(),
    byBank: [...byBank.values()].sort((a, b) => b.count - a.count),
    typeDivergences: rows.filter((r) => r.typeDivergence),
    accountDivergences: rows.filter((r) => r.accountDivergence),
    internalTransfers: {
      count: transfers.length,
      entrada: round(transfers.reduce((a, r) => a + r.entryAmount, 0)),
      saida: round(transfers.reduce((a, r) => a + r.exitAmount, 0)),
    },
    discarded: invalid.map((r) => ({
      rowNumber: r.rowNumber,
      sheetId: r.sheetId,
      bank: r.bankRaw,
      date: r.date,
      reason: r.errors.join('; '),
    })),
    duplicateKeys: valid.length - keys.size,
  };
};

/**
 * Converte a linha do parser no documento do Extrato Financeiro.
 *
 * Uma função só, usada pela tela e pelo script de carga. Duas versões disso é
 * como a base ganha dois formatos para o mesmo lançamento — ver o comentário de
 * titulosMapping.ts, que existe pelo mesmo motivo.
 */
export const toStatementEntry = (r: ExtratoGeralRow) => ({
  origin: r.origin,
  source: r.source,
  sourceLabel: r.sourceLabel,
  date: r.date,
  year: r.year,
  monthKey: r.monthKey,
  description: r.description,
  clientName: r.clientName,
  documentType: r.documentType,
  documentRef: r.documentRef,
  entryAmount: r.entryAmount,
  exitAmount: r.exitAmount,
  notes: r.notes,
  dedupeKey: r.dedupeKey,
  accountCode: r.accountCode,
  accountLabel: r.accountLabel,
  managementAccount: r.managementAccount,
  isInternalTransfer: r.isInternalTransfer,
  counterAccountCode: r.counterAccountCode,
});
