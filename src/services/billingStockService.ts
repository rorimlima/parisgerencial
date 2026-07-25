/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * billingStockService — Faturamento (RPR014) e Estoque / Lista de Preço (RPR053)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ESTRATÉGIA DE ARMAZENAMENTO (híbrida: detalhe particionado + agregados)
 * ---------------------------------------------------------------------
 * O RPR014 tem ~29.000 linhas. Guardar tudo em uma coleção única e ler tudo a
 * cada abertura de tela custaria 29.000 leituras por usuário por sessão — foi
 * exatamente esse padrão que estourou a cota do Firestore antes. Por isso:
 *
 *   faturamento_<ano>    detalhe nota a nota, particionado por ano.
 *                        Só é lido quando o usuário abre o ano ou pede o
 *                        detalhe de um cliente.
 *   faturamento_resumo   1 documento por mês (`2026_jan`). 12 leituras cobrem
 *                        um ano inteiro. É o que as telas leem por padrão.
 *   faturamento_cliente  1 documento por PessoaCod — a ponte com o cadastro de
 *                        clientes (cod_cliente) e com a inadimplência.
 *   estoque              1 documento por Produto_Codigo.
 *   estoque_resumo/atual retrato consolidado do estoque (1 leitura).
 *
 * IDEMPOTÊNCIA (não duplicar: adicionar ou editar)
 * -----------------------------------------------
 * Toda linha tem uma `dedupeKey` determinística que vira o ID do documento:
 *   • Faturamento: `${EmpresaCod}|${NotaFiscalCod}|${SeqOrder}`
 *     (a nota sozinha NÃO serve de chave — a mesma nota aparece em várias
 *      linhas quebradas por CFOP/conta gerencial)
 *   • Estoque: `Produto_Codigo`
 *
 * Reimportar a mesma planilha, ou uma planilha que se sobrepõe a outra já
 * carregada, portanto: ATUALIZA o que mudou e ACRESCENTA o que é novo, nunca
 * duplica. Além disso comparamos um hash do conteúdo antes de gravar, então
 * reimportar um arquivo idêntico gera ZERO escritas.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';
import { getFirestoreDb } from './firebaseService';
import {
  BillingCustomerSummary,
  BillingMonthSummary,
  InvoiceRecord,
  StockItem,
  StockSummary,
} from '../types';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const BILLING_SUMMARY_COLLECTION = 'faturamento_resumo';
const BILLING_CUSTOMER_COLLECTION = 'faturamento_cliente';
const STOCK_COLLECTION = 'estoque';
const STOCK_SUMMARY_COLLECTION = 'estoque_resumo';
const STOCK_SUMMARY_DOC = 'atual';

/** Nome da coleção de detalhe de um ano. */
export const billingCollectionForYear = (year: number) => `faturamento_${year}`;

/** Sanitiza um valor para uso como ID de documento (sem '/', '#', '?', espaços). */
const sanitizeDocId = (raw: string): string =>
  (raw || '').toString().trim().replace(/[\/\\#?\s]+/g, '_').replace(/^_+|_+$/g, '') || 'sem_id';

/** Limite de operações por batch do Firestore (o teto real é 500). */
const BATCH_LIMIT = 450;

/**
 * Quantos lotes viajam simultaneamente.
 *
 * O gargalo da importação nunca foi o Firestore processar a escrita — é a
 * LATÊNCIA. Um `commit()` leva ~400–800 ms de ida e volta independentemente de
 * conter 1 ou 450 documentos. Com 29.320 notas são 66 lotes; em série isso dá
 * 30 a 50 segundos parados esperando rede, com a CPU ociosa.
 *
 * Seis em paralelo transformam 66 viagens sequenciais em ~11 ondas. Por que
 * seis e não trinta: o Firestore aplica backpressure por conexão e, acima de
 * ~10 commits concorrentes, começa a devolver RESOURCE_EXHAUSTED em vez de
 * ficar mais rápido. Seis é a faixa em que ganho de tempo e estabilidade ainda
 * andam juntos.
 */
const BATCH_CONCURRENCY = 6;

/**
 * Grava um conjunto de documentos em lotes PARALELOS.
 *
 * O progresso é reportado a cada lote concluído, não ao final — importação de
 * dezenas de milhares de linhas sem sinal de vida é indistinguível de
 * travamento, e o usuário fecha a aba no meio, deixando a base pela metade.
 *
 * Um lote que falha é reprocessado uma vez antes de propagar o erro: falha de
 * rede momentânea em 1 de 66 lotes não deve perder a importação inteira.
 */
async function commitInBatches(
  writes: { path: string; id: string; data: Record<string, any> }[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  if (!writes.length) return 0;
  const db = getFirestoreDb();

  // Fatia o trabalho em lotes antes de disparar, para que os workers só
  // precisem consumir de um índice compartilhado.
  const chunks: typeof writes[] = [];
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    chunks.push(writes.slice(i, i + BATCH_LIMIT));
  }

  let done = 0;
  let next = 0;

  const commitChunk = async (chunk: typeof writes): Promise<void> => {
    const run = async () => {
      const batch = writeBatch(db);
      chunk.forEach((w) => batch.set(doc(db, w.path, w.id), w.data, { merge: true }));
      await batch.commit();
    };
    try {
      await run();
    } catch (err) {
      console.warn('Lote falhou, tentando uma segunda vez:', err);
      await new Promise((r) => setTimeout(r, 800));
      await run();
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++;
      if (idx >= chunks.length) return;
      await commitChunk(chunks[idx]);
      done += chunks[idx].length;
      onProgress?.(done, writes.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, () => worker())
  );

  return done;
}

/**
 * Hash estável e barato do conteúdo relevante de um registro. Serve para
 * decidir "mudou ou não mudou" sem comparar campo a campo, evitando escritas
 * inúteis (e cobradas) quando a planilha reimportada é idêntica.
 */
function contentHash(obj: Record<string, any>, fields: string[]): string {
  let h = 0;
  const s = fields.map((f) => String(obj[f] ?? '')).join('');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

const INVOICE_HASH_FIELDS = [
  'totalValue', 'status', 'issueDate', 'personCode', 'sellerName', 'cfop',
  'cancelDate', 'totalIcms', 'totalIss', 'totalPis', 'totalCofins', 'totalIpi',
  'managerialAccountCode', 'documentTypeCode', 'marketSegmentCode',
];

const STOCK_HASH_FIELDS = [
  'availableQty', 'replacementCost', 'salePrice', 'publicPrice', 'warrantyPrice',
  'productDescription', 'locationIdentifier', 'abcStock', 'abcSales', 'abcPopularity',
  'productTypeDescription', 'brandReference', 'unit',
];

// ═══════════════════════════════════════════════════════════════════════════
//  FATURAMENTO
// ═══════════════════════════════════════════════════════════════════════════

const invoiceToFirestore = (inv: InvoiceRecord): Record<string, any> => ({
  dedupe_key: inv.dedupeKey,
  empresa_cod: inv.companyCode,
  empresa_nome: inv.companyName,
  nota_cod: inv.invoiceCode,
  nota_num: inv.invoiceNumber,
  nota_serie: inv.invoiceSeries,
  seq_order: inv.seqOrder,
  pessoa_cod: inv.personCode,
  pessoa_nome: inv.personName,
  pessoa_documento: inv.personDocument,
  pessoa_rg_ie: inv.personDocRgIe,
  pessoa_tipo_end_relac: inv.personAddressRelType,
  cliente_id: inv.customerId || '',
  end_tipo_logradouro: inv.addressStreetType,
  end_logradouro: inv.addressStreet,
  end_numero: inv.addressNumber,
  end_municipio: inv.addressCity,
  end_estado: inv.addressState,
  natureza_cod: inv.operationCode,
  natureza_descr: inv.operationDescription,
  departamento_cod: inv.departmentCode,
  departamento_descr: inv.departmentDescription,
  departamento_sigla: inv.departmentAcronym,
  cond_pagamento_cod: inv.paymentTermCode,
  cond_pagamento_descr: inv.paymentTermDescription,
  tipo_documento_cod: inv.documentTypeCode,
  tipo_documento_descr: inv.documentTypeDescription,
  segmento_cod: inv.marketSegmentCode,
  segmento_descr: inv.marketSegmentDescription,
  os_cod: inv.serviceOrderCode,
  origem: inv.origin,
  nota_propria: inv.isOwnInvoice,
  status: inv.status,
  movimento: inv.movement,
  funcionario_cod: inv.employeeCode,
  funcionario_nome: inv.employeeName,
  vendedor_cod: inv.sellerCode,
  vendedor_nome: inv.sellerName,
  data_emissao: inv.issueDate,
  data_movimento: inv.movementDate,
  data_cadastro: inv.registerDate,
  data_cadastro_hora: inv.registerDateTime,
  data_cancelamento: inv.cancelDate,
  ano: inv.year,
  mes: inv.monthKey,
  valor_total: inv.totalValue,
  cfop: inv.cfop,
  chave_nfe: inv.nfeKey,
  total_icms: inv.totalIcms,
  total_icms_st: inv.totalIcmsSt,
  total_iss: inv.totalIss,
  total_pis: inv.totalPis,
  total_ipi: inv.totalIpi,
  total_cofins: inv.totalCofins,
  total_csll: inv.totalCsll,
  conta_gerencial_cod: inv.managerialAccountCode,
  conta_gerencial_descr: inv.managerialAccountName,
  conta_gerencial_ident: inv.managerialAccountIdent,
  usuario_cancelamento: inv.cancelUserName,
  obs_cancelamento: inv.cancelNotes,
  hash: contentHash(inv as any, INVOICE_HASH_FIELDS),
  importado_em: inv.importedAt || new Date().toISOString(),
});

const invoiceFromFirestore = (id: string, d: any): InvoiceRecord => ({
  id,
  dedupeKey: d.dedupe_key || id,
  companyCode: d.empresa_cod || '',
  companyName: d.empresa_nome || '',
  invoiceCode: d.nota_cod || '',
  invoiceNumber: d.nota_num || '',
  invoiceSeries: d.nota_serie || '',
  seqOrder: d.seq_order || 0,
  personCode: d.pessoa_cod || '',
  personName: d.pessoa_nome || '',
  personDocument: d.pessoa_documento || '',
  personDocRgIe: d.pessoa_rg_ie || '',
  personAddressRelType: d.pessoa_tipo_end_relac || '',
  customerId: d.cliente_id || '',
  addressStreetType: d.end_tipo_logradouro || '',
  addressStreet: d.end_logradouro || '',
  addressNumber: d.end_numero || '',
  addressCity: d.end_municipio || '',
  addressState: d.end_estado || '',
  operationCode: d.natureza_cod || '',
  operationDescription: d.natureza_descr || '',
  departmentCode: d.departamento_cod || '',
  departmentDescription: d.departamento_descr || '',
  departmentAcronym: d.departamento_sigla || '',
  paymentTermCode: d.cond_pagamento_cod || '',
  paymentTermDescription: d.cond_pagamento_descr || '',
  documentTypeCode: d.tipo_documento_cod || '',
  documentTypeDescription: d.tipo_documento_descr || '',
  marketSegmentCode: d.segmento_cod || '',
  marketSegmentDescription: d.segmento_descr || '',
  serviceOrderCode: d.os_cod || '',
  origin: d.origem || '',
  isOwnInvoice: !!d.nota_propria,
  status: d.status || '',
  movement: d.movimento || '',
  employeeCode: d.funcionario_cod || '',
  employeeName: d.funcionario_nome || '',
  sellerCode: d.vendedor_cod || '',
  sellerName: d.vendedor_nome || '',
  issueDate: d.data_emissao || '',
  movementDate: d.data_movimento || '',
  registerDate: d.data_cadastro || '',
  registerDateTime: d.data_cadastro_hora || '',
  cancelDate: d.data_cancelamento || '',
  year: d.ano || 0,
  monthKey: d.mes || '',
  totalValue: d.valor_total || 0,
  cfop: d.cfop || '',
  nfeKey: d.chave_nfe || '',
  totalIcms: d.total_icms || 0,
  totalIcmsSt: d.total_icms_st || 0,
  totalIss: d.total_iss || 0,
  totalPis: d.total_pis || 0,
  totalIpi: d.total_ipi || 0,
  totalCofins: d.total_cofins || 0,
  totalCsll: d.total_csll || 0,
  managerialAccountCode: d.conta_gerencial_cod || '',
  managerialAccountName: d.conta_gerencial_descr || '',
  managerialAccountIdent: d.conta_gerencial_ident || '',
  cancelUserName: d.usuario_cancelamento || '',
  cancelNotes: d.obs_cancelamento || '',
  importedAt: d.importado_em || '',
});

/** Lê os resumos mensais de faturamento. 12 documentos por ano — leve. */
export const fetchBillingSummaries = async (year?: number): Promise<BillingMonthSummary[]> => {
  try {
    const db = getFirestoreDb();
    const ref = collection(db, BILLING_SUMMARY_COLLECTION);
    const snap = await getDocs(year ? query(ref, where('ano', '==', year)) : ref);
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        year: x.ano || 0,
        monthKey: x.mes || '',
        monthLabel: x.mes_label || '',
        grossRevenue: x.receita_bruta || 0,
        invoiceCount: x.qtd_notas || 0,
        lineCount: x.qtd_linhas || 0,
        customerCount: x.qtd_clientes || 0,
        averageTicket: x.ticket_medio || 0,
        taxTotal: x.total_impostos || 0,
        canceledValue: x.valor_cancelado || 0,
        bySeller: x.por_vendedor || {},
        bySegment: x.por_segmento || {},
        byDocumentType: x.por_tipo_documento || {},
        byCompany: x.por_empresa || {},
        updatedAt: x.atualizado_em || '',
      } as BillingMonthSummary;
    });
  } catch (err) {
    console.error('Erro ao buscar resumos de faturamento:', err);
    return [];
  }
};

/** Lê o consolidado por cliente — usado no cruzamento com inadimplência. */
export const fetchBillingCustomers = async (): Promise<BillingCustomerSummary[]> => {
  try {
    const db = getFirestoreDb();
    const snap = await getDocs(collection(db, BILLING_CUSTOMER_COLLECTION));
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        personCode: x.pessoa_cod || d.id,
        personName: x.pessoa_nome || '',
        personDocument: x.pessoa_documento || '',
        customerId: x.cliente_id || '',
        totalRevenue: x.receita_total || 0,
        revenueByYear: x.receita_por_ano || {},
        invoiceCount: x.qtd_notas || 0,
        firstPurchaseDate: x.primeira_compra || '',
        lastPurchaseDate: x.ultima_compra || '',
        mainSeller: x.vendedor_principal || '',
        city: x.cidade || '',
        state: x.estado || '',
        updatedAt: x.atualizado_em || '',
      } as BillingCustomerSummary;
    });
  } catch (err) {
    console.error('Erro ao buscar faturamento por cliente:', err);
    return [];
  }
};

/** Lê o detalhe (nota a nota) de um ano. Chamado sob demanda, nunca no boot. */
export const fetchInvoicesByYear = async (year: number): Promise<InvoiceRecord[]> => {
  try {
    const db = getFirestoreDb();
    const snap = await getDocs(collection(db, billingCollectionForYear(year)));
    return snap.docs.map((d) => invoiceFromFirestore(d.id, d.data()));
  } catch (err) {
    console.error(`Erro ao buscar faturamento de ${year}:`, err);
    return [];
  }
};

/** Detalhe de um cliente específico dentro de um ano (leitura filtrada). */
export const fetchInvoicesByCustomer = async (
  year: number,
  personCode: string
): Promise<InvoiceRecord[]> => {
  try {
    const db = getFirestoreDb();
    const q = query(
      collection(db, billingCollectionForYear(year)),
      where('pessoa_cod', '==', personCode)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => invoiceFromFirestore(d.id, d.data()));
  } catch (err) {
    console.error('Erro ao buscar faturamento do cliente:', err);
    return [];
  }
};

export interface BillingImportResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: number;
  years: number[];
  monthsAffected: string[];
  customersTouched: number;
  totalValue: number;
  /**
   * Resumos mensais recém-calculados, já no formato que as telas consomem.
   *
   * Devolvê-los aqui é o que faz os cartões atualizarem NA HORA. Antes, a tela
   * dependia de reler `faturamento_resumo` do Firestore logo após gravar — e
   * essa releitura frequentemente devolvia o estado anterior, porque a escrita
   * em lote ainda não tinha propagado. O resultado prático era o usuário
   * terminar uma importação de 29 mil linhas e continuar vendo "R$ 0,00".
   * Como já temos os números em memória, não há motivo para ir buscá-los.
   */
  summaries: BillingMonthSummary[];
}

/**
 * UPSERT do faturamento + recálculo dos agregados.
 *
 * Fluxo por ano afetado:
 *  1. lê o que já existe naquele ano (uma vez, só nos anos tocados);
 *  2. mescla: chave existente → substitui; chave nova → acrescenta;
 *  3. grava SOMENTE o que é novo ou teve conteúdo alterado (compara hash);
 *  4. recalcula os resumos mensais a partir do conjunto mesclado completo
 *     (nunca soma "por cima", então não há risco de dobrar valores);
 *  5. atualiza o consolidado por cliente, ano a ano, preservando os anos que
 *     não vieram nesta planilha.
 */
export const upsertInvoicesBatch = async (
  invoices: InvoiceRecord[],
  onProgress?: (stage: string, done: number, total: number) => void
): Promise<BillingImportResult> => {
  const result: BillingImportResult = {
    added: 0, updated: 0, unchanged: 0, errors: 0,
    years: [], monthsAffected: [], customersTouched: 0, totalValue: 0,
    summaries: [],
  };
  if (!invoices.length) return result;

  const db = getFirestoreDb();

  // 1) agrupa as linhas recebidas por ano
  const byYear = new Map<number, InvoiceRecord[]>();
  invoices.forEach((inv) => {
    if (!inv.year) return;
    if (!byYear.has(inv.year)) byYear.set(inv.year, []);
    byYear.get(inv.year)!.push(inv);
  });
  result.years = [...byYear.keys()].sort();

  // Conjunto mesclado (existente + novo) de TODOS os anos tocados — base do
  // recálculo dos agregados.
  const mergedByYear = new Map<number, Map<string, InvoiceRecord>>();

  // 2) estado atual de TODOS os anos tocados, lidos em paralelo.
  //    Sete anos lidos em série somam sete esperas de rede antes de a primeira
  //    gravação começar. Em paralelo, o custo é o do ano mais lento.
  onProgress?.('Lendo faturamento já cadastrado', 0, invoices.length);
  const existingByYear = new Map<number, { hashes: Map<string, string>; merged: Map<string, InvoiceRecord> }>();
  await Promise.all(
    [...byYear.keys()].map(async (year) => {
      const hashes = new Map<string, string>();
      const merged = new Map<string, InvoiceRecord>();
      try {
        const snap = await getDocs(collection(db, billingCollectionForYear(year)));
        snap.forEach((d) => {
          const data = d.data();
          hashes.set(d.id, data.hash || '');
          merged.set(d.id, invoiceFromFirestore(d.id, data));
        });
      } catch {
        /* coleção ainda não existe — primeira carga deste ano */
      }
      existingByYear.set(year, { hashes, merged });
    })
  );

  // 3) mescla tudo e junta as gravações de todos os anos numa fila só, para que
  //    a paralelização do commit trabalhe com o volume total em vez de reiniciar
  //    a cada ano (anos pequenos desperdiçavam a concorrência disponível).
  const allWrites: { path: string; id: string; data: Record<string, any> }[] = [];

  for (const [year, rows] of byYear) {
    const path = billingCollectionForYear(year);
    const { hashes: existingHash, merged } = existingByYear.get(year)!;

    const writes: { path: string; id: string; data: Record<string, any> }[] = [];
    for (const inv of rows) {
      try {
        const id = sanitizeDocId(inv.dedupeKey);
        const payload = invoiceToFirestore({ ...inv, id });
        const prevHash = existingHash.get(id);
        if (prevHash === undefined) {
          result.added++;
          writes.push({ path, id, data: payload });
        } else if (prevHash !== payload.hash) {
          result.updated++;
          writes.push({ path, id, data: payload });
        } else {
          result.unchanged++;
        }
        merged.set(id, { ...inv, id });
      } catch (err) {
        console.error('Erro no upsert de nota fiscal:', inv.dedupeKey, err);
        result.errors++;
      }
    }

    allWrites.push(...writes);
    mergedByYear.set(year, merged);
  }

  onProgress?.('Gravando notas fiscais', 0, allWrites.length);
  await commitInBatches(allWrites, (d, t) => onProgress?.('Gravando notas fiscais', d, t));

  // 4) recalcula os resumos mensais a partir do conjunto mesclado
  const summaryWrites: { path: string; id: string; data: Record<string, any> }[] = [];
  for (const [year, merged] of mergedByYear) {
    const perMonth = new Map<string, InvoiceRecord[]>();
    merged.forEach((inv) => {
      if (!inv.monthKey) return;
      if (!perMonth.has(inv.monthKey)) perMonth.set(inv.monthKey, []);
      perMonth.get(inv.monthKey)!.push(inv);
    });
    for (const [monthKey, list] of perMonth) {
      const summary = buildMonthSummary(year, monthKey, list);
      result.monthsAffected.push(summary.id);
      result.totalValue += summary.grossRevenue;
      result.summaries.push(summary);
      summaryWrites.push({
        path: BILLING_SUMMARY_COLLECTION,
        id: summary.id,
        data: {
          ano: summary.year,
          mes: summary.monthKey,
          mes_label: summary.monthLabel,
          receita_bruta: summary.grossRevenue,
          qtd_notas: summary.invoiceCount,
          qtd_linhas: summary.lineCount,
          qtd_clientes: summary.customerCount,
          ticket_medio: summary.averageTicket,
          total_impostos: summary.taxTotal,
          valor_cancelado: summary.canceledValue,
          por_vendedor: summary.bySeller,
          por_segmento: summary.bySegment,
          por_tipo_documento: summary.byDocumentType,
          por_empresa: summary.byCompany,
          atualizado_em: new Date().toISOString(),
        },
      });
    }
  }
  onProgress?.('Consolidando resumos mensais', 0, summaryWrites.length);
  await commitInBatches(summaryWrites, (d, t) => onProgress?.('Consolidando resumos mensais', d, t));

  // 5) consolidado por cliente — só os anos tocados são reescritos dentro do
  //    mapa receita_por_ano, preservando o histórico dos demais anos.
  const perCustomer = new Map<string, {
    name: string; doc: string; city: string; state: string;
    byYear: Record<string, number>; invoices: Set<string>;
    first: string; last: string; sellers: Record<string, number>;
  }>();
  for (const [year, merged] of mergedByYear) {
    merged.forEach((inv) => {
      const code = (inv.personCode || '').toString().trim();
      if (!code) return;
      let c = perCustomer.get(code);
      if (!c) {
        c = { name: inv.personName, doc: inv.personDocument, city: inv.addressCity, state: inv.addressState,
              byYear: {}, invoices: new Set(), first: inv.issueDate, last: inv.issueDate, sellers: {} };
        perCustomer.set(code, c);
      }
      c.byYear[String(year)] = (c.byYear[String(year)] || 0) + inv.totalValue;
      c.invoices.add(inv.invoiceCode);
      if (inv.issueDate && (!c.first || inv.issueDate < c.first)) c.first = inv.issueDate;
      if (inv.issueDate && inv.issueDate > c.last) c.last = inv.issueDate;
      if (inv.sellerName) c.sellers[inv.sellerName] = (c.sellers[inv.sellerName] || 0) + inv.totalValue;
      if (inv.personName) c.name = inv.personName;
    });
  }

  // mapa cod_cliente → id do documento de cliente, para o vínculo
  const customerCodeToId = new Map<string, string>();
  try {
    const cliSnap = await getDocs(collection(db, 'clientes'));
    cliSnap.forEach((d) => {
      const code = (d.data().codigo || '').toString().trim().toLowerCase();
      if (code) customerCodeToId.set(code, d.id);
    });
  } catch (err) {
    console.warn('Não foi possível ler clientes para vincular o faturamento:', err);
  }

  // documentos já existentes de consolidado por cliente (para preservar anos)
  const existingCustSummaries = new Map<string, any>();
  try {
    const snap = await getDocs(collection(db, BILLING_CUSTOMER_COLLECTION));
    snap.forEach((d) => existingCustSummaries.set(d.id, d.data()));
  } catch { /* coleção ainda não existe */ }

  const custWrites: { path: string; id: string; data: Record<string, any> }[] = [];
  perCustomer.forEach((c, code) => {
    const id = sanitizeDocId(code);
    const prev = existingCustSummaries.get(id);
    const mergedByYearMap: Record<string, number> = { ...(prev?.receita_por_ano || {}) };
    Object.entries(c.byYear).forEach(([y, v]) => { mergedByYearMap[y] = v; });
    const total = Object.values(mergedByYearMap).reduce((a, b) => a + (b || 0), 0);
    const mainSeller = Object.entries(c.sellers).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    custWrites.push({
      path: BILLING_CUSTOMER_COLLECTION,
      id,
      data: {
        pessoa_cod: code,
        pessoa_nome: c.name,
        pessoa_documento: c.doc,
        cliente_id: customerCodeToId.get(code.toLowerCase()) || prev?.cliente_id || '',
        receita_total: total,
        receita_por_ano: mergedByYearMap,
        qtd_notas: Math.max(c.invoices.size, prev?.qtd_notas && !c.invoices.size ? prev.qtd_notas : 0),
        primeira_compra: prev?.primeira_compra && prev.primeira_compra < c.first ? prev.primeira_compra : c.first,
        ultima_compra: prev?.ultima_compra && prev.ultima_compra > c.last ? prev.ultima_compra : c.last,
        vendedor_principal: mainSeller || prev?.vendedor_principal || '',
        cidade: c.city,
        estado: c.state,
        atualizado_em: new Date().toISOString(),
      },
    });
  });
  result.customersTouched = custWrites.length;
  onProgress?.('Consolidando por cliente', 0, custWrites.length);
  await commitInBatches(custWrites, (d, t) => onProgress?.('Consolidando por cliente', d, t));

  return result;
};

/** Monta o resumo de um mês a partir das linhas daquele mês. */
function buildMonthSummary(year: number, monthKey: string, list: InvoiceRecord[]): BillingMonthSummary {
  const active = list.filter((i) => !i.cancelDate);
  const canceled = list.filter((i) => !!i.cancelDate);
  const grossRevenue = active.reduce((a, i) => a + i.totalValue, 0);
  const invoiceIds = new Set(active.map((i) => i.invoiceCode));
  const customerIds = new Set(active.map((i) => i.personCode));
  const bySeller: Record<string, number> = {};
  const bySegment: Record<string, number> = {};
  const byDocumentType: Record<string, number> = {};
  const byCompany: Record<string, number> = {};
  let taxTotal = 0;
  active.forEach((i) => {
    if (i.sellerName) bySeller[i.sellerName] = (bySeller[i.sellerName] || 0) + i.totalValue;
    if (i.marketSegmentDescription) bySegment[i.marketSegmentDescription] = (bySegment[i.marketSegmentDescription] || 0) + i.totalValue;
    if (i.documentTypeDescription) byDocumentType[i.documentTypeDescription] = (byDocumentType[i.documentTypeDescription] || 0) + i.totalValue;
    if (i.companyName) byCompany[i.companyName] = (byCompany[i.companyName] || 0) + i.totalValue;
    taxTotal += i.totalIcms + i.totalIcmsSt + i.totalIss + i.totalPis + i.totalIpi + i.totalCofins + i.totalCsll;
  });
  return {
    id: `${year}_${monthKey}`,
    year,
    monthKey,
    monthLabel: `${monthKey.charAt(0).toUpperCase()}${monthKey.slice(1)}/${String(year).slice(-2)}`,
    grossRevenue,
    invoiceCount: invoiceIds.size,
    lineCount: list.length,
    customerCount: customerIds.size,
    averageTicket: invoiceIds.size ? grossRevenue / invoiceIds.size : 0,
    taxTotal,
    canceledValue: canceled.reduce((a, i) => a + i.totalValue, 0),
    bySeller, bySegment, byDocumentType, byCompany,
  };
}

/** Remove o faturamento de um ano inteiro (detalhe + resumos daquele ano). */
export const clearBillingYear = async (year: number): Promise<void> => {
  const db = getFirestoreDb();
  const snap = await getDocs(collection(db, billingCollectionForYear(year)));
  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(i, i + BATCH_LIMIT).forEach((id) => batch.delete(doc(db, billingCollectionForYear(year), id)));
    await batch.commit();
  }
  for (const m of MONTH_KEYS) {
    try { await deleteDoc(doc(db, BILLING_SUMMARY_COLLECTION, `${year}_${m}`)); } catch { /* não existia */ }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  ESTOQUE / LISTA DE PREÇO
// ═══════════════════════════════════════════════════════════════════════════

const stockToFirestore = (s: StockItem): Record<string, any> => ({
  dedupe_key: s.dedupeKey,
  empresa_nome: s.companyName,
  estoque_descr: s.stockDescription,
  tipo_produto: s.productTypeDescription,
  produto_cod: s.productCode,
  produto_descr: s.productDescription,
  marca_referencia: s.brandReference,
  descricao_detalhada: s.detailedDescription,
  localizacao: s.locationIdentifier,
  unidade: s.unit,
  grupo_produto_cod: s.productGroupCode,
  grupo_lucratividade: s.profitabilityGroup,
  abc_popularidade: s.abcPopularity,
  abc_venda: s.abcSales,
  abc_estoque: s.abcStock,
  qtde_disponivel: s.availableQty,
  valor_publico: s.publicPrice,
  valor_publico_total: s.publicPriceTotal,
  valor_garantia: s.warrantyPrice,
  valor_garantia_total: s.warrantyPriceTotal,
  valor_reposicao: s.replacementCost,
  valor_reposicao_total: s.replacementCostTotal,
  valor_venda: s.salePrice,
  valor_venda_total: s.salePriceTotal,
  valor_estoque_custo: s.stockValueAtCost,
  valor_estoque_venda: s.stockValueAtSale,
  markup_percent: s.markupPercent,
  margem_percent: s.marginPercent,
  hash: contentHash(s as any, STOCK_HASH_FIELDS),
  importado_em: s.importedAt || new Date().toISOString(),
  atualizado_em: new Date().toISOString(),
});

const stockFromFirestore = (id: string, d: any): StockItem => ({
  id,
  dedupeKey: d.dedupe_key || id,
  companyName: d.empresa_nome || '',
  stockDescription: d.estoque_descr || '',
  productTypeDescription: d.tipo_produto || '',
  productCode: d.produto_cod || id,
  productDescription: d.produto_descr || '',
  brandReference: d.marca_referencia || '',
  detailedDescription: d.descricao_detalhada || '',
  locationIdentifier: d.localizacao || '',
  unit: d.unidade || '',
  productGroupCode: d.grupo_produto_cod || '',
  profitabilityGroup: d.grupo_lucratividade || '',
  abcPopularity: d.abc_popularidade || '',
  abcSales: d.abc_venda || '',
  abcStock: d.abc_estoque || '',
  availableQty: d.qtde_disponivel || 0,
  publicPrice: d.valor_publico || 0,
  publicPriceTotal: d.valor_publico_total || 0,
  warrantyPrice: d.valor_garantia || 0,
  warrantyPriceTotal: d.valor_garantia_total || 0,
  replacementCost: d.valor_reposicao || 0,
  replacementCostTotal: d.valor_reposicao_total || 0,
  salePrice: d.valor_venda || 0,
  salePriceTotal: d.valor_venda_total || 0,
  stockValueAtCost: d.valor_estoque_custo || 0,
  stockValueAtSale: d.valor_estoque_venda || 0,
  markupPercent: d.markup_percent || 0,
  marginPercent: d.margem_percent || 0,
  importedAt: d.importado_em || '',
  updatedAt: d.atualizado_em || '',
});

export const fetchStockItems = async (): Promise<StockItem[]> => {
  try {
    const db = getFirestoreDb();
    const snap = await getDocs(collection(db, STOCK_COLLECTION));
    return snap.docs.map((d) => stockFromFirestore(d.id, d.data()));
  } catch (err) {
    console.error('Erro ao buscar estoque:', err);
    return [];
  }
};

export const fetchStockSummary = async (): Promise<StockSummary | null> => {
  try {
    const db = getFirestoreDb();
    const snap = await getDoc(doc(db, STOCK_SUMMARY_COLLECTION, STOCK_SUMMARY_DOC));
    if (!snap.exists()) return null;
    const x = snap.data();
    return {
      id: STOCK_SUMMARY_DOC,
      totalSkus: x.total_skus || 0,
      skusWithBalance: x.skus_com_saldo || 0,
      skusZeroed: x.skus_zerados || 0,
      totalQty: x.qtde_total || 0,
      totalValueAtCost: x.valor_custo || 0,
      totalValueAtSale: x.valor_venda || 0,
      potentialGrossMargin: x.margem_potencial || 0,
      averageMarkup: x.markup_medio || 0,
      byType: x.por_tipo || {},
      referenceDate: x.data_referencia || '',
      updatedAt: x.atualizado_em || '',
    };
  } catch (err) {
    console.error('Erro ao buscar resumo de estoque:', err);
    return null;
  }
};

export interface StockImportResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: number;
  totalValueAtCost: number;
}

/**
 * UPSERT do estoque. Chave = Produto_Codigo. Reimportar a lista de preço
 * atualiza saldo/preço dos produtos já cadastrados, cria os novos, e mantém
 * intactos os que não vieram na planilha (o ERP pode exportar por filtro).
 */
export const upsertStockBatch = async (
  items: StockItem[],
  onProgress?: (stage: string, done: number, total: number) => void
): Promise<StockImportResult> => {
  const result: StockImportResult = { added: 0, updated: 0, unchanged: 0, errors: 0, totalValueAtCost: 0 };
  if (!items.length) return result;
  const db = getFirestoreDb();

  onProgress?.('Lendo estoque atual', 0, items.length);
  const existingSnap = await getDocs(collection(db, STOCK_COLLECTION));
  const existingHash = new Map<string, string>();
  const merged = new Map<string, StockItem>();
  existingSnap.forEach((d) => {
    existingHash.set(d.id, d.data().hash || '');
    merged.set(d.id, stockFromFirestore(d.id, d.data()));
  });

  const writes: { path: string; id: string; data: Record<string, any> }[] = [];
  for (const item of items) {
    try {
      const id = sanitizeDocId(item.productCode || item.dedupeKey);
      const payload = stockToFirestore({ ...item, id });
      const prevHash = existingHash.get(id);
      if (prevHash === undefined) { result.added++; writes.push({ path: STOCK_COLLECTION, id, data: payload }); }
      else if (prevHash !== payload.hash) { result.updated++; writes.push({ path: STOCK_COLLECTION, id, data: payload }); }
      else { result.unchanged++; }
      merged.set(id, { ...item, id });
    } catch (err) {
      console.error('Erro no upsert de produto:', item.productCode, err);
      result.errors++;
    }
  }

  onProgress?.('Gravando estoque', 0, writes.length);
  await commitInBatches(writes, (d, t) => onProgress?.('Gravando estoque', d, t));

  // Resumo consolidado — 1 documento, lido no boot da tela em 1 leitura
  const all = [...merged.values()];
  const byType: Record<string, { skus: number; qty: number; cost: number; sale: number }> = {};
  let totalQty = 0, cost = 0, sale = 0, withBalance = 0;
  all.forEach((s) => {
    const t = s.productTypeDescription || 'SEM TIPO';
    if (!byType[t]) byType[t] = { skus: 0, qty: 0, cost: 0, sale: 0 };
    byType[t].skus++;
    byType[t].qty += s.availableQty;
    byType[t].cost += s.stockValueAtCost;
    byType[t].sale += s.stockValueAtSale;
    totalQty += s.availableQty;
    cost += s.stockValueAtCost;
    sale += s.stockValueAtSale;
    if (s.availableQty > 0) withBalance++;
  });
  result.totalValueAtCost = cost;

  await setDoc(doc(db, STOCK_SUMMARY_COLLECTION, STOCK_SUMMARY_DOC), {
    total_skus: all.length,
    skus_com_saldo: withBalance,
    skus_zerados: all.length - withBalance,
    qtde_total: totalQty,
    valor_custo: cost,
    valor_venda: sale,
    margem_potencial: sale - cost,
    markup_medio: cost > 0 ? (sale / cost - 1) * 100 : 0,
    por_tipo: byType,
    data_referencia: new Date().toISOString().slice(0, 10),
    atualizado_em: new Date().toISOString(),
  }, { merge: true });

  return result;
};

/** Apaga todo o estoque cadastrado (usado antes de uma carga limpa). */
export const clearStock = async (): Promise<void> => {
  const db = getFirestoreDb();
  const snap = await getDocs(collection(db, STOCK_COLLECTION));
  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(i, i + BATCH_LIMIT).forEach((id) => batch.delete(doc(db, STOCK_COLLECTION, id)));
    await batch.commit();
  }
  try { await deleteDoc(doc(db, STOCK_SUMMARY_COLLECTION, STOCK_SUMMARY_DOC)); } catch { /* não existia */ }
};
