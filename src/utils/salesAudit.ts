/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * salesAudit — motor de auditoria das vendas de produto (RPR001)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A pergunta que este módulo responde não é "quanto vendemos", é "onde o
 * dinheiro vazou". Ele recebe as linhas de item de nota fiscal e devolve, para
 * cada uma, os apontamentos que merecem conferência humana — mais os
 * consolidados por vendedor, cliente e produto que mostram o padrão por trás
 * dos casos isolados.
 *
 * PRINCÍPIO DE PROJETO: nenhuma linha é acusada por um único indicador.
 * Desconto de 40% num item de alta margem é política comercial legítima;
 * desconto de 40% num item que já sai no prejuízo é desfalque. Por isso as
 * flags são combinadas e o "valor em risco" nunca é somado duas vezes na mesma
 * linha — senão o total do painel viraria ficção alarmista.
 *
 * TRÊS FONTES DE VAZAMENTO QUE O MOTOR PERSEGUE
 * ---------------------------------------------
 * 1. MARGEM  — item vendido abaixo do custo + impostos, ou abaixo do piso.
 * 2. DESCONTO — abatimento acima do teto, especialmente concentrado num mesmo
 *              cliente ou concedido sempre pelo mesmo vendedor.
 * 3. PREÇO   — o mesmo SKU saindo por valores muito distintos sem justificativa;
 *              é o padrão clássico de preço de favor.
 *
 * E DOIS DE CONTROLE INTERNO
 * --------------------------
 * 4. INTEGRIDADE — margem do ERP que não fecha com Total − Custo − Impostos, e
 *                  preço unitário informado divergente do usado no cálculo.
 * 5. PARTE RELACIONADA — cliente cujo nome coincide com o de um vendedor da
 *                  equipe. NÃO é acusação: é sinalização para conferir CPF.
 */

import {
  AuditedSale,
  Customer,
  DEFAULT_SALES_THRESHOLDS,
  SaleFlag,
  SaleItem,
  SalesAuditThresholds,
  SalesCustomerSummary,
  SalesMonthSummary,
  SalesProductSummary,
  SalesSellerSummary,
  StockItem,
} from '../types';
import { buildCustomerIndex, normalizePersonCode } from './linking';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTH_LABELS: Record<string, string> = {
  jan: 'Janeiro', fev: 'Fevereiro', mar: 'Março', abr: 'Abril', mai: 'Maio', jun: 'Junho',
  jul: 'Julho', ago: 'Agosto', set: 'Setembro', out: 'Outubro', nov: 'Novembro', dez: 'Dezembro',
};

const SEVERITY_RANK: Record<string, number> = { ok: 0, medio: 1, alto: 2, critico: 3 };

/** Normaliza um nome para comparação: sem acento, maiúsculo, só letras. */
export const normalizeName = (s: string): string =>
  (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Mediana de uma lista numérica (sem ordenar o array original). */
const median = (values: number[]): number => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ═══════════════════════════════════════════════════════════════════════════
//  ÍNDICES DE VÍNCULO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Índice Produto_Codigo → StockItem. É este o vínculo pedido entre
 * `NFItem_ProdutoCod` (venda) e `Produto_Codigo` (estoque). A normalização
 * importa: o ERP exporta ora `713`, ora `000713`, ora `713 ` com espaço, e a
 * comparação crua perderia o vínculo justamente nos itens antigos.
 */
export const buildStockIndex = (stock: StockItem[]): Map<string, StockItem> => {
  const index = new Map<string, StockItem>();
  stock.forEach((s) => {
    const key = normalizePersonCode(s.productCode);
    if (key) index.set(key, s);
  });
  return index;
};

export interface SalesLinkCoverage {
  /** Vínculo produto → estoque */
  products: { total: number; linked: number; coveragePercent: number; unlinked: { code: string; name: string; value: number }[] };
  /** Vínculo cliente → cadastro de clientes */
  customers: { total: number; linked: number; coveragePercent: number; unlinked: { code: string; name: string; value: number }[] };
  /** Receita que está em linhas sem vínculo — é o tamanho do ponto cego. */
  unlinkedProductRevenue: number;
  unlinkedCustomerRevenue: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDITORIA LINHA A LINHA
// ═══════════════════════════════════════════════════════════════════════════

export interface SalesAuditResult {
  audited: AuditedSale[];
  /** Só as linhas com pelo menos um apontamento, já ordenadas por risco. */
  flagged: AuditedSale[];
  coverage: SalesLinkCoverage;
  totals: {
    lines: number;
    invoices: number;
    customers: number;
    products: number;
    grossAmount: number;
    discountAmount: number;
    discountPercent: number;
    netAmount: number;
    costAmount: number;
    taxAmount: number;
    marginErp: number;
    marginCalculated: number;
    marginPercent: number;
    marginDivergence: number;
  };
  risk: {
    /** Prejuízo direto: soma das margens negativas (valor positivo). */
    negativeMarginAmount: number;
    negativeMarginLines: number;
    /** Desconto concedido acima do teto configurado. */
    excessDiscountAmount: number;
    excessDiscountLines: number;
    /** Margem que faltou para atingir o piso, nas linhas abaixo dele. */
    marginGapAmount: number;
    marginGapLines: number;
    /** Receita perdida por preço abaixo da mediana do próprio SKU. */
    priceGapAmount: number;
    priceGapLines: number;
    /** Divergência de margem entre ERP e recálculo (problema de dado). */
    marginDivergenceAmount: number;
    marginDivergenceLines: number;
    /** Receita em notas cujo cliente tem o nome de um vendedor. */
    relatedPartyRevenue: number;
    relatedPartyInvoices: number;
    /** Total em risco, sem dupla contagem por linha. */
    totalRiskAmount: number;
  };
}

/**
 * Executa a auditoria completa.
 *
 * @param items      linhas do RPR001 já convertidas
 * @param stock      cadastro de estoque (RPR053) para o vínculo por produto
 * @param customers  cadastro de clientes para o vínculo por cod_cliente
 * @param thresholds parâmetros de "abusivo" definidos pelo gestor na tela
 */
export function auditSales(
  items: SaleItem[],
  stock: StockItem[],
  customers: Customer[],
  thresholds: SalesAuditThresholds = DEFAULT_SALES_THRESHOLDS
): SalesAuditResult {
  const stockIndex = buildStockIndex(stock);
  const customerByCode = buildCustomerIndex(customers);

  // ── Mediana de preço unitário por SKU ──────────────────────────────────────
  // Comparar contra a MÉDIA seria ingênuo: uma única venda de favor por R$ 1
  // puxa a média para baixo e passa a "justificar" as demais. A mediana é
  // resistente a esse tipo de outlier — que é exatamente o que procuramos.
  // Só entram SKUs com pelo menos 4 vendas: com menos que isso não há padrão.
  const pricesByProduct = new Map<string, number[]>();
  items.forEach((it) => {
    if (it.quantity <= 0 || it.netAmount <= 0) return;
    const key = normalizePersonCode(it.productCode);
    if (!key) return;
    const arr = pricesByProduct.get(key) || [];
    arr.push(it.netAmount / it.quantity);
    pricesByProduct.set(key, arr);
  });
  const medianByProduct = new Map<string, number>();
  pricesByProduct.forEach((arr, key) => {
    if (arr.length >= 4) medianByProduct.set(key, median(arr));
  });

  // ── Nomes da equipe de vendas, para detectar parte relacionada ─────────────
  // Guardamos os tokens "fortes" (>3 letras) de cada vendedor. O casamento só
  // vale quando TODOS os tokens do vendedor aparecem no nome do cliente, senão
  // um primeiro nome comum ("REGIS") acusaria dezenas de homônimos.
  const sellerTokens = new Map<string, string[]>();
  items.forEach((it) => {
    const n = normalizeName(it.sellerName);
    if (!n || sellerTokens.has(n)) return;
    sellerTokens.set(n, n.split(' ').filter((t) => t.length > 3));
  });

  const isRelatedParty = (customerName: string): string => {
    const c = normalizeName(customerName);
    if (!c) return '';
    for (const [seller, tokens] of sellerTokens) {
      if (tokens.length < 2) continue; // nome de vendedor com um token só é fraco demais
      if (tokens.every((t) => c.includes(t))) return seller;
    }
    return '';
  };

  // ── Varredura ──────────────────────────────────────────────────────────────
  const audited: AuditedSale[] = items.map((it) => {
    const flags: SaleFlag[] = [];
    const productKey = normalizePersonCode(it.productCode);
    const stockHit = stockIndex.get(productKey);
    // O RPR001 não traz CPF/CNPJ, então o vínculo com o cadastro é só por
    // NF_PessoaCod ⇄ cod_cliente. É um vínculo forte (mesmo ERP), mas quando
    // falha não há fallback documental — e a tela precisa mostrar isso.
    const custHit = customerByCode.get(normalizePersonCode(it.customerCode));

    const relevant = it.netAmount >= thresholds.minLineValue;

    // 1. MARGEM NEGATIVA — vendeu abaixo do custo + impostos.
    if (it.marginCalculated < 0 && it.netAmount > 0) {
      flags.push({
        code: 'margem_negativa',
        severity: 'critico',
        message:
          `Vendido abaixo do custo: receita ${it.netAmount.toFixed(2)} contra custo ` +
          `${it.lineCost.toFixed(2)} + impostos ${it.taxTotal.toFixed(2)}.`,
        impact: Math.abs(it.marginCalculated),
      });
    } else if (relevant && it.marginPercentCalculated < thresholds.minMarginPercent && it.netAmount > 0) {
      // 2. MARGEM ABAIXO DO PISO — o impacto é o quanto faltou para o piso,
      //    não a margem inteira: o item deu lucro, só que insuficiente.
      const target = it.netAmount * (thresholds.minMarginPercent / 100);
      flags.push({
        code: 'margem_baixa',
        severity: 'alto',
        message:
          `Margem de ${it.marginPercentCalculated.toFixed(1)}% abaixo do piso de ` +
          `${thresholds.minMarginPercent}%.`,
        impact: Math.max(0, target - it.marginCalculated),
      });
    }

    // 3. DESCONTO ACIMA DO TETO — o impacto é só o excedente.
    if (relevant && it.discountPercent > thresholds.maxDiscountPercent) {
      const allowed = it.grossAmount * (thresholds.maxDiscountPercent / 100);
      const excess = Math.max(0, it.discountAmount - allowed);
      const alreadyLosing = it.marginCalculated < 0;
      flags.push({
        code: alreadyLosing ? 'desconto_sem_margem' : 'desconto_alto',
        severity: alreadyLosing ? 'critico' : it.discountPercent > thresholds.maxDiscountPercent * 1.5 ? 'alto' : 'medio',
        message: alreadyLosing
          ? `Desconto de ${it.discountPercent.toFixed(1)}% concedido em item que já saiu no prejuízo.`
          : `Desconto de ${it.discountPercent.toFixed(1)}% acima do teto de ${thresholds.maxDiscountPercent}% ` +
            `(excedente de R$ ${excess.toFixed(2)}).`,
        impact: excess,
      });
    }

    // 4. PREÇO FORA DA CURVA — mesmo SKU vendido muito abaixo da mediana.
    const med = medianByProduct.get(productKey);
    if (relevant && med && it.quantity > 0) {
      const unitNet = it.netAmount / it.quantity;
      const belowPercent = med > 0 ? ((med - unitNet) / med) * 100 : 0;
      if (belowPercent > thresholds.maxPriceBelowMedianPercent) {
        flags.push({
          code: 'preco_fora_da_curva',
          severity: belowPercent > 70 ? 'alto' : 'medio',
          message:
            `Preço unitário R$ ${unitNet.toFixed(2)} está ${belowPercent.toFixed(0)}% abaixo da ` +
            `mediana do produto (R$ ${med.toFixed(2)}).`,
          impact: (med - unitNet) * it.quantity,
        });
      }
    }

    // 5. CUSTO AUSENTE — margem aparente de 100%, indicador inutilizável.
    if (it.lineCost <= 0 && it.netAmount > 0) {
      flags.push({
        code: 'custo_ausente',
        severity: 'alto',
        message: 'Custo do produto zerado na nota — a margem informada é fictícia.',
        impact: 0,
      });
    }

    // 6. INTEGRIDADE — preço unitário informado ≠ usado no cálculo.
    if (it.reportedUnitGross > 0 && Math.abs(it.reportedUnitGross - it.unitPrice) > 0.01) {
      flags.push({
        code: 'preco_divergente',
        severity: 'medio',
        message:
          `Preço unitário divergente no relatório: bruto informado R$ ${it.reportedUnitGross.toFixed(2)} ` +
          `contra R$ ${it.unitPrice.toFixed(2)} usado no total da nota.`,
        impact: 0,
      });
    }

    // 7. INTEGRIDADE — margem do ERP não fecha com o recálculo.
    if (Math.abs(it.marginDivergence) > 0.01 && relevant) {
      flags.push({
        code: 'margem_divergente',
        severity: 'medio',
        message:
          `Margem do ERP (R$ ${it.marginErp.toFixed(2)}) diverge do recálculo ` +
          `(R$ ${it.marginCalculated.toFixed(2)}) em R$ ${it.marginDivergence.toFixed(2)}.`,
        impact: 0,
      });
    }

    // 8. PARTE RELACIONADA — cliente com nome de vendedor.
    const related = isRelatedParty(it.customerName);
    if (related) {
      flags.push({
        code: 'cliente_e_vendedor',
        severity: 'alto',
        message: `Cliente com o mesmo nome do vendedor "${related}" — conferir CPF/CNPJ e autorização.`,
        impact: 0,
      });
    }

    const worstSeverity = flags.reduce<'critico' | 'alto' | 'medio' | 'ok'>(
      (acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc),
      'ok'
    );

    // Valor em risco da LINHA = maior impacto individual, não a soma.
    // Uma linha com margem negativa E desconto abusivo é o mesmo dinheiro
    // visto por dois ângulos; somar inflaria o total do painel.
    const riskAmount = flags.reduce((max, f) => Math.max(max, f.impact), 0);

    return {
      ...it,
      customerId: custHit?.id || it.customerId,
      flags,
      worstSeverity,
      riskAmount,
      linkedToStock: !!stockHit,
      linkedToCustomer: !!custHit,
    };
  });

  // ── Cobertura dos vínculos ─────────────────────────────────────────────────
  const prodAgg = new Map<string, { code: string; name: string; value: number; linked: boolean }>();
  const custAgg = new Map<string, { code: string; name: string; value: number; linked: boolean }>();
  audited.forEach((a) => {
    const pk = normalizePersonCode(a.productCode);
    const p = prodAgg.get(pk) || { code: a.productCode, name: a.productDescription, value: 0, linked: a.linkedToStock };
    p.value += a.netAmount;
    prodAgg.set(pk, p);
    const ck = normalizePersonCode(a.customerCode);
    const c = custAgg.get(ck) || { code: a.customerCode, name: a.customerName, value: 0, linked: a.linkedToCustomer };
    c.value += a.netAmount;
    custAgg.set(ck, c);
  });
  const prodList = [...prodAgg.values()];
  const custList = [...custAgg.values()];
  const unlinkedProducts = prodList.filter((p) => !p.linked).sort((a, b) => b.value - a.value);
  const unlinkedCustomers = custList.filter((c) => !c.linked).sort((a, b) => b.value - a.value);

  const coverage: SalesLinkCoverage = {
    products: {
      total: prodList.length,
      linked: prodList.length - unlinkedProducts.length,
      coveragePercent: prodList.length ? ((prodList.length - unlinkedProducts.length) / prodList.length) * 100 : 0,
      unlinked: unlinkedProducts.slice(0, 100),
    },
    customers: {
      total: custList.length,
      linked: custList.length - unlinkedCustomers.length,
      coveragePercent: custList.length ? ((custList.length - unlinkedCustomers.length) / custList.length) * 100 : 0,
      unlinked: unlinkedCustomers.slice(0, 100),
    },
    unlinkedProductRevenue: unlinkedProducts.reduce((a, p) => a + p.value, 0),
    unlinkedCustomerRevenue: unlinkedCustomers.reduce((a, c) => a + c.value, 0),
  };

  // ── Totais e risco consolidado ─────────────────────────────────────────────
  const invoiceSet = new Set<string>();
  const customerSet = new Set<string>();
  const productSet = new Set<string>();
  const relatedInvoices = new Set<string>();

  const totals = {
    lines: audited.length,
    invoices: 0,
    customers: 0,
    products: 0,
    grossAmount: 0,
    discountAmount: 0,
    discountPercent: 0,
    netAmount: 0,
    costAmount: 0,
    taxAmount: 0,
    marginErp: 0,
    marginCalculated: 0,
    marginPercent: 0,
    marginDivergence: 0,
  };

  const risk = {
    negativeMarginAmount: 0,
    negativeMarginLines: 0,
    excessDiscountAmount: 0,
    excessDiscountLines: 0,
    marginGapAmount: 0,
    marginGapLines: 0,
    priceGapAmount: 0,
    priceGapLines: 0,
    marginDivergenceAmount: 0,
    marginDivergenceLines: 0,
    relatedPartyRevenue: 0,
    relatedPartyInvoices: 0,
    totalRiskAmount: 0,
  };

  audited.forEach((a) => {
    invoiceSet.add(`${a.companyCode}|${a.invoiceCode}`);
    customerSet.add(normalizePersonCode(a.customerCode));
    productSet.add(normalizePersonCode(a.productCode));
    totals.grossAmount += a.grossAmount;
    totals.discountAmount += a.discountAmount;
    totals.netAmount += a.netAmount;
    totals.costAmount += a.lineCost;
    totals.taxAmount += a.taxTotal;
    totals.marginErp += a.marginErp;
    totals.marginCalculated += a.marginCalculated;
    totals.marginDivergence += a.marginDivergence;
    risk.totalRiskAmount += a.riskAmount;

    a.flags.forEach((f) => {
      switch (f.code) {
        case 'margem_negativa':
          risk.negativeMarginAmount += f.impact; risk.negativeMarginLines++; break;
        case 'margem_baixa':
          risk.marginGapAmount += f.impact; risk.marginGapLines++; break;
        case 'desconto_alto':
        case 'desconto_sem_margem':
          risk.excessDiscountAmount += f.impact; risk.excessDiscountLines++; break;
        case 'preco_fora_da_curva':
          risk.priceGapAmount += f.impact; risk.priceGapLines++; break;
        case 'margem_divergente':
          risk.marginDivergenceAmount += a.marginDivergence; risk.marginDivergenceLines++; break;
        case 'cliente_e_vendedor':
          risk.relatedPartyRevenue += a.netAmount;
          relatedInvoices.add(`${a.companyCode}|${a.invoiceCode}`);
          break;
        default: break;
      }
    });
  });

  totals.invoices = invoiceSet.size;
  totals.customers = customerSet.size;
  totals.products = productSet.size;
  totals.discountPercent = totals.grossAmount > 0 ? (totals.discountAmount / totals.grossAmount) * 100 : 0;
  totals.marginPercent = totals.netAmount > 0 ? (totals.marginCalculated / totals.netAmount) * 100 : 0;
  risk.relatedPartyInvoices = relatedInvoices.size;

  const flagged = audited
    .filter((a) => a.flags.length > 0)
    .sort((a, b) => SEVERITY_RANK[b.worstSeverity] - SEVERITY_RANK[a.worstSeverity] || b.riskAmount - a.riskAmount);

  return { audited, flagged, coverage, totals, risk };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONSOLIDADOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Margem e desconto por vendedor.
 *
 * O campo decisivo é `marginDeviation`: a diferença entre a margem % do
 * vendedor e a MEDIANA da equipe. Olhar a margem isolada engana — uma equipe
 * que opera a 22% torna 18% suspeito, uma que opera a 12% torna 18% excelente.
 * A mediana é o único parâmetro justo, e é resistente ao vendedor com três
 * notas e 90% de margem que distorceria a média.
 */
export function buildSellerSummaries(
  audited: AuditedSale[],
  thresholds: SalesAuditThresholds = DEFAULT_SALES_THRESHOLDS
): SalesSellerSummary[] {
  const map = new Map<string, SalesSellerSummary & { _inv: Set<string>; _cust: Set<string> }>();

  audited.forEach((a) => {
    const key = a.sellerCode || a.sellerName || 'SEM VENDEDOR';
    let s = map.get(key);
    if (!s) {
      s = {
        sellerCode: a.sellerCode,
        sellerName: a.sellerName || 'SEM VENDEDOR',
        lines: 0, invoices: 0, customers: 0,
        grossAmount: 0, discountAmount: 0, discountPercent: 0,
        netAmount: 0, costAmount: 0, marginAmount: 0, marginPercent: 0,
        averageTicket: 0, negativeLines: 0, negativeAmount: 0,
        highDiscountLines: 0, highDiscountAmount: 0, riskAmount: 0, marginDeviation: 0,
        _inv: new Set(), _cust: new Set(),
      };
      map.set(key, s);
    }
    s.lines++;
    s._inv.add(`${a.companyCode}|${a.invoiceCode}`);
    s._cust.add(normalizePersonCode(a.customerCode));
    s.grossAmount += a.grossAmount;
    s.discountAmount += a.discountAmount;
    s.netAmount += a.netAmount;
    s.costAmount += a.lineCost;
    s.marginAmount += a.marginCalculated;
    s.riskAmount += a.riskAmount;
    if (a.marginCalculated < 0) { s.negativeLines++; s.negativeAmount += a.marginCalculated; }
    if (a.discountPercent > thresholds.maxDiscountPercent) {
      s.highDiscountLines++;
      s.highDiscountAmount += a.discountAmount;
    }
  });

  const list = [...map.values()].map((s) => {
    const { _inv, _cust, ...rest } = s;
    return {
      ...rest,
      invoices: _inv.size,
      customers: _cust.size,
      discountPercent: s.grossAmount > 0 ? (s.discountAmount / s.grossAmount) * 100 : 0,
      marginPercent: s.netAmount > 0 ? (s.marginAmount / s.netAmount) * 100 : 0,
      averageTicket: _inv.size > 0 ? s.netAmount / _inv.size : 0,
    };
  });

  // Mediana ponderada pela relevância: só vendedores com faturamento material
  // entram no cálculo do parâmetro, senão o estagiário com duas notas define
  // a régua da equipe inteira.
  const material = list.filter((s) => s.netAmount >= 50000);
  const base = material.length >= 3 ? material : list;
  const medianMargin = median(base.map((s) => s.marginPercent));
  list.forEach((s) => { s.marginDeviation = s.marginPercent - medianMargin; });

  return list.sort((a, b) => b.netAmount - a.netAmount);
}

/** Consolidado por cliente, com o vínculo ao cadastro já resolvido. */
export function buildCustomerSummaries(
  audited: AuditedSale[],
  customers: Customer[]
): SalesCustomerSummary[] {
  const byCode = buildCustomerIndex(customers);
  const map = new Map<string, SalesCustomerSummary & { _inv: Set<string>; _sellers: Map<string, number> }>();

  audited.forEach((a) => {
    const key = normalizePersonCode(a.customerCode) || 'sem_codigo';
    let c = map.get(key);
    if (!c) {
      const hit = byCode.get(key);
      c = {
        customerCode: a.customerCode,
        customerName: a.customerName,
        customerId: hit?.id,
        linked: !!hit,
        city: hit?.city || '',
        state: hit?.state || '',
        lines: 0, invoices: 0, sellers: [],
        grossAmount: 0, discountAmount: 0, discountPercent: 0,
        netAmount: 0, costAmount: 0, marginAmount: 0, marginPercent: 0,
        negativeLines: 0, negativeAmount: 0, riskAmount: 0,
        firstPurchaseDate: a.issueDate, lastPurchaseDate: a.issueDate, mainSeller: '',
        _inv: new Set(), _sellers: new Map(),
      };
      map.set(key, c);
    }
    c.lines++;
    c._inv.add(`${a.companyCode}|${a.invoiceCode}`);
    c._sellers.set(a.sellerName, (c._sellers.get(a.sellerName) || 0) + a.netAmount);
    c.grossAmount += a.grossAmount;
    c.discountAmount += a.discountAmount;
    c.netAmount += a.netAmount;
    c.costAmount += a.lineCost;
    c.marginAmount += a.marginCalculated;
    c.riskAmount += a.riskAmount;
    if (a.marginCalculated < 0) { c.negativeLines++; c.negativeAmount += a.marginCalculated; }
    if (a.issueDate && (!c.firstPurchaseDate || a.issueDate < c.firstPurchaseDate)) c.firstPurchaseDate = a.issueDate;
    if (a.issueDate && a.issueDate > c.lastPurchaseDate) c.lastPurchaseDate = a.issueDate;
  });

  return [...map.values()]
    .map((c) => {
      const { _inv, _sellers, ...rest } = c;
      const sellers = [..._sellers.entries()].sort((a, b) => b[1] - a[1]);
      return {
        ...rest,
        invoices: _inv.size,
        sellers: sellers.map(([n]) => n),
        mainSeller: sellers[0]?.[0] || '',
        discountPercent: c.grossAmount > 0 ? (c.discountAmount / c.grossAmount) * 100 : 0,
        marginPercent: c.netAmount > 0 ? (c.marginAmount / c.netAmount) * 100 : 0,
      };
    })
    .sort((a, b) => b.netAmount - a.netAmount);
}

/**
 * Consolidado por produto, cruzado com o estoque atual.
 *
 * O `priceSpread` (maior preço ÷ menor preço do mesmo SKU) é o indicador mais
 * revelador desta tabela: spread de 1,3x é negociação normal; spread de 10x no
 * mesmo item, no mesmo período, é preço de favor ou erro de digitação — e nos
 * dois casos alguém precisa olhar.
 */
export function buildProductSummaries(
  audited: AuditedSale[],
  stock: StockItem[]
): SalesProductSummary[] {
  const stockIndex = buildStockIndex(stock);
  const map = new Map<string, SalesProductSummary & { _prices: number[] }>();

  audited.forEach((a) => {
    const key = normalizePersonCode(a.productCode);
    if (!key) return;
    let p = map.get(key);
    if (!p) {
      const hit = stockIndex.get(key);
      p = {
        productCode: a.productCode,
        productDescription: a.productDescription,
        brandReference: a.brandReference,
        linked: !!hit,
        availableQty: hit?.availableQty || 0,
        currentCost: hit?.replacementCost || 0,
        currentSalePrice: hit?.salePrice || 0,
        lines: 0, quantity: 0,
        grossAmount: 0, discountAmount: 0, discountPercent: 0,
        netAmount: 0, costAmount: 0, marginAmount: 0, marginPercent: 0,
        minUnitPrice: 0, maxUnitPrice: 0, medianUnitPrice: 0, priceSpread: 0,
        negativeLines: 0, negativeAmount: 0,
        _prices: [],
      };
      map.set(key, p);
    }
    p.lines++;
    p.quantity += a.quantity;
    p.grossAmount += a.grossAmount;
    p.discountAmount += a.discountAmount;
    p.netAmount += a.netAmount;
    p.costAmount += a.lineCost;
    p.marginAmount += a.marginCalculated;
    if (a.marginCalculated < 0) { p.negativeLines++; p.negativeAmount += a.marginCalculated; }
    if (a.quantity > 0 && a.netAmount > 0) p._prices.push(a.netAmount / a.quantity);
  });

  return [...map.values()]
    .map((p) => {
      const { _prices, ...rest } = p;
      const min = _prices.length ? Math.min(..._prices) : 0;
      const max = _prices.length ? Math.max(..._prices) : 0;
      return {
        ...rest,
        minUnitPrice: min,
        maxUnitPrice: max,
        medianUnitPrice: median(_prices),
        priceSpread: min > 0 ? max / min : 0,
        discountPercent: p.grossAmount > 0 ? (p.discountAmount / p.grossAmount) * 100 : 0,
        marginPercent: p.netAmount > 0 ? (p.marginAmount / p.netAmount) * 100 : 0,
      };
    })
    .sort((a, b) => b.netAmount - a.netAmount);
}

/** Resumos mensais — a série temporal de receita, desconto e margem. */
export function buildSalesMonthSummaries(audited: AuditedSale[]): SalesMonthSummary[] {
  const map = new Map<string, SalesMonthSummary & { _inv: Set<string>; _cust: Set<string>; _prod: Set<string> }>();

  audited.forEach((a) => {
    if (!a.year || !a.monthKey) return;
    const id = `${a.year}_${a.monthKey}`;
    let m = map.get(id);
    if (!m) {
      m = {
        id, year: a.year, monthKey: a.monthKey,
        monthLabel: `${MONTH_LABELS[a.monthKey] || a.monthKey}/${String(a.year).slice(2)}`,
        lines: 0, invoices: 0, customers: 0, products: 0,
        grossAmount: 0, discountAmount: 0, discountPercent: 0,
        netAmount: 0, costAmount: 0, taxAmount: 0,
        marginAmount: 0, marginPercent: 0,
        negativeLines: 0, negativeAmount: 0,
        bySeller: {}, byOrigin: {},
        _inv: new Set(), _cust: new Set(), _prod: new Set(),
      };
      map.set(id, m);
    }
    m.lines++;
    m._inv.add(`${a.companyCode}|${a.invoiceCode}`);
    m._cust.add(normalizePersonCode(a.customerCode));
    m._prod.add(normalizePersonCode(a.productCode));
    m.grossAmount += a.grossAmount;
    m.discountAmount += a.discountAmount;
    m.netAmount += a.netAmount;
    m.costAmount += a.lineCost;
    m.taxAmount += a.taxTotal;
    m.marginAmount += a.marginCalculated;
    if (a.marginCalculated < 0) { m.negativeLines++; m.negativeAmount += a.marginCalculated; }
    const sk = a.sellerName || 'SEM VENDEDOR';
    m.bySeller[sk] = (m.bySeller[sk] || 0) + a.netAmount;
    const ok = a.origin || 'SEM ORIGEM';
    m.byOrigin[ok] = (m.byOrigin[ok] || 0) + a.netAmount;
  });

  return [...map.values()]
    .map((m) => {
      const { _inv, _cust, _prod, ...rest } = m;
      return {
        ...rest,
        invoices: _inv.size,
        customers: _cust.size,
        products: _prod.size,
        discountPercent: m.grossAmount > 0 ? (m.discountAmount / m.grossAmount) * 100 : 0,
        marginPercent: m.netAmount > 0 ? (m.marginAmount / m.netAmount) * 100 : 0,
        updatedAt: new Date().toISOString(),
      };
    })
    .sort((a, b) => (a.year - b.year) || (MONTH_KEYS.indexOf(a.monthKey) - MONTH_KEYS.indexOf(b.monthKey)));
}

/** Rótulos legíveis das flags, usados na tela e na exportação. */
export const FLAG_LABELS: Record<string, string> = {
  margem_negativa: 'Margem negativa',
  margem_baixa: 'Margem abaixo do piso',
  desconto_alto: 'Desconto acima do teto',
  desconto_sem_margem: 'Desconto sobre prejuízo',
  preco_divergente: 'Preço unitário divergente',
  margem_divergente: 'Margem do ERP não confere',
  custo_ausente: 'Custo ausente',
  preco_fora_da_curva: 'Preço fora da curva',
  cliente_e_vendedor: 'Cliente com nome de vendedor',
};
