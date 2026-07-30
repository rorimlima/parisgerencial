/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CrmSalesView — CRM de Vendas Inteligente, Curva ABC & Melhores Produtos para Venda
 * ════════════════════════════════════════════════════════════════════════════════════
 *
 * Este módulo analisa o histórico de vendas (RPR001) cruzando com Estoque (RPR053)
 * e Clientes para gerar inteligência comercial prática:
 *
 *  1. MATRIZ DE MELHORES PRODUTOS (Margem × Giro/Saída):
 *     • Campeões (Estrelas): Alta Margem + Maior Saída (O Foco Absoluto da Equipe)
 *     • Oportunidades Ocultas: Alta Margem + Baixa Saída (Ouro em Pó para Venda Ativa)
 *     • Puxadores de Volume: Baixa Margem + Alta Saída (Ótimos para Venda Casada)
 *     • Baixa Performance: Cautela e Ajuste de Preço
 *
 *  2. CURVA ABC INTELIGENTE (Produtos e Clientes):
 *     • Classificação A (80% do valor), B (15%), C (5%) por Receita, Margem e Giro
 *     • Gráfico de Pareto de Concentração de Vendas
 *
 *  3. CRM DE CARTEIRA & RECOMPRA:
 *     • Clientes A, B, C, Recorrência, Ticket Médio e Risco de Inadimplência
 *     • Ações Comerciais Diretas via WhatsApp
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Copy,
  DollarSign,
  Download,
  Filter,
  Flame,
  HelpCircle,
  Layers,
  MessageSquare,
  PackageCheck,
  Percent,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  PieChart,
  Pie,
  CartesianGrid,
  ComposedChart,
  Line,
} from 'recharts';
import { AuditedSale, Customer, DelinquentTitle, SaleItem, Seller, StockItem } from '../types';
import { exportReportToExcel, formatCurrency } from '../utils/exportUtils';
import { normalizePersonCode } from '../utils/linking';
import { WhatsAppLink } from './WhatsAppLink';

interface CrmSalesViewProps {
  auditedSales: AuditedSale[];
  stockItems: StockItem[];
  customers: Customer[];
  sellers: Seller[];
  delinquentTitles: DelinquentTitle[];
  selectedYear: number | 'all';
  onNavigateTab?: (tab: string) => void;
}

export type ProductQuadrant = 'champion' | 'opportunity' | 'volume' | 'review';

export interface ProductCrmSummary {
  productCode: string;
  productDescription: string;
  brandReference: string;
  totalQty: number;
  totalNet: number;
  totalMargin: number;
  marginPct: number;
  unitPriceAvg: number;
  unitProfitAvg: number;
  stockQty: number;
  replacementCost: number;
  listPrice: number;
  abcRevenueClass: 'A' | 'B' | 'C';
  abcMarginClass: 'A' | 'B' | 'C';
  abcQtyClass: 'A' | 'B' | 'C';
  quadrant: ProductQuadrant;
  cumRevenuePct: number;
  cumMarginPct: number;
}

export interface CustomerCrmSummary {
  customerCode: string;
  customerName: string;
  totalNet: number;
  totalMargin: number;
  marginPct: number;
  orderCount: number;
  avgTicket: number;
  lastPurchaseDate: string;
  daysSinceLastPurchase: number;
  abcClass: 'A' | 'B' | 'C';
  delinquentAmount: number;
  status: 'Adimplente' | 'Inadimplente' | 'Risco';
  mainSeller: string;
  phone?: string;
  cellphone?: string;
  city?: string;
  topProduct?: string;
}

const fmtQty = (n: number) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtPct = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const fmtInt = (n: number) => (n ?? 0).toLocaleString('pt-BR');

export const CrmSalesView: React.FC<CrmSalesViewProps> = ({
  auditedSales,
  stockItems,
  customers,
  sellers,
  delinquentTitles,
  selectedYear,
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'abc' | 'customers' | 'sellers'>('matrix');
  const [abcMetric, setAbcMetric] = useState<'revenue' | 'margin' | 'qty'>('revenue');
  const [abcTarget, setAbcTarget] = useState<'products' | 'customers'>('products');
  const [quadrantFilter, setQuadrantFilter] = useState<ProductQuadrant | 'all'>('all');
  const [search, setSearch] = useState('');
  const [abcFilter, setAbcFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [minMarginFilter, setMinMarginFilter] = useState<number>(0);
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  // Map de Estoque por produto
  const stockMap = useMemo(() => {
    const map = new Map<string, StockItem>();
    stockItems.forEach((s) => {
      if (s.productCode) map.set(s.productCode.toString().trim(), s);
    });
    return map;
  }, [stockItems]);

  // Map de Inadimplência por cliente
  const overdueByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    delinquentTitles.forEach((t) => {
      const k = normalizePersonCode(t.customerCode);
      if (!k) return;
      map.set(k, (map.get(k) || 0) + (t.updatedAmount || t.originalAmount || 0));
    });
    return map;
  }, [delinquentTitles]);

  // Map de Clientes do cadastro
  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((c) => {
      if (c.code) map.set(normalizePersonCode(c.code), c);
    });
    return map;
  }, [customers]);

  // ── 1. Consolidação dos Produtos para o CRM ────────────────────────────────
  const productSummaries = useMemo<ProductCrmSummary[]>(() => {
    const map = new Map<
      string,
      {
        code: string;
        desc: string;
        brand: string;
        qty: number;
        net: number;
        margin: number;
      }
    >();

    auditedSales.forEach((s) => {
      const code = (s.productCode || '').toString().trim() || 'SEM_CODIGO';
      const desc = s.productDescription || 'Produto sem descrição';
      const brand = s.brandReference || '';
      const cur = map.get(code) || { code, desc, brand, qty: 0, net: 0, margin: 0 };
      cur.qty += s.quantity || 0;
      cur.net += s.netAmount || 0;
      cur.margin += s.marginCalculated ?? s.marginErp ?? 0;
      if (!cur.brand && brand) cur.brand = brand;
      map.set(code, cur);
    });

    const list = Array.from(map.values());
    if (!list.length) return [];

    // Calcular totais globais para ordenação e acumulados
    const totalRev = list.reduce((a, b) => a + b.net, 0);
    const totalMar = list.reduce((a, b) => a + b.margin, 0);
    const totalQty = list.reduce((a, b) => a + b.qty, 0);

    // Calcular Mediana de Saída/Giro
    const sortedByQty = [...list].sort((a, b) => b.qty - a.qty);
    const medianQty = sortedByQty[Math.floor(sortedByQty.length / 2)]?.qty || 1;

    // Calcular Mediana de Margem %
    const sortedByMarginPct = [...list]
      .filter((p) => p.net > 0)
      .map((p) => (p.margin / p.net) * 100)
      .sort((a, b) => a - b);
    const medianMarginPct = sortedByMarginPct[Math.floor(sortedByMarginPct.length / 2)] || 20;

    // Ordenar por Receita para Curva ABC de Receita
    const byRevenue = [...list].sort((a, b) => b.net - a.net);
    let runRev = 0;
    const abcRevMap = new Map<string, { cls: 'A' | 'B' | 'C'; cumPct: number }>();
    byRevenue.forEach((item) => {
      runRev += item.net;
      const pct = totalRev > 0 ? (runRev / totalRev) * 100 : 100;
      let cls: 'A' | 'B' | 'C' = 'C';
      if (pct <= 80) cls = 'A';
      else if (pct <= 95) cls = 'B';
      abcRevMap.set(item.code, { cls, cumPct: pct });
    });

    // Ordenar por Margem para Curva ABC de Margem
    const byMargin = [...list].sort((a, b) => b.margin - a.margin);
    let runMar = 0;
    const abcMarMap = new Map<string, { cls: 'A' | 'B' | 'C'; cumPct: number }>();
    byMargin.forEach((item) => {
      runMar += item.margin;
      const pct = totalMar > 0 ? (runMar / totalMar) * 100 : 100;
      let cls: 'A' | 'B' | 'C' = 'C';
      if (pct <= 80) cls = 'A';
      else if (pct <= 95) cls = 'B';
      abcMarMap.set(item.code, { cls, cumPct: pct });
    });

    // Ordenar por Quantidade para Curva ABC de Saída
    let runQty = 0;
    const abcQtyMap = new Map<string, 'A' | 'B' | 'C'>();
    sortedByQty.forEach((item) => {
      runQty += item.qty;
      const pct = totalQty > 0 ? (runQty / totalQty) * 100 : 100;
      let cls: 'A' | 'B' | 'C' = 'C';
      if (pct <= 80) cls = 'A';
      else if (pct <= 95) cls = 'B';
      abcQtyMap.set(item.code, cls);
    });

    // Montar resultado final
    return list.map((item) => {
      const marginPct = item.net > 0 ? (item.margin / item.net) * 100 : 0;
      const stk = stockMap.get(item.code);
      const isHighMargin = marginPct >= Math.max(22, medianMarginPct);
      const isHighVolume = item.qty >= medianQty;

      let quadrant: ProductQuadrant = 'review';
      if (isHighMargin && isHighVolume) quadrant = 'champion';
      else if (isHighMargin && !isHighVolume) quadrant = 'opportunity';
      else if (!isHighMargin && isHighVolume) quadrant = 'volume';
      else quadrant = 'review';

      const revAbc = abcRevMap.get(item.code) || { cls: 'C', cumPct: 100 };
      const marAbc = abcMarMap.get(item.code) || { cls: 'C', cumPct: 100 };
      const qtyAbc = abcQtyMap.get(item.code) || 'C';

      return {
        productCode: item.code,
        productDescription: item.desc,
        brandReference: item.brand || stk?.brandReference || '',
        totalQty: item.qty,
        totalNet: item.net,
        totalMargin: item.margin,
        marginPct,
        unitPriceAvg: item.qty > 0 ? item.net / item.qty : 0,
        unitProfitAvg: item.qty > 0 ? item.margin / item.qty : 0,
        stockQty: stk?.availableQty || 0,
        replacementCost: stk?.replacementCost || 0,
        listPrice: stk?.salePrice || stk?.publicPrice || 0,
        abcRevenueClass: revAbc.cls,
        abcMarginClass: marAbc.cls,
        abcQtyClass: qtyAbc,
        quadrant,
        cumRevenuePct: revAbc.cumPct,
        cumMarginPct: marAbc.cumPct,
      };
    });
  }, [auditedSales, stockMap]);

  // ── 2. Consolidação dos Clientes para o CRM ────────────────────────────────
  const customerSummaries = useMemo<CustomerCrmSummary[]>(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        net: number;
        margin: number;
        invoices: Set<string>;
        lastDate: string;
        seller: string;
        topProd: string;
        prodNetMax: number;
        prodNets: Map<string, number>;
      }
    >();

    const today = new Date();

    auditedSales.forEach((s) => {
      const code = normalizePersonCode(s.customerCode || '') || 'SEM_CODIGO';
      const name = s.customerName || 'Cliente não identificado';
      const cur = map.get(code) || {
        code,
        name,
        net: 0,
        margin: 0,
        invoices: new Set<string>(),
        lastDate: '',
        seller: s.sellerName || '',
        topProd: '',
        prodNetMax: 0,
        prodNets: new Map<string, number>(),
      };

      cur.net += s.netAmount || 0;
      cur.margin += s.marginCalculated ?? s.marginErp ?? 0;
      if (s.invoiceNumber || s.invoiceCode) cur.invoices.add(s.invoiceNumber || s.invoiceCode);
      if (s.issueDate && s.issueDate > cur.lastDate) cur.lastDate = s.issueDate;
      if (!cur.seller && s.sellerName) cur.seller = s.sellerName;

      // Track top product bought
      const pName = s.productDescription || s.productCode;
      const pNet = (cur.prodNets.get(pName) || 0) + (s.netAmount || 0);
      cur.prodNets.set(pName, pNet);
      if (pNet > cur.prodNetMax) {
        cur.prodNetMax = pNet;
        cur.topProd = pName;
      }

      map.set(code, cur);
    });

    const list = Array.from(map.values());
    if (!list.length) return [];

    const totalRev = list.reduce((a, b) => a + b.net, 0);
    const sorted = [...list].sort((a, b) => b.net - a.net);

    let run = 0;
    return sorted.map((item) => {
      run += item.net;
      const cumPct = totalRev > 0 ? (run / totalRev) * 100 : 100;
      let abcClass: 'A' | 'B' | 'C' = 'C';
      if (cumPct <= 80) abcClass = 'A';
      else if (cumPct <= 95) abcClass = 'B';

      const dDate = item.lastDate ? new Date(item.lastDate) : today;
      const diffMs = today.getTime() - dDate.getTime();
      const daysSince = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      const cDoc = customerMap.get(item.code);
      const delAmt = overdueByCustomer.get(item.code) || 0;

      let status: 'Adimplente' | 'Inadimplente' | 'Risco' = 'Adimplente';
      if (delAmt > 0) status = 'Inadimplente';
      else if (daysSince > 60 && abcClass !== 'C') status = 'Risco';

      return {
        customerCode: item.code,
        customerName: item.name,
        totalNet: item.net,
        totalMargin: item.margin,
        marginPct: item.net > 0 ? (item.margin / item.net) * 100 : 0,
        orderCount: item.invoices.size || 1,
        avgTicket: item.invoices.size > 0 ? item.net / item.invoices.size : item.net,
        lastPurchaseDate: item.lastDate,
        daysSinceLastPurchase: daysSince,
        abcClass,
        delinquentAmount: delAmt,
        status,
        mainSeller: item.seller,
        phone: cDoc?.phone || '',
        cellphone: cDoc?.cellphone || '',
        city: cDoc?.city || '',
        topProduct: item.topProd,
      };
    });
  }, [auditedSales, customerMap, overdueByCustomer]);

  // ── 3. Métricas Globais dos Quadrantes ──────────────────────────────────────
  const kpis = useMemo(() => {
    const totalRev = productSummaries.reduce((a, b) => a + b.totalNet, 0);
    const totalMargin = productSummaries.reduce((a, b) => a + b.totalMargin, 0);
    const avgMarginPct = totalRev > 0 ? (totalMargin / totalRev) * 100 : 0;

    const champions = productSummaries.filter((p) => p.quadrant === 'champion');
    const opportunities = productSummaries.filter((p) => p.quadrant === 'opportunity');
    const volumeItems = productSummaries.filter((p) => p.quadrant === 'volume');
    const reviewItems = productSummaries.filter((p) => p.quadrant === 'review');

    const championRev = champions.reduce((a, b) => a + b.totalNet, 0);
    const championMargin = champions.reduce((a, b) => a + b.totalMargin, 0);

    const opportunityMarginPotential = opportunities.reduce((a, b) => a + b.totalMargin * 0.15, 0);

    const classAProducts = productSummaries.filter((p) => p.abcRevenueClass === 'A');
    const classARev = classAProducts.reduce((a, b) => a + b.totalNet, 0);

    return {
      totalRev,
      totalMargin,
      avgMarginPct,
      championCount: champions.length,
      championRev,
      championMargin,
      opportunityCount: opportunities.length,
      opportunityMarginPotential,
      volumeCount: volumeItems.length,
      reviewCount: reviewItems.length,
      classACount: classAProducts.length,
      classARevPct: totalRev > 0 ? (classARev / totalRev) * 100 : 0,
      totalSKUs: productSummaries.length,
      totalCustomers: customerSummaries.length,
    };
  }, [productSummaries, customerSummaries]);

  // ── 4. Filtros para Tabelas ────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    return productSummaries.filter((p) => {
      if (quadrantFilter !== 'all' && p.quadrant !== quadrantFilter) return false;
      if (abcFilter !== 'all' && p.abcRevenueClass !== abcFilter) return false;
      if (minMarginFilter > 0 && p.marginPct < minMarginFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const matchDesc = p.productDescription.toLowerCase().includes(s);
        const matchCode = p.productCode.toLowerCase().includes(s);
        const matchBrand = p.brandReference.toLowerCase().includes(s);
        if (!matchDesc && !matchCode && !matchBrand) return false;
      }
      return true;
    });
  }, [productSummaries, quadrantFilter, abcFilter, minMarginFilter, search]);

  const filteredCustomers = useMemo(() => {
    return customerSummaries.filter((c) => {
      if (abcFilter !== 'all' && c.abcClass !== abcFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const matchName = c.customerName.toLowerCase().includes(s);
        const matchCode = c.customerCode.toLowerCase().includes(s);
        const matchCity = (c.city || '').toLowerCase().includes(s);
        if (!matchName && !matchCode && !matchCity) return false;
      }
      return true;
    });
  }, [customerSummaries, abcFilter, search]);

  // Dados para Gráfico Pareto ABC
  const paretoChartData = useMemo(() => {
    const list = abcTarget === 'products' ? [...productSummaries] : [...customerSummaries];
    if (!list.length) return [];

    let sorted: any[] = [];
    if (abcTarget === 'products') {
      if (abcMetric === 'revenue') sorted = [...productSummaries].sort((a, b) => b.totalNet - a.totalNet);
      else if (abcMetric === 'margin') sorted = [...productSummaries].sort((a, b) => b.totalMargin - a.totalMargin);
      else sorted = [...productSummaries].sort((a, b) => b.totalQty - a.totalQty);
    } else {
      if (abcMetric === 'revenue') sorted = [...customerSummaries].sort((a, b) => b.totalNet - a.totalNet);
      else sorted = [...customerSummaries].sort((a, b) => b.totalMargin - a.totalMargin);
    }

    const top15 = sorted.slice(0, 15);
    return top15.map((item, idx) => ({
      name: (item.productDescription || item.customerName || '').slice(0, 18) + '...',
      valor: item.totalNet || 0,
      margem: item.totalMargin || 0,
      cumPct: Number((item.cumRevenuePct || item.cumMarginPct || (idx + 1) * 6).toFixed(1)),
    }));
  }, [productSummaries, customerSummaries, abcTarget, abcMetric]);

  // Copiar Script Comercial
  const copyCommercialScript = (product: ProductCrmSummary) => {
    const script = `🔥 *OPORTUNIDADE DE VENDAS — PARIS DAKAR*\n📦 *Produto:* ${product.productDescription} (Cód: ${product.productCode})\n💰 *Preço Praticado Médio:* ${formatCurrency(product.unitPriceAvg)}\n📈 *Margem de Contribuição:* ${fmtPct(product.marginPct)}\n✨ *Por que vender agora:* Produto campeão com altíssimo giro e excelente rentabilidade garantida. Estoque disponível: ${fmtQty(product.stockQty)} un.`;
    navigator.clipboard.writeText(script);
    setCopiedScript(product.productCode);
    setTimeout(() => setCopiedScript(null), 2500);
  };

  // Exportar Relatório Excel do CRM
  const handleExportCrmExcel = () => {
    const rows = filteredProducts.map((p) => ({
      'Código Produto': p.productCode,
      'Descrição': p.productDescription,
      'Marca / Referência': p.brandReference,
      'Quadrante CRM':
        p.quadrant === 'champion'
          ? '🌟 Campeão (Alta Margem + Giro)'
          : p.quadrant === 'opportunity'
          ? '💎 Oportunidade (Alta Margem)'
          : p.quadrant === 'volume'
          ? '🚀 Puxador de Volume'
          : '⚠️ Revisar Preço',
      'Classe ABC Receita': p.abcRevenueClass,
      'Classe ABC Margem': p.abcMarginClass,
      'Quantidade Vendida': p.totalQty,
      'Estoque Atual': p.stockQty,
      'Preço Médio Venda': p.unitPriceAvg,
      'Custo Reposição': p.replacementCost,
      'Receita Líquida R$': p.totalNet,
      'Margem de Lucro R$': p.totalMargin,
      'Margem %': p.marginPct / 100,
    }));
    exportReportToExcel(rows, `CRM_Vendas_Curva_ABC_${selectedYear}`, 'CRM_Melhores_Produtos');
  };

  return (
    <div className="space-y-6">
      {/* ── CABEÇALHO & DESTAQUE ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#2D2A26] via-[#3F3B35] to-[#2D2A26] rounded-2xl p-6 text-white shadow-lg border border-[#3F3B35] relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-40 h-40 bg-[#C19A6B]/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C19A6B]/20 text-[#E6C594] text-xs font-semibold uppercase tracking-wider mb-3 border border-[#C19A6B]/30">
              <Zap className="w-3.5 h-3.5" /> CRM Comercial & Curva ABC
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
              Inteligência de Vendas & Melhores Produtos
            </h1>
            <p className="text-sm text-[#EAE6DF]/80 mt-1 max-w-2xl">
              Maximize a lucratividade da empresa focando os vendedores nos produtos de maior saída com melhor margem e recuperando clientes de alto potencial.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleExportCrmExcel}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all border border-white/15 shadow-xs"
            >
              <Download className="w-4 h-4 text-[#C19A6B]" />
              Exportar Matriz Excel
            </button>
          </div>
        </div>

        {/* ── KPI STRIP ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between text-xs text-[#EAE6DF]/70 mb-1 font-medium">
              <span>Campeões de Venda</span>
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            </div>
            <div className="text-2xl font-bold text-white">{kpis.championCount} SKUs</div>
            <div className="text-xs text-amber-300 mt-1 font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> {formatCurrency(kpis.championMargin)} em lucro gerado
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between text-xs text-[#EAE6DF]/70 mb-1 font-medium">
              <span>Oportunidades Ocultas</span>
              <Target className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-white">{kpis.opportunityCount} SKUs</div>
            <div className="text-xs text-emerald-300 mt-1 font-medium flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3" /> Alta margem c/ potencial ativo
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between text-xs text-[#EAE6DF]/70 mb-1 font-medium">
              <span>Concentração Classe A</span>
              <PieChartIcon className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-white">{fmtPct(kpis.classARevPct)}</div>
            <div className="text-xs text-[#EAE6DF]/80 mt-1">
              gerados por apenas {kpis.classACount} produtos
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center justify-between text-xs text-[#EAE6DF]/70 mb-1 font-medium">
              <span>Margem Média Geral</span>
              <Percent className="w-4 h-4 text-[#C19A6B]" />
            </div>
            <div className="text-2xl font-bold text-white">{fmtPct(kpis.avgMarginPct)}</div>
            <div className="text-xs text-[#EAE6DF]/80 mt-1">
              {formatCurrency(kpis.totalMargin)} margem total
            </div>
          </div>
        </div>
      </div>

      {/* ── NAVEGAÇÃO DE ABAS DO CRM ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EAE6DF] pb-3">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
              activeTab === 'matrix'
                ? 'bg-[#2D2A26] text-white shadow-md'
                : 'text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-white'
            }`}
          >
            <Star className="w-4 h-4 text-amber-400" />
            Melhores Produtos (Margem × Giro)
          </button>

          <button
            onClick={() => setActiveTab('abc')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
              activeTab === 'abc'
                ? 'bg-[#2D2A26] text-white shadow-md'
                : 'text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-white'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-blue-400" />
            Curva ABC Inteligente
          </button>

          <button
            onClick={() => setActiveTab('customers')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
              activeTab === 'customers'
                ? 'bg-[#2D2A26] text-white shadow-md'
                : 'text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-white'
            }`}
          >
            <Users className="w-4 h-4 text-emerald-400" />
            Carteira & Recompra de Clientes
          </button>
        </div>

        {/* BUSCA RÁPIDA */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8B7D6B]" />
          <input
            type="text"
            placeholder="Buscar produto, marca ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#EAE6DF] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C19A6B]"
          />
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ABA 1: MATRIZ DE MELHORES PRODUTOS PARA VENDA                           */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'matrix' && (
        <div className="space-y-6">
          {/* QUADRANTES ESTRATÉGICOS DE DECISÃO COMERCIAL */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* QUADRANTE 1: CAMPEÕES */}
            <button
              onClick={() => setQuadrantFilter(quadrantFilter === 'champion' ? 'all' : 'champion')}
              className={`p-5 rounded-2xl text-left border transition-all relative overflow-hidden ${
                quadrantFilter === 'champion'
                  ? 'bg-amber-500 text-white border-amber-600 shadow-lg scale-[1.02]'
                  : 'bg-white hover:bg-amber-50/50 border-amber-200 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                    quadrantFilter === 'champion' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  <Star className="w-5 h-5 fill-current" />
                </div>
                <span
                  className={`text-xs font-extrabold uppercase px-2.5 py-1 rounded-full ${
                    quadrantFilter === 'champion'
                      ? 'bg-white text-amber-900 font-bold'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  FOCO TOTAL
                </span>
              </div>
              <h3 className={`font-bold text-lg ${quadrantFilter === 'champion' ? 'text-white' : 'text-[#2D2A26]'}`}>
                🌟 Produtos Campeões
              </h3>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  quadrantFilter === 'champion' ? 'text-amber-100' : 'text-[#8B7D6B]'
                }`}
              >
                Alta Margem (≥22%) + Maior Giro/Saída. Os itens mais lucrativos e desejados pelos clientes!
              </p>
              <div className="mt-4 pt-3 border-t border-current/10 flex items-center justify-between text-xs font-bold">
                <span>{kpis.championCount} SKUs Identificados</span>
                <span>{formatCurrency(kpis.championRev)}</span>
              </div>
            </button>

            {/* QUADRANTE 2: OPORTUNIDADES OCULTAS */}
            <button
              onClick={() => setQuadrantFilter(quadrantFilter === 'opportunity' ? 'all' : 'opportunity')}
              className={`p-5 rounded-2xl text-left border transition-all relative overflow-hidden ${
                quadrantFilter === 'opportunity'
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-lg scale-[1.02]'
                  : 'bg-white hover:bg-emerald-50/50 border-emerald-200 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                    quadrantFilter === 'opportunity'
                      ? 'bg-white/20 text-white'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  <Target className="w-5 h-5" />
                </div>
                <span
                  className={`text-xs font-extrabold uppercase px-2.5 py-1 rounded-full ${
                    quadrantFilter === 'opportunity'
                      ? 'bg-white text-emerald-900 font-bold'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  OFERTA ATIVA
                </span>
              </div>
              <h3
                className={`font-bold text-lg ${quadrantFilter === 'opportunity' ? 'text-white' : 'text-[#2D2A26]'}`}
              >
                💎 Oportunidades de Margem
              </h3>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  quadrantFilter === 'opportunity' ? 'text-emerald-100' : 'text-[#8B7D6B]'
                }`}
              >
                Alta Margem (≥25%), mas menor saída. Ouro em pó para a equipe comercial oferecer ativamente!
              </p>
              <div className="mt-4 pt-3 border-t border-current/10 flex items-center justify-between text-xs font-bold">
                <span>{kpis.opportunityCount} SKUs a Impulsionar</span>
                <span>+ {formatCurrency(kpis.opportunityMarginPotential)} potencial</span>
              </div>
            </button>

            {/* QUADRANTE 3: PUXADORES DE VOLUME */}
            <button
              onClick={() => setQuadrantFilter(quadrantFilter === 'volume' ? 'all' : 'volume')}
              className={`p-5 rounded-2xl text-left border transition-all relative overflow-hidden ${
                quadrantFilter === 'volume'
                  ? 'bg-blue-600 text-white border-blue-700 shadow-lg scale-[1.02]'
                  : 'bg-white hover:bg-blue-50/50 border-blue-200 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                    quadrantFilter === 'volume' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  <TrendingUp className="w-5 h-5" />
                </div>
                <span
                  className={`text-xs font-extrabold uppercase px-2.5 py-1 rounded-full ${
                    quadrantFilter === 'volume' ? 'bg-white text-blue-900 font-bold' : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  VENDA CASADA
                </span>
              </div>
              <h3 className={`font-bold text-lg ${quadrantFilter === 'volume' ? 'text-white' : 'text-[#2D2A26]'}`}>
                🚀 Puxadores de Volume
              </h3>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  quadrantFilter === 'volume' ? 'text-blue-100' : 'text-[#8B7D6B]'
                }`}
              >
                Giro Alto com margem moderada. Perfeitos como isca comercial para vender junto produtos campeões!
              </p>
              <div className="mt-4 pt-3 border-t border-current/10 flex items-center justify-between text-xs font-bold">
                <span>{kpis.volumeCount} SKUs de Alto Giro</span>
                <span>Giro Constante</span>
              </div>
            </button>

            {/* QUADRANTE 4: REVISÃO DE PREÇO */}
            <button
              onClick={() => setQuadrantFilter(quadrantFilter === 'review' ? 'all' : 'review')}
              className={`p-5 rounded-2xl text-left border transition-all relative overflow-hidden ${
                quadrantFilter === 'review'
                  ? 'bg-slate-700 text-white border-slate-800 shadow-lg scale-[1.02]'
                  : 'bg-white hover:bg-slate-50/50 border-slate-200 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                    quadrantFilter === 'review' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <span
                  className={`text-xs font-extrabold uppercase px-2.5 py-1 rounded-full ${
                    quadrantFilter === 'review' ? 'bg-white text-slate-900 font-bold' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  REVISAR PREÇO
                </span>
              </div>
              <h3 className={`font-bold text-lg ${quadrantFilter === 'review' ? 'text-white' : 'text-[#2D2A26]'}`}>
                ⚠️ Baixa Performance
              </h3>
              <p
                className={`text-xs mt-1 leading-relaxed ${
                  quadrantFilter === 'review' ? 'text-slate-100' : 'text-[#8B7D6B]'
                }`}
              >
                Baixa margem e baixo giro. Requer reajuste de preço de lista ou descontinuação.
              </p>
              <div className="mt-4 pt-3 border-t border-current/10 flex items-center justify-between text-xs font-bold">
                <span>{kpis.reviewCount} SKUs Sob Análise</span>
                <span>Ajustar Margem</span>
              </div>
            </button>
          </div>

          {/* TABELA DA MATRIZ DE PRODUTOS PARA VENDA */}
          <div className="bg-white rounded-2xl border border-[#EAE6DF] shadow-xs overflow-hidden">
            <div className="p-5 border-b border-[#EAE6DF] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#FAF8F5]">
              <div>
                <h3 className="font-extrabold text-[#2D2A26] text-lg flex items-center gap-2">
                  <Flame className="w-5 h-5 text-amber-500" /> Ranking de Melhores Produtos para Oferta Comercial
                </h3>
                <p className="text-xs text-[#8B7D6B] mt-0.5">
                  Mostrando {filteredProducts.length} de {productSummaries.length} produtos ordenados por maior lucro e saída
                </p>
              </div>

              {quadrantFilter !== 'all' && (
                <button
                  onClick={() => setQuadrantFilter('all')}
                  className="text-xs font-semibold text-[#C19A6B] hover:underline flex items-center gap-1"
                >
                  Limpar filtro de quadrante ({filteredProducts.length} exibidos)
                </button>
              )}
            </div>

            <div className="overflow-x-auto min-w-0">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F3F1ED] text-[#2D2A26] uppercase font-bold border-b border-[#EAE6DF] tracking-wider">
                    <th className="py-3 px-4">Classificação CRM</th>
                    <th className="py-3 px-4">Código & Produto</th>
                    <th className="py-3 px-4 text-center">Curva ABC</th>
                    <th className="py-3 px-4 text-right">Saída (Giro)</th>
                    <th className="py-3 px-4 text-right">Estoque</th>
                    <th className="py-3 px-4 text-right">Preço Médio</th>
                    <th className="py-3 px-4 text-right">Receita Líquida</th>
                    <th className="py-3 px-4 text-right">Lucro Gerado</th>
                    <th className="py-3 px-4 text-right">Margem %</th>
                    <th className="py-3 px-4 text-center">Ação Vendedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE6DF]">
                  {filteredProducts.slice(0, 50).map((p, idx) => {
                    const isCopied = copiedScript === p.productCode;
                    return (
                      <tr key={p.productCode} className="hover:bg-amber-50/40 transition-colors group">
                        {/* CLASSIFICAÇÃO QUADRANTE */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {p.quadrant === 'champion' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-bold border border-amber-300">
                              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> Campeão
                            </span>
                          )}
                          {p.quadrant === 'opportunity' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 font-bold border border-emerald-300">
                              <Target className="w-3.5 h-3.5 text-emerald-600" /> Oportunidade
                            </span>
                          )}
                          {p.quadrant === 'volume' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 text-blue-900 font-medium border border-blue-300">
                              <TrendingUp className="w-3.5 h-3.5 text-blue-600" /> Volume
                            </span>
                          )}
                          {p.quadrant === 'review' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium border border-slate-300">
                              <AlertTriangle className="w-3.5 h-3.5 text-slate-500" /> Revisar
                            </span>
                          )}
                        </td>

                        {/* PRODUTO */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#2D2A26] group-hover:text-[#C19A6B] transition-colors">
                            {p.productDescription}
                          </div>
                          <div className="text-[11px] text-[#8B7D6B] font-mono flex items-center gap-2">
                            <span>Cód: {p.productCode}</span>
                            {p.brandReference && <span>• Ref: {p.brandReference}</span>}
                          </div>
                        </td>

                        {/* CURVA ABC */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full font-black text-xs ${
                              p.abcRevenueClass === 'A'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-xs'
                                : p.abcRevenueClass === 'B'
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-slate-100 text-slate-600 border border-slate-300'
                            }`}
                          >
                            Classe {p.abcRevenueClass}
                          </span>
                        </td>

                        {/* SAÍDA */}
                        <td className="py-3.5 px-4 text-right font-semibold text-[#2D2A26]">
                          {fmtQty(p.totalQty)} un
                        </td>

                        {/* ESTOQUE */}
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`font-semibold ${
                              p.stockQty > 0 ? 'text-emerald-700' : 'text-rose-600 font-bold'
                            }`}
                          >
                            {fmtQty(p.stockQty)} un
                          </span>
                        </td>

                        {/* PREÇO MÉDIO */}
                        <td className="py-3.5 px-4 text-right font-medium text-[#2D2A26]">
                          {formatCurrency(p.unitPriceAvg)}
                        </td>

                        {/* RECEITA LÍQUIDA */}
                        <td className="py-3.5 px-4 text-right font-bold text-[#2D2A26]">
                          {formatCurrency(p.totalNet)}
                        </td>

                        {/* LUCRO GERADO */}
                        <td className="py-3.5 px-4 text-right font-extrabold text-emerald-700">
                          {formatCurrency(p.totalMargin)}
                        </td>

                        {/* MARGEM % */}
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`font-extrabold px-2 py-0.5 rounded-md ${
                              p.marginPct >= 30
                                ? 'bg-emerald-100 text-emerald-800'
                                : p.marginPct >= 20
                                ? 'bg-blue-100 text-blue-800'
                                : p.marginPct >= 10
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {fmtPct(p.marginPct)}
                          </span>
                        </td>

                        {/* AÇÃO VENDEDOR */}
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => copyCommercialScript(p)}
                            title="Copiar argumento de venda comercial"
                            className={`p-2 rounded-lg transition-all ${
                              isCopied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-white hover:bg-[#2D2A26] hover:text-white text-[#2D2A26] border border-[#EAE6DF]'
                            }`}
                          >
                            {isCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ABA 2: CURVA ABC INTELIGENTE (PRODUTOS & CLIENTES)                      */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'abc' && (
        <div className="space-y-6">
          {/* CONTROLES DA CURVA ABC */}
          <div className="bg-white rounded-2xl p-5 border border-[#EAE6DF] shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase text-[#8B7D6B]">Analisar Curva ABC De:</span>
              <div className="flex items-center bg-[#F3F1ED] p-1 rounded-xl">
                <button
                  onClick={() => setAbcTarget('products')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    abcTarget === 'products' ? 'bg-[#2D2A26] text-white shadow-xs' : 'text-[#8B7D6B] hover:text-[#2D2A26]'
                  }`}
                >
                  📦 Produtos
                </button>
                <button
                  onClick={() => setAbcTarget('customers')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    abcTarget === 'customers' ? 'bg-[#2D2A26] text-white shadow-xs' : 'text-[#8B7D6B] hover:text-[#2D2A26]'
                  }`}
                >
                  👥 Clientes
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase text-[#8B7D6B]">Base da Classificação:</span>
              <div className="flex items-center bg-[#F3F1ED] p-1 rounded-xl">
                <button
                  onClick={() => setAbcMetric('revenue')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    abcMetric === 'revenue' ? 'bg-[#C19A6B] text-white shadow-xs' : 'text-[#8B7D6B] hover:text-[#2D2A26]'
                  }`}
                >
                  Receita R$
                </button>
                <button
                  onClick={() => setAbcMetric('margin')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    abcMetric === 'margin' ? 'bg-[#C19A6B] text-white shadow-xs' : 'text-[#8B7D6B] hover:text-[#2D2A26]'
                  }`}
                >
                  Lucro Margem R$
                </button>
                {abcTarget === 'products' && (
                  <button
                    onClick={() => setAbcMetric('qty')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      abcMetric === 'qty' ? 'bg-[#C19A6B] text-white shadow-xs' : 'text-[#8B7D6B] hover:text-[#2D2A26]'
                    }`}
                  >
                    Saída (Giro)
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* GRÁFICO PARETO DA CURVA ABC */}
          <div className="bg-white rounded-2xl p-6 border border-[#EAE6DF] shadow-xs">
            <h3 className="font-extrabold text-[#2D2A26] text-base mb-1 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#C19A6B]" /> Gráfico de Pareto — Concentração ABC (Top 15 Ícones)
            </h3>
            <p className="text-xs text-[#8B7D6B] mb-6">
              Demonstração da Lei de Pareto 80/20: a fatia azul representa o valor absoluto e a linha dourada o percentual acumulado.
            </p>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={paretoChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAE6DF" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8B7D6B' }} interval={0} />
                  <YAxis yAxisId="left" tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#8B7D6B' }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} domain={[0, 100]} tick={{ fontSize: 11, fill: '#8B7D6B' }} />
                  <Tooltip
                    formatter={(val: any, name: any) => [
                      name === 'cumPct' ? `${val}%` : formatCurrency(Number(val)),
                      name === 'cumPct' ? '% Acumulado' : name === 'valor' ? 'Receita R$' : 'Margem R$',
                    ]}
                  />
                  <Bar yAxisId="left" dataKey="valor" fill="#2D2A26" radius={[6, 6, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="#C19A6B" strokeWidth={3} dot={{ r: 4, fill: '#C19A6B' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* TABELA CURVA ABC COMPLETA */}
          <div className="bg-white rounded-2xl border border-[#EAE6DF] shadow-xs overflow-hidden">
            <div className="p-4 bg-[#FAF8F5] border-b border-[#EAE6DF] flex items-center justify-between">
              <h3 className="font-bold text-[#2D2A26] text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" /> Tabela Detalhada de Classificação Curva ABC (80 / 15 / 5)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAbcFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${abcFilter === 'all' ? 'bg-[#2D2A26] text-white' : 'text-[#8B7D6B]'}`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setAbcFilter('A')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold ${abcFilter === 'A' ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-900'}`}
                >
                  Classe A (80%)
                </button>
                <button
                  onClick={() => setAbcFilter('B')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold ${abcFilter === 'B' ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-900'}`}
                >
                  Classe B (15%)
                </button>
                <button
                  onClick={() => setAbcFilter('C')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold ${abcFilter === 'C' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-800'}`}
                >
                  Classe C (5%)
                </button>
              </div>
            </div>

            <div className="overflow-x-auto min-w-0">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F3F1ED] text-[#2D2A26] font-bold uppercase border-b border-[#EAE6DF]">
                    <th className="py-3 px-4 text-center">Posição</th>
                    <th className="py-3 px-4">Item / Nome</th>
                    <th className="py-3 px-4 text-center">Classe ABC</th>
                    <th className="py-3 px-4 text-right">Quantidade</th>
                    <th className="py-3 px-4 text-right">Receita Líquida</th>
                    <th className="py-3 px-4 text-right">Margem de Lucro</th>
                    <th className="py-3 px-4 text-right">Margem %</th>
                    <th className="py-3 px-4 text-right">% Acumulado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE6DF]">
                  {(abcTarget === 'products' ? filteredProducts : filteredCustomers).slice(0, 100).map((item: any, idx) => (
                    <tr key={item.productCode || item.customerCode} className="hover:bg-amber-50/30">
                      <td className="py-3 px-4 text-center font-bold text-[#8B7D6B]">#{idx + 1}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#2D2A26]">{item.productDescription || item.customerName}</div>
                        <div className="text-[11px] text-[#8B7D6B] font-mono">{item.productCode || item.customerCode}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full font-black text-xs ${
                            (item.abcRevenueClass || item.abcClass) === 'A'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : (item.abcRevenueClass || item.abcClass) === 'B'
                              ? 'bg-blue-100 text-blue-900 border border-blue-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                          }`}
                        >
                          Classe {item.abcRevenueClass || item.abcClass}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium">{fmtQty(item.totalQty || item.orderCount)}</td>
                      <td className="py-3 px-4 text-right font-bold">{formatCurrency(item.totalNet)}</td>
                      <td className="py-3 px-4 text-right font-semibold text-emerald-700">{formatCurrency(item.totalMargin)}</td>
                      <td className="py-3 px-4 text-right font-bold">{fmtPct(item.marginPct)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#C19A6B]">
                        {fmtPct(item.cumRevenuePct || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ABA 3: CARTEIRA DE CLIENTES & RECOMPRA                                  */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'customers' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#EAE6DF] shadow-xs overflow-hidden">
            <div className="p-5 bg-[#FAF8F5] border-b border-[#EAE6DF] flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-[#2D2A26] text-lg flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600" /> Gestão Comercial de Carteira de Clientes
                </h3>
                <p className="text-xs text-[#8B7D6B]">
                  Identifique os principais clientes da empresa, controle o ticket médio e recupere clientes em risco de inatividade.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto min-w-0">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F3F1ED] text-[#2D2A26] font-bold uppercase border-b border-[#EAE6DF]">
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4 text-center">Classe ABC</th>
                    <th className="py-3 px-4 text-center">Situação</th>
                    <th className="py-3 px-4 text-right">Compras (Pedidos)</th>
                    <th className="py-3 px-4 text-right">Ticket Médio</th>
                    <th className="py-3 px-4 text-right">Faturamento Total</th>
                    <th className="py-3 px-4 text-right">Lucro Total</th>
                    <th className="py-3 px-4 text-center">Última Compra</th>
                    <th className="py-3 px-4 text-center">Ação CRM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE6DF]">
                  {filteredCustomers.slice(0, 50).map((c) => (
                    <tr key={c.customerCode} className="hover:bg-amber-50/30">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#2D2A26]">{c.customerName}</div>
                        <div className="text-[11px] text-[#8B7D6B] flex items-center gap-2">
                          <span>Cód: {c.customerCode}</span>
                          {c.city && <span>• {c.city}</span>}
                          {c.mainSeller && <span>• Vendedor: {c.mainSeller}</span>}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full font-black text-xs ${
                            c.abcClass === 'A'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : c.abcClass === 'B'
                              ? 'bg-blue-100 text-blue-900 border border-blue-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-300'
                          }`}
                        >
                          Classe {c.abcClass}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {c.status === 'Inadimplente' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold border border-rose-300">
                            <AlertCircle className="w-3 h-3 text-rose-600" /> Deve {formatCurrency(c.delinquentAmount)}
                          </span>
                        ) : c.status === 'Risco' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold border border-amber-300">
                            <ClockIcon className="w-3 h-3 text-amber-600" /> Sumido ({c.daysSinceLastPurchase}d)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Ativo
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right font-medium">{c.orderCount} notas</td>
                      <td className="py-3.5 px-4 text-right font-bold text-[#2D2A26]">{formatCurrency(c.avgTicket)}</td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-[#2D2A26]">{formatCurrency(c.totalNet)}</td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-emerald-700">{formatCurrency(c.totalMargin)}</td>

                      <td className="py-3.5 px-4 text-center whitespace-nowrap text-xs">
                        <span className="font-semibold text-[#2D2A26]">{c.lastPurchaseDate || 'N/A'}</span>
                        <div className="text-[11px] text-[#8B7D6B]">{c.daysSinceLastPurchase} dias atrás</div>
                      </td>

                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <WhatsAppLink
                          phone={c.cellphone || c.phone}
                          message={`Olá ${c.customerName}, tudo bem? Sou da equipe Paris Dakar. Temos uma condição especial em produtos para reposição do seu estoque hoje!`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function ClockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
