/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * linking — vínculos entre módulos.
 *
 * O sistema tem três bases que falam da mesma pessoa por códigos próprios:
 *   • Cadastro de Clientes ......... Customer.code            (cod_cliente)
 *   • Faturamento (RPR014) ......... InvoiceRecord.personCode (PessoaCod)
 *   • Inadimplência ................ DelinquentTitle.customerCode
 *
 * Como os três relatórios saem do MESMO ERP, o código da pessoa é o mesmo em
 * todos. Este módulo centraliza esse casamento — inclusive a normalização, que
 * é onde os vínculos costumam falhar: o ERP exporta ora `13981`, ora `013981`,
 * ora `13981 ` com espaço. Comparar as strings cruas perderia o vínculo.
 */

import {
  BillingCustomerSummary,
  Customer,
  CustomerRiskRow,
  DelinquentTitle,
} from '../types';

/**
 * Normaliza um código de pessoa para comparação. Remove espaços, converte para
 * minúsculas e, quando o código é puramente numérico, elimina zeros à esquerda
 * (`013981` e `13981` são a mesma pessoa).
 */
export const normalizePersonCode = (code: string | number | undefined | null): string => {
  const s = (code ?? '').toString().trim().toLowerCase();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
};

/** Índice cod_cliente → Customer, pronto para lookup O(1). */
export const buildCustomerIndex = (customers: Customer[]): Map<string, Customer> => {
  const index = new Map<string, Customer>();
  customers.forEach((c) => {
    const key = normalizePersonCode(c.code);
    if (key) index.set(key, c);
  });
  return index;
};

/** Índice por CPF/CNPJ (só dígitos) — usado como fallback quando falta código. */
export const buildCustomerDocIndex = (customers: Customer[]): Map<string, Customer> => {
  const index = new Map<string, Customer>();
  customers.forEach((c) => {
    const doc = (c.cnpjCpf || '').replace(/\D/g, '');
    if (doc) index.set(doc, c);
  });
  return index;
};

/**
 * Resolve o cliente de uma linha de faturamento: primeiro pelo PessoaCod
 * (vínculo forte, mesmo ERP), depois pelo CPF/CNPJ (fallback para cadastros
 * antigos importados sem código).
 */
export const resolveCustomer = (
  personCode: string,
  personDocument: string,
  byCode: Map<string, Customer>,
  byDoc: Map<string, Customer>
): Customer | undefined => {
  const byCodeHit = byCode.get(normalizePersonCode(personCode));
  if (byCodeHit) return byCodeHit;
  const doc = (personDocument || '').replace(/\D/g, '');
  return doc ? byDoc.get(doc) : undefined;
};

export interface LinkCoverage {
  total: number;
  linked: number;
  unlinked: number;
  coveragePercent: number;
  unlinkedCodes: { code: string; name: string; value: number }[];
}

/** Mede a cobertura do vínculo Faturamento → Cadastro de Clientes. */
export const measureBillingLinkCoverage = (
  billingCustomers: BillingCustomerSummary[],
  customers: Customer[]
): LinkCoverage => {
  const byCode = buildCustomerIndex(customers);
  const byDoc = buildCustomerDocIndex(customers);
  const unlinkedCodes: LinkCoverage['unlinkedCodes'] = [];
  let linked = 0;
  billingCustomers.forEach((b) => {
    const hit = resolveCustomer(b.personCode, b.personDocument, byCode, byDoc);
    if (hit) linked++;
    else unlinkedCodes.push({ code: b.personCode, name: b.personName, value: b.totalRevenue });
  });
  unlinkedCodes.sort((a, b) => b.value - a.value);
  return {
    total: billingCustomers.length,
    linked,
    unlinked: billingCustomers.length - linked,
    coveragePercent: billingCustomers.length ? (linked / billingCustomers.length) * 100 : 0,
    unlinkedCodes: unlinkedCodes.slice(0, 100),
  };
};

const AGING_ORDER: Record<string, number> = { '1-30': 1, '31-60': 2, '61-90': 3, '>90': 4 };

/**
 * CRUZAMENTO FATURAMENTO × TÍTULOS EM ATRASO
 * ------------------------------------------
 * Para cada pessoa, junta o que ela comprou (faturamento) com o que ela deve
 * vencido (inadimplência), pelo código de pessoa. O indicador central é o
 * `overdueRate` = atraso ÷ faturado: é ele que separa "cliente grande que deve
 * muito porque compra muito" (risco administrável) de "cliente pequeno que deve
 * quase tudo que comprou" (risco real de perda).
 *
 * @param revenueWindow  quando informado, considera apenas o faturamento dos
 *                       anos indicados (ex.: [2025, 2026]) em vez do histórico
 *                       inteiro — evita diluir o atraso atual num faturamento
 *                       de 6 anos e fazer o risco parecer menor do que é.
 */
export const buildCustomerRiskRows = (
  billingCustomers: BillingCustomerSummary[],
  titles: DelinquentTitle[],
  customers: Customer[],
  revenueWindow?: number[]
): CustomerRiskRow[] => {
  const byCode = buildCustomerIndex(customers);
  const byDoc = buildCustomerDocIndex(customers);

  // agrega os títulos vencidos por código de pessoa
  const overdueByCode = new Map<string, { amount: number; count: number; worst: string; maxDays: number }>();
  titles.forEach((t) => {
    const key = normalizePersonCode(t.customerCode);
    if (!key) return;
    const cur = overdueByCode.get(key) || { amount: 0, count: 0, worst: '', maxDays: 0 };
    cur.amount += t.updatedAmount || t.originalAmount || 0;
    cur.count += 1;
    if ((AGING_ORDER[t.agingBucket] || 0) > (AGING_ORDER[cur.worst] || 0)) cur.worst = t.agingBucket;
    if ((t.daysOverdue || 0) > cur.maxDays) cur.maxDays = t.daysOverdue || 0;
    overdueByCode.set(key, cur);
  });

  const revenueOf = (b: BillingCustomerSummary): number => {
    if (!revenueWindow || !revenueWindow.length) return b.totalRevenue;
    return revenueWindow.reduce((acc, y) => acc + (b.revenueByYear[String(y)] || 0), 0);
  };

  const rows: CustomerRiskRow[] = billingCustomers.map((b) => {
    const key = normalizePersonCode(b.personCode);
    const od = overdueByCode.get(key);
    const totalRevenue = revenueOf(b);
    const overdueAmount = od?.amount || 0;
    const overdueRate = totalRevenue > 0 ? overdueAmount / totalRevenue : overdueAmount > 0 ? 1 : 0;
    const linked = resolveCustomer(b.personCode, b.personDocument, byCode, byDoc);
    return {
      personCode: b.personCode,
      personName: b.personName,
      customerId: linked?.id || b.customerId || undefined,
      totalRevenue,
      overdueAmount,
      overdueCount: od?.count || 0,
      overdueRate,
      worstAging: (od?.worst as CustomerRiskRow['worstAging']) || '—',
      maxDaysOverdue: od?.maxDays || 0,
      lastPurchaseDate: b.lastPurchaseDate,
      mainSeller: b.mainSeller,
      riskLevel: classifyRisk(overdueAmount, overdueRate, od?.maxDays || 0),
    };
  });

  // Devedores que existem na inadimplência mas ainda não têm faturamento
  // importado. Não podem sumir do relatório — são justamente os casos em que
  // falta base para negociar.
  const seen = new Set(rows.map((r) => normalizePersonCode(r.personCode)));
  overdueByCode.forEach((od, key) => {
    if (seen.has(key)) return;
    const title = titles.find((t) => normalizePersonCode(t.customerCode) === key);
    rows.push({
      personCode: title?.customerCode || key,
      personName: title?.customerName || 'Cliente sem faturamento importado',
      customerId: title?.customerId,
      totalRevenue: 0,
      overdueAmount: od.amount,
      overdueCount: od.count,
      overdueRate: 1,
      worstAging: (od.worst as CustomerRiskRow['worstAging']) || '—',
      maxDaysOverdue: od.maxDays,
      lastPurchaseDate: '',
      mainSeller: title?.sellerName || '',
      riskLevel: classifyRisk(od.amount, 1, od.maxDays),
    });
  });

  return rows.sort((a, b) => b.overdueAmount - a.overdueAmount);
};

/**
 * Classificação de risco. Combina três dimensões — quanto deve, que fração do
 * que comprou está em atraso, e há quanto tempo — porque nenhuma delas sozinha
 * descreve o risco: R$ 500 vencidos há 200 dias é perda quase certa, R$ 50 mil
 * vencidos há 10 dias costuma ser atraso operacional.
 */
function classifyRisk(amount: number, rate: number, maxDays: number): CustomerRiskRow['riskLevel'] {
  if (amount <= 0) return 'Sem atraso';
  if (maxDays > 90 || rate >= 0.5) return 'Crítico';
  if (maxDays > 60 || rate >= 0.25) return 'Alto';
  if (maxDays > 30 || rate >= 0.1) return 'Médio';
  return 'Baixo';
}

/** Exposição por vendedor: faturado × vencido da carteira dele. */
export interface SellerExposure {
  sellerName: string;
  revenue: number;
  overdueAmount: number;
  overdueRate: number;
  customersAtRisk: number;
}

export const buildSellerExposure = (rows: CustomerRiskRow[]): SellerExposure[] => {
  const map = new Map<string, SellerExposure>();
  rows.forEach((r) => {
    const key = r.mainSeller || 'SEM VENDEDOR';
    const cur = map.get(key) || { sellerName: key, revenue: 0, overdueAmount: 0, overdueRate: 0, customersAtRisk: 0 };
    cur.revenue += r.totalRevenue;
    cur.overdueAmount += r.overdueAmount;
    if (r.overdueAmount > 0) cur.customersAtRisk += 1;
    map.set(key, cur);
  });
  return [...map.values()]
    .map((s) => ({ ...s, overdueRate: s.revenue > 0 ? s.overdueAmount / s.revenue : 0 }))
    .sort((a, b) => b.overdueAmount - a.overdueAmount);
};
