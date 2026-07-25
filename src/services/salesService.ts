/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * salesService — Vendas de Produtos (RPR001)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ESTRATÉGIA DE ARMAZENAMENTO — igual à do Faturamento, e pelo mesmo motivo
 * ------------------------------------------------------------------------
 * O RPR001 tem ~16.600 linhas de item e cresce a cada mês. Guardar tudo numa
 * coleção única e varrê-la a cada abertura de tela custaria 16.600 leituras
 * por usuário por sessão. Então o detalhe é particionado por ano:
 *
 *   vendas_<ano>       detalhe item a item. Lido sob demanda, um ano por vez.
 *   vendas_resumo      1 documento por mês (`2026_jan`) — 12 leituras cobrem
 *                      o ano inteiro. É o que o painel lê por padrão.
 *   vendas_auditoria   1 documento por ano com o retrato dos apontamentos,
 *                      para o gestor ver o risco sem carregar o detalhe.
 *
 * IDEMPOTÊNCIA
 * ------------
 * Chave = `${NF_EmpresaCod}|${NF_Codigo}|${NFItem_Cod}`, validada contra o
 * arquivo real (16.593 linhas → 16.593 chaves distintas). Reimportar o mesmo
 * relatório ATUALIZA o que mudou e ACRESCENTA o que é novo; nunca duplica.
 * Antes de gravar comparamos um hash do conteúdo, então reimportar um arquivo
 * idêntico gera ZERO escritas — e zero custo.
 *
 * POR QUE PARTICIONAR POR ANO E NÃO POR MÊS: o gestor analisa margem em série
 * anual (2020→2026). Particionar por mês obrigaria 12 consultas para montar um
 * ano; por ano, é uma só. E o volume anual (~3.500 linhas) cabe folgado numa
 * leitura única.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { getFirestoreDb } from './firebaseService';
import { SaleItem, SalesMonthSummary, Seller } from '../types';

const SALES_SUMMARY_COLLECTION = 'vendas_resumo';
const SALES_AUDIT_COLLECTION = 'vendas_auditoria';
const BATCH_LIMIT = 450;

/** Nome da coleção de detalhe de um ano. */
export const salesCollectionForYear = (year: number) => `vendas_${year}`;

/** Sanitiza um valor para uso como ID de documento (sem '/', '#', '?', espaços). */
const sanitizeDocId = (raw: string): string =>
  (raw || '').toString().trim().replace(/[\/\\#?\s]+/g, '_').replace(/^_+|_+$/g, '') || 'sem_id';

async function commitInBatches(
  writes: { path: string; id: string; data: Record<string, any> }[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getFirestoreDb();
  let done = 0;
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const slice = writes.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    slice.forEach((w) => batch.set(doc(db, w.path, w.id), w.data, { merge: true }));
    await batch.commit();
    done += slice.length;
    onProgress?.(done, writes.length);
  }
  return done;
}

function contentHash(obj: Record<string, any>, fields: string[]): string {
  let h = 0;
  const s = fields.map((f) => String(obj[f] ?? '')).join('');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

/**
 * Campos que definem "a linha mudou". Deliberadamente inclui custo e margem:
 * o ERP reprocessa custo retroativamente quando uma entrada de mercadoria é
 * corrigida, e é exatamente essa mudança silenciosa que a auditoria precisa
 * capturar na reimportação.
 */
const SALE_HASH_FIELDS = [
  'netAmount', 'grossAmount', 'discountAmount', 'surchargeAmount', 'quantity',
  'unitPrice', 'lineCost', 'marginErp', 'status', 'issueDate', 'customerCode',
  'sellerCode', 'productCode', 'taxIcms', 'taxPisCofins',
];

// ═══════════════════════════════════════════════════════════════════════════
//  MAPEAMENTO ↔ FIRESTORE
// ═══════════════════════════════════════════════════════════════════════════

const saleToFirestore = (s: SaleItem): Record<string, any> => {
  const payload: Record<string, any> = {
    dedupe_key: s.dedupeKey,
    empresa_cod: s.companyCode,
    empresa_nome: s.companyName,
    nf_codigo: s.invoiceCode,
    nf_numero: s.invoiceNumber,
    nf_serie: s.invoiceSeries,
    nf_item_cod: s.itemCode,
    nf_status: s.status,
    tipo: s.movementType,
    origem: s.origin,
    nat_oper_cod: s.operationCode,
    nat_oper_des: s.operationDescription,
    moeda_cod: s.currencyCode,
    perc_nf: s.itemSharePercent,
    os_cod: s.osCode,
    os_num: s.osNumber,
    os_tipo: s.osType,
    os_tipo_des: s.osTypeDescription,
    os_valor: s.osValue,
    pedido_intermediario: s.intermediateOrder,
    cod_cliente: s.customerCode,
    cliente_nome: s.customerName,
    cliente_id: s.customerId || '',
    cond_pag_cod: s.paymentTermCode,
    cond_pag_des: s.paymentTermDescription,
    cod_vendedor: s.sellerCode,
    vendedor_nome: s.sellerName,
    produto_codigo: s.productCode,
    produto_descricao: s.productDescription,
    produto_marca_ref: s.brandReference,
    produto_tipo_cod: s.productTypeCode,
    produto_lucrat_letra: s.profitabilityLetter,
    produto_abc_estoque: s.abcStock,
    estoque_cod: s.stockCode,
    preco_tabela: s.listPrice,
    data_emissao: s.issueDate,
    data_movimento: s.movementDate,
    ano: s.year,
    mes: s.monthKey,
    quantidade: s.quantity,
    quantidade_estoque: s.stockQuantity,
    valor_unitario: s.unitPrice,
    valor_bruto_informado: s.reportedUnitGross,
    valor_bruto: s.grossAmount,
    valor_desconto: s.discountAmount,
    perc_desconto: s.discountPercent,
    perc_desconto_informado: s.reportedDiscountPercent,
    valor_acrescimo: s.surchargeAmount,
    valor_total: s.netAmount,
    custo_linha: s.lineCost,
    custo_unitario: s.unitCost,
    valor_icms: s.taxIcms,
    valor_icms_st: s.taxIcmsSt,
    valor_icms_difal: s.taxIcmsDifal,
    valor_pis: s.taxPis,
    valor_cofins: s.taxCofins,
    valor_pis_cofins: s.taxPisCofins,
    valor_iss: s.taxIss,
    valor_ipi: s.taxIpi,
    valor_impostos: s.taxTotal,
    margem_erp: s.marginErp,
    margem_erp_gerencial: s.marginErpManagerial,
    lucro_bruto_erp: s.grossProfitErp,
    perc_margem_erp: s.marginPercentErp,
    margem_calculada: s.marginCalculated,
    perc_margem_calculada: s.marginPercentCalculated,
    divergencia_margem: s.marginDivergence,
    importado_em: s.importedAt || new Date().toISOString(),
  };
  payload.hash = contentHash(s as any, SALE_HASH_FIELDS);
  return payload;
};

const saleFromFirestore = (id: string, d: any): SaleItem => ({
  id,
  dedupeKey: d.dedupe_key || id,
  companyCode: d.empresa_cod || '',
  companyName: d.empresa_nome || '',
  invoiceCode: d.nf_codigo || '',
  invoiceNumber: d.nf_numero || '',
  invoiceSeries: d.nf_serie || '',
  itemCode: d.nf_item_cod || '',
  status: d.nf_status || '',
  movementType: d.tipo || '',
  origin: d.origem || '',
  operationCode: d.nat_oper_cod || '',
  operationDescription: d.nat_oper_des || '',
  currencyCode: d.moeda_cod || '',
  itemSharePercent: d.perc_nf || 0,
  osCode: d.os_cod || '',
  osNumber: d.os_num || '',
  osType: d.os_tipo || '',
  osTypeDescription: d.os_tipo_des || '',
  osValue: d.os_valor || 0,
  intermediateOrder: d.pedido_intermediario || '',
  customerCode: d.cod_cliente || '',
  customerName: d.cliente_nome || '',
  customerId: d.cliente_id || undefined,
  paymentTermCode: d.cond_pag_cod || '',
  paymentTermDescription: d.cond_pag_des || '',
  sellerCode: d.cod_vendedor || '',
  sellerName: d.vendedor_nome || '',
  productCode: d.produto_codigo || '',
  productDescription: d.produto_descricao || '',
  brandReference: d.produto_marca_ref || '',
  productTypeCode: d.produto_tipo_cod || '',
  profitabilityLetter: d.produto_lucrat_letra || '',
  abcStock: d.produto_abc_estoque || '',
  stockCode: d.estoque_cod || '',
  listPrice: d.preco_tabela || 0,
  issueDate: d.data_emissao || '',
  movementDate: d.data_movimento || '',
  year: d.ano || 0,
  monthKey: d.mes || '',
  quantity: d.quantidade || 0,
  stockQuantity: d.quantidade_estoque || 0,
  unitPrice: d.valor_unitario || 0,
  reportedUnitGross: d.valor_bruto_informado || 0,
  grossAmount: d.valor_bruto || 0,
  discountAmount: d.valor_desconto || 0,
  discountPercent: d.perc_desconto || 0,
  reportedDiscountPercent: d.perc_desconto_informado || 0,
  surchargeAmount: d.valor_acrescimo || 0,
  netAmount: d.valor_total || 0,
  lineCost: d.custo_linha || 0,
  unitCost: d.custo_unitario || 0,
  taxIcms: d.valor_icms || 0,
  taxIcmsSt: d.valor_icms_st || 0,
  taxIcmsDifal: d.valor_icms_difal || 0,
  taxPis: d.valor_pis || 0,
  taxCofins: d.valor_cofins || 0,
  taxPisCofins: d.valor_pis_cofins || 0,
  taxIss: d.valor_iss || 0,
  taxIpi: d.valor_ipi || 0,
  taxTotal: d.valor_impostos || 0,
  marginErp: d.margem_erp || 0,
  marginErpManagerial: d.margem_erp_gerencial || 0,
  grossProfitErp: d.lucro_bruto_erp || 0,
  marginPercentErp: d.perc_margem_erp || 0,
  marginCalculated: d.margem_calculada || 0,
  marginPercentCalculated: d.perc_margem_calculada || 0,
  marginDivergence: d.divergencia_margem || 0,
  importedAt: d.importado_em || '',
});

const summaryToFirestore = (m: SalesMonthSummary): Record<string, any> => ({
  ano: m.year,
  mes: m.monthKey,
  mes_label: m.monthLabel,
  linhas: m.lines,
  notas: m.invoices,
  clientes: m.customers,
  produtos: m.products,
  valor_bruto: m.grossAmount,
  valor_desconto: m.discountAmount,
  perc_desconto: m.discountPercent,
  valor_total: m.netAmount,
  custo: m.costAmount,
  impostos: m.taxAmount,
  margem: m.marginAmount,
  perc_margem: m.marginPercent,
  linhas_negativas: m.negativeLines,
  valor_negativo: m.negativeAmount,
  por_vendedor: m.bySeller,
  por_origem: m.byOrigin,
  atualizado_em: new Date().toISOString(),
});

const summaryFromFirestore = (id: string, d: any): SalesMonthSummary => ({
  id,
  year: d.ano || 0,
  monthKey: d.mes || '',
  monthLabel: d.mes_label || '',
  lines: d.linhas || 0,
  invoices: d.notas || 0,
  customers: d.clientes || 0,
  products: d.produtos || 0,
  grossAmount: d.valor_bruto || 0,
  discountAmount: d.valor_desconto || 0,
  discountPercent: d.perc_desconto || 0,
  netAmount: d.valor_total || 0,
  costAmount: d.custo || 0,
  taxAmount: d.impostos || 0,
  marginAmount: d.margem || 0,
  marginPercent: d.perc_margem || 0,
  negativeLines: d.linhas_negativas || 0,
  negativeAmount: d.valor_negativo || 0,
  bySeller: d.por_vendedor || {},
  byOrigin: d.por_origem || {},
  updatedAt: d.atualizado_em || '',
});

// ═══════════════════════════════════════════════════════════════════════════
//  LEITURA
// ═══════════════════════════════════════════════════════════════════════════

/** Resumos mensais. Sem `year`, traz todos (uma leitura por mês existente). */
export const fetchSalesSummaries = async (year?: number): Promise<SalesMonthSummary[]> => {
  const db = getFirestoreDb();
  try {
    const snap = await getDocs(collection(db, SALES_SUMMARY_COLLECTION));
    const list = snap.docs.map((d) => summaryFromFirestore(d.id, d.data()));
    return (year ? list.filter((m) => m.year === year) : list);
  } catch (err) {
    console.error('Erro ao buscar resumos de vendas:', err);
    return [];
  }
};

/** Detalhe item a item de um ano. */
export const fetchSalesByYear = async (year: number): Promise<SaleItem[]> => {
  const db = getFirestoreDb();
  try {
    const snap = await getDocs(collection(db, salesCollectionForYear(year)));
    return snap.docs.map((d) => saleFromFirestore(d.id, d.data()));
  } catch (err) {
    console.error(`Erro ao buscar vendas de ${year}:`, err);
    return [];
  }
};

/** Anos que já têm detalhe gravado — descoberto a partir dos resumos. */
export const fetchSalesYears = async (): Promise<number[]> => {
  const sums = await fetchSalesSummaries();
  return [...new Set(sums.map((s) => s.year))].filter(Boolean).sort((a, b) => b - a);
};

// ═══════════════════════════════════════════════════════════════════════════
//  IMPORTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

export interface SalesImportResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: number;
  years: number[];
  netAmount: number;
}

/**
 * UPSERT das linhas de venda, particionando por ano de emissão.
 *
 * Linhas sem data de emissão válida caem em `vendas_0` em vez de serem
 * descartadas: perder faturamento por causa de uma célula de data corrompida
 * seria pior que guardá-lo num balde identificável para conserto posterior.
 */
export const upsertSalesBatch = async (
  items: SaleItem[],
  onProgress?: (stage: string, done: number, total: number) => void
): Promise<SalesImportResult> => {
  const result: SalesImportResult = { added: 0, updated: 0, unchanged: 0, errors: 0, years: [], netAmount: 0 };
  if (!items.length) return result;

  const byYear = new Map<number, SaleItem[]>();
  items.forEach((it) => {
    const y = it.year || 0;
    const arr = byYear.get(y) || [];
    arr.push(it);
    byYear.set(y, arr);
  });
  result.years = [...byYear.keys()].sort();

  const db = getFirestoreDb();
  const writes: { path: string; id: string; data: Record<string, any> }[] = [];

  for (const [year, list] of byYear) {
    const path = salesCollectionForYear(year);
    onProgress?.(`Lendo vendas de ${year}`, 0, list.length);

    // Uma leitura da partição do ano para saber o que já existe e com que
    // hash. É o que permite reimportar sem custo quando nada mudou.
    const existingHash = new Map<string, string>();
    try {
      const snap = await getDocs(collection(db, path));
      snap.forEach((d) => existingHash.set(d.id, d.data().hash || ''));
    } catch {
      /* coleção ainda não existe — primeira carga deste ano */
    }

    list.forEach((it) => {
      try {
        const id = sanitizeDocId(it.dedupeKey);
        const payload = saleToFirestore({ ...it, id });
        const prev = existingHash.get(id);
        if (prev === undefined) { result.added++; writes.push({ path, id, data: payload }); }
        else if (prev !== payload.hash) { result.updated++; writes.push({ path, id, data: payload }); }
        else { result.unchanged++; }
        result.netAmount += it.netAmount;
      } catch (err) {
        console.error('Erro no upsert de venda:', it.dedupeKey, err);
        result.errors++;
      }
    });
  }

  onProgress?.('Gravando vendas', 0, writes.length);
  await commitInBatches(writes, (d, t) => onProgress?.('Gravando vendas', d, t));

  return result;
};

/**
 * Grava os resumos mensais. Recebe-os prontos porque quem sabe consolidar é o
 * `salesAudit` — o serviço não deve reimplementar a regra de margem, senão
 * painel e banco começam a divergir na primeira mudança de fórmula.
 */
export const saveSalesSummaries = async (summaries: SalesMonthSummary[]): Promise<number> => {
  if (!summaries.length) return 0;
  const writes = summaries.map((m) => ({
    path: SALES_SUMMARY_COLLECTION,
    id: m.id,
    data: summaryToFirestore(m),
  }));
  return commitInBatches(writes);
};

/** Retrato dos apontamentos de um ano, para consulta barata pelo gestor. */
export interface SalesAuditSnapshot {
  year: number;
  totalRiskAmount: number;
  negativeMarginAmount: number;
  negativeMarginLines: number;
  excessDiscountAmount: number;
  excessDiscountLines: number;
  marginGapAmount: number;
  priceGapAmount: number;
  relatedPartyRevenue: number;
  thresholds: Record<string, number>;
  updatedAt: string;
}

export const saveSalesAuditSnapshot = async (snap: SalesAuditSnapshot): Promise<void> => {
  const db = getFirestoreDb();
  await setDoc(doc(db, SALES_AUDIT_COLLECTION, String(snap.year)), {
    ano: snap.year,
    risco_total: snap.totalRiskAmount,
    margem_negativa_valor: snap.negativeMarginAmount,
    margem_negativa_linhas: snap.negativeMarginLines,
    desconto_excedente_valor: snap.excessDiscountAmount,
    desconto_excedente_linhas: snap.excessDiscountLines,
    margem_faltante_valor: snap.marginGapAmount,
    preco_abaixo_mediana_valor: snap.priceGapAmount,
    parte_relacionada_receita: snap.relatedPartyRevenue,
    parametros: snap.thresholds,
    atualizado_em: snap.updatedAt,
  }, { merge: true });
};

export const fetchSalesAuditSnapshot = async (year: number): Promise<SalesAuditSnapshot | null> => {
  const db = getFirestoreDb();
  try {
    const snap = await getDoc(doc(db, SALES_AUDIT_COLLECTION, String(year)));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      year: d.ano || year,
      totalRiskAmount: d.risco_total || 0,
      negativeMarginAmount: d.margem_negativa_valor || 0,
      negativeMarginLines: d.margem_negativa_linhas || 0,
      excessDiscountAmount: d.desconto_excedente_valor || 0,
      excessDiscountLines: d.desconto_excedente_linhas || 0,
      marginGapAmount: d.margem_faltante_valor || 0,
      priceGapAmount: d.preco_abaixo_mediana_valor || 0,
      relatedPartyRevenue: d.parte_relacionada_receita || 0,
      thresholds: d.parametros || {},
      updatedAt: d.atualizado_em || '',
    };
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  SINCRONIZAÇÃO DA EQUIPE DE VENDAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cadastra na coleção `vendedores` todos os vendedores que aparecem nas vendas.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A inadimplência (RFN029) traz o vendedor por NOME, e o RPR001 traz por CÓDIGO
 * (`NF_VendedorCod`) e nome. Se o cadastro de vendedores estiver incompleto, o
 * título vencido não encontra dono: a cobrança fica órfã e a exposição por
 * vendedor sai subestimada. O relatório de vendas é a fonte mais confiável para
 * montar essa lista, porque é o ERP dizendo quem efetivamente emitiu nota.
 *
 * REGRA DE CASAMENTO (nesta ordem, e a ordem importa)
 * ---------------------------------------------------
 *  1. Por CÓDIGO normalizado — vínculo forte, é a chave do próprio ERP.
 *  2. Por NOME normalizado — recupera os cadastros antigos que foram criados à
 *     mão, sem código. Nesse caso o código do ERP é gravado no registro
 *     existente em vez de criar um duplicado.
 *
 * Vendedor que já existe NÃO é sobrescrito: e-mail, telefone e status podem ter
 * sido preenchidos à mão e não estão no relatório de vendas. A única coisa que
 * pode ser completada é o código, quando faltava.
 *
 * ID DETERMINÍSTICO (`vend_<codigo>`): reexecutar a sincronização é seguro —
 * nunca cria o mesmo vendedor duas vezes, mesmo se a leitura anterior falhou
 * no meio.
 */
export interface SellerSyncResult {
  created: { code: string; name: string; lines: number }[];
  /** Já existiam e foram deixados intactos. */
  existing: number;
  /** Existiam sem código e receberam o código do ERP. */
  codeFilled: { code: string; name: string }[];
  /**
   * Mesmo nome com mais de um código no ERP — cadastro duplicado na origem.
   * Não corrigimos automaticamente: fundir dois códigos é decisão de gestão,
   * e a fusão errada reatribui comissão e inadimplência para a pessoa errada.
   */
  duplicates: { name: string; codes: string[] }[];
  /** Vendedores do cadastro que não emitiram nenhuma nota no período lido. */
  inactiveInSales: { code: string; name: string }[];
}

const normCode = (s: string): string => {
  const v = (s ?? '').toString().trim();
  return /^\d+$/.test(v) ? String(parseInt(v, 10)) : v.toLowerCase();
};
const normSellerName = (s: string): string =>
  (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export const syncSellersFromSales = async (
  items: SaleItem[],
  existingSellers: Seller[]
): Promise<SellerSyncResult> => {
  const result: SellerSyncResult = {
    created: [], existing: 0, codeFilled: [], duplicates: [], inactiveInSales: [],
  };
  if (!items.length) return result;

  // ── 1. Levantar a equipe a partir das notas ──────────────────────────────
  const fromSales = new Map<string, { code: string; name: string; lines: number; lastSale: string }>();
  items.forEach((it) => {
    const code = (it.sellerCode || '').trim();
    const name = (it.sellerName || '').trim();
    if (!code && !name) return;
    const key = normCode(code) || normSellerName(name);
    const cur = fromSales.get(key) || { code, name, lines: 0, lastSale: '' };
    cur.lines++;
    if (it.issueDate > cur.lastSale) cur.lastSale = it.issueDate;
    if (!cur.name && name) cur.name = name;
    fromSales.set(key, cur);
  });

  // Mesmo nome em códigos diferentes → duplicidade na origem.
  const byName = new Map<string, Set<string>>();
  fromSales.forEach((v) => {
    const n = normSellerName(v.name);
    if (!n) return;
    const set = byName.get(n) || new Set<string>();
    if (v.code) set.add(v.code);
    byName.set(n, set);
  });
  byName.forEach((codes, name) => {
    if (codes.size > 1) result.duplicates.push({ name, codes: [...codes].sort() });
  });

  // ── 2. Índices do cadastro atual ─────────────────────────────────────────
  const existingByCode = new Map<string, Seller>();
  const existingByName = new Map<string, Seller>();
  existingSellers.forEach((s) => {
    const c = normCode(s.code);
    if (c) existingByCode.set(c, s);
    const n = normSellerName(s.name);
    if (n) existingByName.set(n, s);
  });

  // ── 3. Criar / completar ─────────────────────────────────────────────────
  const db = getFirestoreDb();
  const writes: { path: string; id: string; data: Record<string, any> }[] = [];
  const now = new Date().toISOString();
  const seenInSales = new Set<string>();

  for (const v of fromSales.values()) {
    const codeKey = normCode(v.code);
    const nameKey = normSellerName(v.name);
    if (codeKey) seenInSales.add(codeKey);
    if (nameKey) seenInSales.add(`n:${nameKey}`);

    const hitByCode = codeKey ? existingByCode.get(codeKey) : undefined;
    if (hitByCode) { result.existing++; continue; }

    const hitByName = nameKey ? existingByName.get(nameKey) : undefined;
    if (hitByName) {
      // Existe pelo nome mas sem o código do ERP: completar, não duplicar.
      if (!normCode(hitByName.code) && v.code) {
        writes.push({
          path: 'vendedores',
          id: hitByName.id,
          data: { codigo: v.code, origem_codigo: 'RPR001', atualizado_em: now },
        });
        result.codeFilled.push({ code: v.code, name: v.name });
      } else {
        result.existing++;
      }
      continue;
    }

    const id = v.code ? `vend_${normCode(v.code)}` : `vend_${nameKey.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    writes.push({
      path: 'vendedores',
      id,
      data: {
        codigo: v.code || '',
        nome: v.name || '(sem nome)',
        email: '',
        telefone: '',
        status: 'Ativo',
        origem: 'RPR001 — Vendas de Produtos',
        notas_no_periodo: v.lines,
        ultima_venda: v.lastSale,
        criado_em: now,
        atualizado_em: now,
      },
    });
    result.created.push({ code: v.code, name: v.name, lines: v.lines });
  }

  // ── 4. Quem está cadastrado mas não vendeu no período lido ───────────────
  // Não desativamos ninguém automaticamente: o recorte importado pode ser de
  // um único mês, e marcar como inativo quem só não vendeu em julho seria
  // errado. Apenas reportamos para o gestor decidir.
  existingSellers.forEach((s) => {
    const c = normCode(s.code);
    const n = normSellerName(s.name);
    if ((c && seenInSales.has(c)) || (n && seenInSales.has(`n:${n}`))) return;
    result.inactiveInSales.push({ code: s.code, name: s.name });
  });

  if (writes.length) {
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      writes.slice(i, i + BATCH_LIMIT).forEach((w) => batch.set(doc(db, w.path, w.id), w.data, { merge: true }));
      await batch.commit();
    }
  }

  return result;
};

/** Apaga o detalhe e os resumos de um ano (carga limpa). */
export const clearSalesYear = async (year: number): Promise<void> => {
  const db = getFirestoreDb();
  const snap = await getDocs(collection(db, salesCollectionForYear(year)));
  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(i, i + BATCH_LIMIT).forEach((id) => batch.delete(doc(db, salesCollectionForYear(year), id)));
    await batch.commit();
  }
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  for (const m of months) {
    try { await deleteDoc(doc(db, SALES_SUMMARY_COLLECTION, `${year}_${m}`)); } catch { /* não existia */ }
  }
  try { await deleteDoc(doc(db, SALES_AUDIT_COLLECTION, String(year))); } catch { /* não existia */ }
};
