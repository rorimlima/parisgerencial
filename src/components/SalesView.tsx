/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SalesView — "Vendas de Produtos" (relatório RPR001)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Esta tela não é um relatório de faturamento — o Faturamento já existe e olha
 * a nota inteira. Aqui a granularidade é o ITEM, e a pergunta é outra: cada
 * produto que saiu pela porta saiu por um preço que fazia sentido?
 *
 * VÍNCULOS (o que o gestor pediu, e por que importam)
 * ---------------------------------------------------
 *   NFItem_ProdutoCod ⇄ Produto_Codigo (Estoque)
 *       Sem isso, "margem" é só o custo congelado que o ERP gravou na nota.
 *       Com isso, dá para comparar o preço praticado com o custo de reposição
 *       ATUAL — que é o que determina se repor aquele item ainda vale a pena.
 *
 *   NF_PessoaCod ⇄ cod_cliente (Cadastro de Clientes)
 *       Traz cidade, limite de crédito e situação de inadimplência para o lado
 *       da venda. Desconto alto para cliente adimplente é política comercial;
 *       desconto alto para quem já deve é o começo de um prejuízo duplo.
 *
 * SEIS ABAS, UMA PERGUNTA CADA
 * ----------------------------
 *   Visão Geral  quanto vendemos, com que desconto e que margem sobrou
 *   Vendedores   quem entrega margem e quem entrega volume com desconto
 *   Clientes     onde o desconto está concentrado
 *   Produtos     que SKU destrói margem e qual tem preço fora de controle
 *   Auditoria    a lista de linhas que precisam de explicação, por severidade
 *   Vínculos     o tamanho do ponto cego: o que não casou com os cadastros
 *
 * PERFORMANCE: 16.600 linhas. Nada é renderizado inteiro — auditoria e
 * consolidados são memoizados sobre o recorte filtrado, e todas as tabelas
 * paginam. Trocar de aba não recalcula a auditoria.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  Boxes,
  Download,
  Link2,
  Percent,
  Search,
  ShoppingCart,
  Users2,
  SlidersHorizontal,
  TrendingDown,
  UploadCloud,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  AuditedSale,
  Customer,
  DEFAULT_SALES_THRESHOLDS,
  DelinquentTitle,
  SaleItem,
  SalesAuditThresholds,
  Seller,
  StockItem,
} from '../types';
import type { SellerSyncResult } from '../services/salesService';
import { exportReportToExcel, formatCurrency } from '../utils/exportUtils';
import { parseSalesRows } from '../utils/sheetParsers';
import {
  auditSales,
  buildCustomerSummaries,
  buildProductSummaries,
  buildSalesMonthSummaries,
  buildSellerSummaries,
  FLAG_LABELS,
} from '../utils/salesAudit';
import { normalizePersonCode } from '../utils/linking';
import { useDebouncedValue, usePagination, useSort } from '../utils/uiHooks';

interface SalesViewProps {
  items: SaleItem[];
  stockItems: StockItem[];
  customers: Customer[];
  sellers: Seller[];
  delinquentTitles: DelinquentTitle[];
  availableYears: number[];
  selectedYear: number;
  isLoading: boolean;
  onImportSales: (items: SaleItem[]) => Promise<void> | void;
  /** Cadastra na base de vendedores todos os que aparecem nas notas. */
  onSyncSellers: (items: SaleItem[]) => Promise<SellerSyncResult | null>;
  onReload: () => void;
  onLoadYear: (year: number) => void;
  userRole: string;
}

type SalesTab = 'crm' | 'geral' | 'vendedores' | 'clientes' | 'produtos' | 'auditoria' | 'vinculos';

const TABS: { id: SalesTab; label: string }[] = [
  { id: 'crm', label: '🔥 CRM & Curva ABC' },
  { id: 'geral', label: 'Visão Geral' },
  { id: 'vendedores', label: 'Vendedores' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'produtos', label: 'Produtos' },
  { id: 'auditoria', label: 'Auditoria' },
  { id: 'vinculos', label: 'Vínculos' },
];

const fmtQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const fmtPct = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const fmtInt = (n: number) => n.toLocaleString('pt-BR');

export const SalesView: React.FC<SalesViewProps> = ({
  items,
  stockItems,
  customers,
  sellers: registeredSellers,
  delinquentTitles,
  availableYears,
  selectedYear,
  isLoading,
  onImportSales,
  onSyncSellers,
  onReload,
  onLoadYear,
  userRole,
}) => {
  const [tab, setTab] = useState<SalesTab>('crm');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [sellerFilter, setSellerFilter] = useState('all');
  const [originFilter, setOriginFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critico' | 'alto' | 'medio'>('all');
  const [flagFilter, setFlagFilter] = useState<string>('all');
  const [thresholds, setThresholds] = useState<SalesAuditThresholds>(DEFAULT_SALES_THRESHOLDS);
  const [showParams, setShowParams] = useState(false);
  const [detail, setDetail] = useState<AuditedSale | null>(null);
  const [importStatus, setImportStatus] = useState<string>('');
  const [importDiagnostics, setImportDiagnostics] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [sellerSync, setSellerSync] = useState<SellerSyncResult | null>(null);
  const [isSyncingSellers, setIsSyncingSellers] = useState(false);

  const canEdit = userRole !== 'analista';

  // ── Recorte antes da auditoria ─────────────────────────────────────────────
  // Filtramos ANTES de auditar, não depois, porque a mediana de preço por SKU
  // (base da detecção de preço fora da curva) tem que ser calculada sobre o
  // mesmo universo que o gestor está olhando. Auditar tudo e filtrar depois
  // compararia o preço de 2026 com a mediana de seis anos de inflação.
  const scoped = useMemo(() => {
    return items.filter((i) => {
      if (yearFilter !== 'all' && i.year !== yearFilter) return false;
      if (sellerFilter !== 'all' && i.sellerName !== sellerFilter) return false;
      if (originFilter !== 'all' && i.origin !== originFilter) return false;
      return true;
    });
  }, [items, yearFilter, sellerFilter, originFilter]);

  const audit = useMemo(
    () => auditSales(scoped, stockItems, customers, thresholds),
    [scoped, stockItems, customers, thresholds]
  );

  const sellers = useMemo(() => buildSellerSummaries(audit.audited, thresholds), [audit.audited, thresholds]);
  const customerRows = useMemo(() => buildCustomerSummaries(audit.audited, customers), [audit.audited, customers]);
  const products = useMemo(() => buildProductSummaries(audit.audited, stockItems), [audit.audited, stockItems]);
  const months = useMemo(() => buildSalesMonthSummaries(audit.audited), [audit.audited]);

  const sellerOptions = useMemo(
    () => [...new Set(items.map((i) => i.sellerName).filter(Boolean))].sort(),
    [items]
  );
  const originOptions = useMemo(
    () => [...new Set(items.map((i) => i.origin).filter(Boolean))].sort(),
    [items]
  );
  const yearOptions = useMemo(
    () => [...new Set(items.map((i) => i.year).filter(Boolean))].sort((a, b) => b - a),
    [items]
  );

  // Inadimplência por cliente — permite mostrar, ao lado do desconto, quanto
  // aquele cliente já deve vencido. É o cruzamento que transforma "desconto
  // generoso" em "risco composto".
  const overdueByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    delinquentTitles.forEach((t) => {
      const k = normalizePersonCode(t.customerCode);
      if (!k) return;
      map.set(k, (map.get(k) || 0) + (t.updatedAmount || t.originalAmount || 0));
    });
    return map;
  }, [delinquentTitles]);

  // ── Importação ─────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setIsImporting(true);
    setImportDiagnostics([]);
    setImportStatus('Lendo a planilha...');
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      const parsed = parseSalesRows(rows);

      if (!parsed.items.length) {
        setImportStatus('Nenhuma linha de venda válida encontrada na planilha.');
        setIsImporting(false);
        return;
      }

      // O diagnóstico não é decorativo: este relatório traz inconsistências
      // sistemáticas e o gestor precisa saber disso ANTES de decidir em cima
      // do número, não depois.
      const diag: string[] = [];
      if (parsed.missingHeaders.length) {
        diag.push(
          `Faltam ${parsed.missingHeaders.length} colunas esperadas ` +
          `(${parsed.missingHeaders.slice(0, 4).join(', ')}${parsed.missingHeaders.length > 4 ? '…' : ''}) — ` +
          'os campos ausentes ficam vazios.'
        );
      }
      if (parsed.integrity.unitPriceMismatch) {
        diag.push(
          `${fmtInt(parsed.integrity.unitPriceMismatch)} linhas com NFItem_VlBruto diferente de ` +
          'NFItem_VlUnit. O sistema usa NFItem_VlUnit, que é o valor que fecha com o total da nota.'
        );
      }
      if (parsed.integrity.marginMismatch) {
        diag.push(
          `${fmtInt(parsed.integrity.marginMismatch)} linhas em que a margem do ERP não fecha com ` +
          `Total − Custo − Impostos (divergência líquida de ${formatCurrency(parsed.integrity.marginMismatchAmount)}). ` +
          'A tela mostra as duas margens para conferência.'
        );
      }
      if (parsed.integrity.totalMismatch) {
        diag.push(
          `${fmtInt(parsed.integrity.totalMismatch)} linhas em que NFItem_VlTotal não fecha com ` +
          'Unitário × Qtde − Desconto + Acréscimo.'
        );
      }
      if (parsed.integrity.zeroCost) {
        diag.push(
          `${fmtInt(parsed.integrity.zeroCost)} linhas com custo zerado — a margem delas é fictícia ` +
          'e aparecem marcadas na aba Auditoria.'
        );
      }
      if (parsed.duplicateKeys) {
        diag.push(`${fmtInt(parsed.duplicateKeys)} chaves repetidas no arquivo foram consolidadas.`);
      }
      if (parsed.errors.length) {
        diag.push(`${fmtInt(parsed.errors.length)} linhas com erro de leitura foram ignoradas.`);
      }
      setImportDiagnostics(diag);

      setImportStatus(`Gravando ${fmtInt(parsed.items.length)} linhas (atualiza as existentes, não duplica)...`);
      await onImportSales(parsed.items);
      const anos = [...new Set(parsed.items.map((i) => i.year).filter(Boolean))].sort();
      setImportStatus(
        `Importação concluída: ${fmtInt(parsed.items.length)} linhas de ${fmtInt(
          new Set(parsed.items.map((i) => `${i.companyCode}|${i.invoiceCode}`)).size
        )} notas, anos ${anos.join(', ')}.`
      );

      // A equipe de vendas é sincronizada junto com a carga, não como passo
      // separado: se o vendedor não estiver cadastrado no momento em que a
      // inadimplência for importada, o título vencido fica sem dono e a
      // exposição por vendedor sai errada. Sincronizar aqui garante que o
      // cadastro já existe antes de qualquer cruzamento.
      const sync = await onSyncSellers(parsed.items);
      if (sync) setSellerSync(sync);
    } catch (err: any) {
      setImportStatus(`Erro ao importar: ${err?.message || err}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSyncSellers = async () => {
    setIsSyncingSellers(true);
    try {
      const sync = await onSyncSellers(items);
      if (sync) setSellerSync(sync);
    } finally {
      setIsSyncingSellers(false);
    }
  };

  // ── Exportação: uma pasta de trabalho por aba visível ──────────────────────
  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (tab === 'vendedores') {
      exportReportToExcel(
        sellers.map((s) => ({
          Código: s.sellerCode,
          Vendedor: s.sellerName,
          Notas: s.invoices,
          Itens: s.lines,
          Clientes: s.customers,
          'Valor Bruto': s.grossAmount,
          Desconto: s.discountAmount,
          'Desconto %': s.discountPercent,
          'Receita Líquida': s.netAmount,
          Custo: s.costAmount,
          Margem: s.marginAmount,
          'Margem %': s.marginPercent,
          'Desvio vs. mediana da equipe (p.p.)': s.marginDeviation,
          'Ticket Médio': s.averageTicket,
          'Itens no prejuízo': s.negativeLines,
          'Prejuízo': s.negativeAmount,
          'Itens com desconto acima do teto': s.highDiscountLines,
          'Valor em risco': s.riskAmount,
        })),
        'Vendedores',
        `vendas_vendedores_${stamp}`
      );
      return;
    }
    if (tab === 'clientes') {
      exportReportToExcel(
        customerRows.map((c) => ({
          'Cod. Cliente': c.customerCode,
          Cliente: c.customerName,
          'Vinculado ao cadastro': c.linked ? 'Sim' : 'Não',
          Cidade: c.city,
          UF: c.state,
          Notas: c.invoices,
          Itens: c.lines,
          'Valor Bruto': c.grossAmount,
          Desconto: c.discountAmount,
          'Desconto %': c.discountPercent,
          'Receita Líquida': c.netAmount,
          Margem: c.marginAmount,
          'Margem %': c.marginPercent,
          'Itens no prejuízo': c.negativeLines,
          Prejuízo: c.negativeAmount,
          'Em atraso (R$)': overdueByCustomer.get(normalizePersonCode(c.customerCode)) || 0,
          'Vendedor principal': c.mainSeller,
          'Nº de vendedores': c.sellers.length,
          'Primeira compra': c.firstPurchaseDate,
          'Última compra': c.lastPurchaseDate,
          'Valor em risco': c.riskAmount,
        })),
        'Clientes',
        `vendas_clientes_${stamp}`
      );
      return;
    }
    if (tab === 'produtos') {
      exportReportToExcel(
        products.map((p) => ({
          'Cod. Produto': p.productCode,
          Produto: p.productDescription,
          Referência: p.brandReference,
          'No estoque': p.linked ? 'Sim' : 'Não',
          'Saldo atual': p.availableQty,
          'Custo reposição atual': p.currentCost,
          'Preço tabela atual': p.currentSalePrice,
          Itens: p.lines,
          Quantidade: p.quantity,
          'Valor Bruto': p.grossAmount,
          Desconto: p.discountAmount,
          'Desconto %': p.discountPercent,
          'Receita Líquida': p.netAmount,
          Custo: p.costAmount,
          Margem: p.marginAmount,
          'Margem %': p.marginPercent,
          'Preço mín.': p.minUnitPrice,
          'Preço mediano': p.medianUnitPrice,
          'Preço máx.': p.maxUnitPrice,
          'Dispersão (máx/mín)': p.priceSpread,
          'Itens no prejuízo': p.negativeLines,
          Prejuízo: p.negativeAmount,
        })),
        'Produtos',
        `vendas_produtos_${stamp}`
      );
      return;
    }
    if (tab === 'auditoria') {
      exportReportToExcel(
        audit.flagged.map((a) => ({
          Severidade: a.worstSeverity,
          Apontamentos: a.flags.map((f) => FLAG_LABELS[f.code] || f.code).join(' | '),
          Detalhe: a.flags.map((f) => f.message).join(' | '),
          'Valor em risco': a.riskAmount,
          Empresa: a.companyName,
          NF: a.invoiceNumber,
          Item: a.itemCode,
          Emissão: a.issueDate,
          Origem: a.origin,
          Vendedor: a.sellerName,
          'Cod. Cliente': a.customerCode,
          Cliente: a.customerName,
          'Cliente vinculado': a.linkedToCustomer ? 'Sim' : 'Não',
          'Cod. Produto': a.productCode,
          Produto: a.productDescription,
          'Produto no estoque': a.linkedToStock ? 'Sim' : 'Não',
          Quantidade: a.quantity,
          'Unitário': a.unitPrice,
          'Valor Bruto': a.grossAmount,
          Desconto: a.discountAmount,
          'Desconto %': a.discountPercent,
          'Receita Líquida': a.netAmount,
          Custo: a.lineCost,
          Impostos: a.taxTotal,
          'Margem ERP': a.marginErp,
          'Margem recalculada': a.marginCalculated,
          'Margem %': a.marginPercentCalculated,
          'Divergência de margem': a.marginDivergence,
        })),
        'Auditoria',
        `vendas_auditoria_${stamp}`
      );
      return;
    }
    // Visão geral e vínculos → série mensal
    exportReportToExcel(
      months.map((m) => ({
        Ano: m.year,
        Mês: m.monthLabel,
        Notas: m.invoices,
        Itens: m.lines,
        Clientes: m.customers,
        Produtos: m.products,
        'Valor Bruto': m.grossAmount,
        Desconto: m.discountAmount,
        'Desconto %': m.discountPercent,
        'Receita Líquida': m.netAmount,
        Custo: m.costAmount,
        Impostos: m.taxAmount,
        Margem: m.marginAmount,
        'Margem %': m.marginPercent,
        'Itens no prejuízo': m.negativeLines,
        Prejuízo: m.negativeAmount,
      })),
      'Vendas por mês',
      `vendas_mensal_${stamp}`
    );
  };

  const t = audit.totals;
  const r = audit.risk;

  return (
    <div className="space-y-5">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-[#C19A6B]" />
            Vendas de Produtos
          </h2>
          <p className="text-xs text-[#8B7D6B]">
            Relatório RPR001 — item a item, com margem, desconto e auditoria de desvios ·
            produto vinculado ao Estoque e cliente vinculado ao Cadastro
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowParams((v) => !v)}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              showParams ? 'bg-[#C19A6B] text-white border-[#C19A6B]' : 'border-[#D8D2C7] hover:bg-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Parâmetros
          </button>
          {canEdit && (
            <button
              onClick={handleSyncSellers}
              disabled={!items.length || isSyncingSellers}
              title="Cadastra na base de Vendedores todos os que emitiram nota, para que a inadimplência encontre o responsável"
              className="px-3 py-2 rounded-lg text-xs font-bold border border-[#D8D2C7] hover:bg-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              <Users2 className="w-3.5 h-3.5" />
              {isSyncingSellers ? 'Sincronizando...' : 'Sincronizar vendedores'}
            </button>
          )}
          <button
            onClick={onReload}
            className="px-3 py-2 rounded-lg text-xs font-bold border border-[#D8D2C7] hover:bg-white transition-colors"
          >
            Atualizar
          </button>
          <button
            onClick={handleExport}
            disabled={!items.length}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Exportar Excel
          </button>
          {canEdit && (
            <label
              className={`px-3 py-2 rounded-lg text-xs font-bold bg-[#C19A6B] text-white hover:bg-[#A9835A] cursor-pointer transition-colors flex items-center gap-1.5 ${
                isImporting ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {isImporting ? 'Importando...' : 'Importar RPR001'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* ── Parâmetros da auditoria ───────────────────────────────────────── */}
      {showParams && (
        <div className="rounded-xl border border-[#E5E0D8] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">
            O que este painel considera abusivo
          </p>
          <p className="text-[11px] text-[#8B7D6B] mb-3">
            Estes limites definem quais linhas entram na auditoria. Ajuste-os à sua política
            comercial — nenhum número aqui é lei contábil, é decisão de gestão.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ParamInput
              label="Margem mínima (%)"
              hint="Abaixo disto, o item é apontado"
              value={thresholds.minMarginPercent}
              onChange={(v) => setThresholds((p) => ({ ...p, minMarginPercent: v }))}
            />
            <ParamInput
              label="Desconto máximo (%)"
              hint="Acima disto, o excedente vira risco"
              value={thresholds.maxDiscountPercent}
              onChange={(v) => setThresholds((p) => ({ ...p, maxDiscountPercent: v }))}
            />
            <ParamInput
              label="Preço abaixo da mediana (%)"
              hint="Desvio tolerado no preço do mesmo SKU"
              value={thresholds.maxPriceBelowMedianPercent}
              onChange={(v) => setThresholds((p) => ({ ...p, maxPriceBelowMedianPercent: v }))}
            />
            <ParamInput
              label="Valor mínimo da linha (R$)"
              hint="Ignora itens de baixo valor para reduzir ruído"
              value={thresholds.minLineValue}
              onChange={(v) => setThresholds((p) => ({ ...p, minLineValue: v }))}
            />
          </div>
        </div>
      )}

      {/* ── Status da importação ──────────────────────────────────────────── */}
      {importStatus && (
        <div className="rounded-lg border border-[#C19A6B]/40 bg-[#C19A6B]/10 px-4 py-2.5 text-xs font-semibold text-[#6B5A45]">
          <div className="flex items-start justify-between gap-3">
            <span>{importStatus}</span>
            <button onClick={() => { setImportStatus(''); setImportDiagnostics([]); }} className="shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {importDiagnostics.length > 0 && (
            <ul className="mt-2 space-y-1 font-normal list-disc list-inside">
              {importDiagnostics.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ── Resultado da sincronização de vendedores ──────────────────────── */}
      {sellerSync && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <p className="font-bold flex items-center gap-1.5">
                <UserCheck className="w-4 h-4" />
                Equipe de vendas sincronizada com o cadastro
              </p>
              <p>
                {fmtInt(sellerSync.created.length)} vendedores cadastrados ·{' '}
                {fmtInt(sellerSync.existing)} já existiam ·{' '}
                {fmtInt(sellerSync.codeFilled.length)} tiveram o código do ERP preenchido.
              </p>
              {sellerSync.created.length > 0 && (
                <p className="text-[11px]">
                  <strong>Novos:</strong>{' '}
                  {sellerSync.created
                    .slice(0, 12)
                    .map((c) => `${c.name} (#${c.code})`)
                    .join(', ')}
                  {sellerSync.created.length > 12 && ` e mais ${sellerSync.created.length - 12}`}
                </p>
              )}
              {sellerSync.duplicates.length > 0 && (
                <p className="text-[11px] text-amber-900 bg-amber-100 border border-amber-200 rounded px-2 py-1.5">
                  <strong>Atenção — duplicidade na origem:</strong>{' '}
                  {sellerSync.duplicates.map((d) => `${d.name} aparece com os códigos ${d.codes.join(' e ')}`).join('; ')}.
                  O sistema não funde códigos automaticamente: a fusão errada reatribuiria comissão e
                  inadimplência para a pessoa errada. Corrija no ERP ou defina qual código é o oficial.
                </p>
              )}
              {sellerSync.inactiveInSales.length > 0 && (
                <p className="text-[11px] text-emerald-800/80">
                  {fmtInt(sellerSync.inactiveInSales.length)} vendedores do cadastro não emitiram nota no
                  período importado ({sellerSync.inactiveInSales.slice(0, 6).map((s) => s.name).join(', ')}
                  {sellerSync.inactiveInSales.length > 6 ? '…' : ''}). Nenhum foi desativado automaticamente.
                </p>
              )}
              <p className="text-[10px] text-emerald-800/70">
                Base de vendedores agora com {fmtInt(registeredSellers.length + sellerSync.created.length)} registros —
                a inadimplência passa a encontrar o responsável pelo código do ERP.
              </p>
            </div>
            <button onClick={() => setSellerSync(null)} className="shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* ── Filtros globais ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#E5E0D8] bg-white p-3 flex flex-wrap items-center gap-2">
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="px-2.5 py-1.5 rounded-lg border border-[#D8D2C7] text-xs font-semibold bg-white"
        >
          <option value="all">Todos os anos</option>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-[#D8D2C7] text-xs font-semibold bg-white max-w-[220px]"
        >
          <option value="all">Todos os vendedores</option>
          {sellerOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-[#D8D2C7] text-xs font-semibold bg-white"
        >
          <option value="all">Todas as origens</option>
          {originOptions.map((o) => (
            <option key={o} value={o}>{o === 'OFI' ? 'OFI — Oficina' : o === 'BLC' ? 'BLC — Balcão' : o}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8B7D6B]" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por cliente, produto, NF ou código..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#D8D2C7] text-xs bg-white"
          />
        </div>
        {availableYears.length > 0 && (
          <select
            onChange={(e) => e.target.value && onLoadYear(Number(e.target.value))}
            defaultValue=""
            className="px-2.5 py-1.5 rounded-lg border border-[#D8D2C7] text-xs font-semibold bg-white"
            title="Carrega o detalhe de um ano que ainda não está em memória"
          >
            <option value="">Carregar ano…</option>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          label="Receita líquida"
          value={formatCurrency(t.netAmount)}
          hint={`${fmtInt(t.invoices)} notas · ${fmtInt(t.lines)} itens · ${fmtInt(t.customers)} clientes`}
          tone="dark"
        />
        <KpiCard
          icon={<BadgePercent className="w-4 h-4" />}
          label="Desconto concedido"
          value={formatCurrency(t.discountAmount)}
          hint={`${fmtPct(t.discountPercent)} sobre o bruto de ${formatCurrency(t.grossAmount)}`}
          tone={t.discountPercent > thresholds.maxDiscountPercent ? 'warn' : 'default'}
        />
        <KpiCard
          icon={<Percent className="w-4 h-4" />}
          label="Margem de contribuição"
          value={formatCurrency(t.marginCalculated)}
          hint={`${fmtPct(t.marginPercent)} da receita · custo ${formatCurrency(t.costAmount)}`}
          tone={t.marginPercent < thresholds.minMarginPercent ? 'warn' : 'default'}
        />
        <KpiCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Valor sob auditoria"
          value={formatCurrency(r.totalRiskAmount)}
          hint={`${fmtInt(audit.flagged.length)} itens apontados (${fmtPct(
            t.lines ? (audit.flagged.length / t.lines) * 100 : 0
          )} das linhas)`}
          tone={r.totalRiskAmount > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* ── Abas ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-[#E5E0D8] flex gap-1 overflow-x-auto">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-3.5 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
              tab === tb.id
                ? 'border-[#C19A6B] text-[#2D2A26]'
                : 'border-transparent text-[#8B7D6B] hover:text-[#2D2A26]'
            }`}
          >
            {tb.label}
            {tb.id === 'auditoria' && audit.flagged.length > 0 && (
              <span className="ml-1.5 px-1.5 py-px rounded bg-red-100 text-red-700 text-[9px] font-extrabold">
                {fmtInt(audit.flagged.length)}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <p className="text-xs text-[#8B7D6B] py-8 text-center">Carregando vendas...</p>
      )}

      {!isLoading && !items.length && (
        <div className="rounded-xl border border-dashed border-[#D8D2C7] bg-white p-10 text-center">
          <ShoppingCart className="w-8 h-8 text-[#C19A6B] mx-auto mb-2" />
          <p className="text-sm font-bold">Nenhuma venda importada ainda</p>
          <p className="text-xs text-[#8B7D6B] mt-1">
            Importe o relatório RPR001 (Venda Produto Intermediário) pelo botão acima ou pela tela de Importação.
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <>
          {tab === 'crm' && (
            <CrmSalesView
              auditedSales={audit.audited}
              stockItems={stockItems}
              customers={customers}
              sellers={registeredSellers}
              delinquentTitles={delinquentTitles}
              selectedYear={selectedYear}
            />
          )}
          {tab === 'geral' && <OverviewTab months={months} audit={audit} thresholds={thresholds} />}
          {tab === 'vendedores' && <SellersTab rows={sellers} thresholds={thresholds} />}
          {tab === 'clientes' && (
            <CustomersTab rows={customerRows} search={search} overdue={overdueByCustomer} thresholds={thresholds} />
          )}
          {tab === 'produtos' && <ProductsTab rows={products} search={search} thresholds={thresholds} />}
          {tab === 'auditoria' && (
            <AuditTab
              rows={audit.flagged}
              search={search}
              severityFilter={severityFilter}
              setSeverityFilter={setSeverityFilter}
              flagFilter={flagFilter}
              setFlagFilter={setFlagFilter}
              risk={r}
              onSelect={setDetail}
            />
          )}
          {tab === 'vinculos' && <LinksTab coverage={audit.coverage} totalNet={t.netAmount} />}
        </>
      )}

      {/* ── Detalhe da linha ──────────────────────────────────────────────── */}
      {detail && <SaleDetailModal sale={detail} onClose={() => setDetail(null)} />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  ABA: VISÃO GERAL
// ═══════════════════════════════════════════════════════════════════════════

const OverviewTab: React.FC<{
  months: ReturnType<typeof buildSalesMonthSummaries>;
  audit: ReturnType<typeof auditSales>;
  thresholds: SalesAuditThresholds;
}> = ({ months, audit, thresholds }) => {
  const byYear = useMemo(() => {
    const map = new Map<number, { year: number; lines: number; gross: number; disc: number; net: number; cost: number; margin: number; neg: number }>();
    months.forEach((m) => {
      const y = map.get(m.year) || { year: m.year, lines: 0, gross: 0, disc: 0, net: 0, cost: 0, margin: 0, neg: 0 };
      y.lines += m.lines; y.gross += m.grossAmount; y.disc += m.discountAmount;
      y.net += m.netAmount; y.cost += m.costAmount; y.margin += m.marginAmount; y.neg += m.negativeAmount;
      map.set(m.year, y);
    });
    return [...map.values()].sort((a, b) => a.year - b.year);
  }, [months]);

  const maxNet = Math.max(...byYear.map((y) => y.net), 1);
  const r = audit.risk;

  return (
    <div className="space-y-4">
      {/* Composição do risco — onde exatamente está o vazamento */}
      <div className="rounded-xl border border-[#E5E0D8] bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B7D6B] mb-3">
          Composição do valor sob auditoria
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <RiskCard
            label="Prejuízo direto"
            value={r.negativeMarginAmount}
            hint={`${fmtInt(r.negativeMarginLines)} itens vendidos abaixo do custo + impostos`}
            tone="critico"
          />
          <RiskCard
            label="Desconto excedente"
            value={r.excessDiscountAmount}
            hint={`${fmtInt(r.excessDiscountLines)} itens acima do teto de ${thresholds.maxDiscountPercent}%`}
            tone="alto"
          />
          <RiskCard
            label="Margem faltante"
            value={r.marginGapAmount}
            hint={`Quanto faltou para o piso de ${thresholds.minMarginPercent}% em ${fmtInt(r.marginGapLines)} itens`}
            tone="alto"
          />
          <RiskCard
            label="Preço fora da curva"
            value={r.priceGapAmount}
            hint={`${fmtInt(r.priceGapLines)} itens muito abaixo da mediana do próprio SKU`}
            tone="medio"
          />
          <RiskCard
            label="Partes relacionadas"
            value={r.relatedPartyRevenue}
            hint={`Receita em ${fmtInt(r.relatedPartyInvoices)} notas cujo cliente tem nome de vendedor`}
            tone="medio"
          />
        </div>
        <p className="text-[10px] text-[#8B7D6B] mt-3 leading-relaxed">
          O <strong>valor sob auditoria</strong> do painel não é a soma destas cinco colunas: uma mesma linha
          pode aparecer em mais de uma categoria (desconto abusivo que gerou margem negativa, por exemplo) e
          seria contada duas vezes. O total usa o maior impacto de cada linha.
          {Math.abs(audit.totals.marginDivergence) > 1 && (
            <>
              {' '}Há ainda <strong>{formatCurrency(Math.abs(audit.totals.marginDivergence))}</strong> de divergência
              entre a margem informada pelo ERP e o recálculo em {fmtInt(r.marginDivergenceLines)} linhas — isso é
              problema de dado, não de venda, e está separado do risco.
            </>
          )}
        </p>
      </div>

      {/* Série anual */}
      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E0D8]">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B7D6B]">Evolução anual</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF8F5] text-[#8B7D6B]">
              <tr>
                <Th>Ano</Th>
                <Th align="right">Itens</Th>
                <Th align="right">Bruto</Th>
                <Th align="right">Desconto</Th>
                <Th align="right">Desc. %</Th>
                <Th align="right">Receita líquida</Th>
                <Th align="right">Custo</Th>
                <Th align="right">Margem</Th>
                <Th align="right">Margem %</Th>
                <Th>Participação</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE7]">
              {byYear.map((y) => {
                const dp = y.gross > 0 ? (y.disc / y.gross) * 100 : 0;
                const mp = y.net > 0 ? (y.margin / y.net) * 100 : 0;
                return (
                  <tr key={y.year} className="hover:bg-[#FAF8F5]">
                    <Td className="font-bold">{y.year}</Td>
                    <Td align="right">{fmtInt(y.lines)}</Td>
                    <Td align="right">{formatCurrency(y.gross)}</Td>
                    <Td align="right">{formatCurrency(y.disc)}</Td>
                    <Td align="right" className={dp > thresholds.maxDiscountPercent ? 'text-red-600 font-bold' : ''}>
                      {fmtPct(dp)}
                    </Td>
                    <Td align="right" className="font-bold">{formatCurrency(y.net)}</Td>
                    <Td align="right">{formatCurrency(y.cost)}</Td>
                    <Td align="right">{formatCurrency(y.margin)}</Td>
                    <Td align="right" className={mp < thresholds.minMarginPercent ? 'text-red-600 font-bold' : 'font-bold'}>
                      {fmtPct(mp)}
                    </Td>
                    <Td>
                      <div className="h-1.5 rounded-full bg-[#F0EDE7] w-24">
                        <div className="h-1.5 rounded-full bg-[#C19A6B]" style={{ width: `${(y.net / maxNet) * 100}%` }} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Série mensal */}
      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E0D8]">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B7D6B]">Detalhe mensal</p>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF8F5] text-[#8B7D6B] sticky top-0">
              <tr>
                <Th>Mês</Th>
                <Th align="right">Notas</Th>
                <Th align="right">Itens</Th>
                <Th align="right">Clientes</Th>
                <Th align="right">Desconto</Th>
                <Th align="right">Desc. %</Th>
                <Th align="right">Receita líquida</Th>
                <Th align="right">Margem</Th>
                <Th align="right">Margem %</Th>
                <Th align="right">Itens no prejuízo</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE7]">
              {[...months].reverse().map((m) => (
                <tr key={m.id} className="hover:bg-[#FAF8F5]">
                  <Td className="font-semibold whitespace-nowrap">{m.monthLabel}</Td>
                  <Td align="right">{fmtInt(m.invoices)}</Td>
                  <Td align="right">{fmtInt(m.lines)}</Td>
                  <Td align="right">{fmtInt(m.customers)}</Td>
                  <Td align="right">{formatCurrency(m.discountAmount)}</Td>
                  <Td align="right" className={m.discountPercent > thresholds.maxDiscountPercent ? 'text-red-600 font-bold' : ''}>
                    {fmtPct(m.discountPercent)}
                  </Td>
                  <Td align="right" className="font-bold">{formatCurrency(m.netAmount)}</Td>
                  <Td align="right">{formatCurrency(m.marginAmount)}</Td>
                  <Td align="right" className={m.marginPercent < thresholds.minMarginPercent ? 'text-red-600 font-bold' : ''}>
                    {fmtPct(m.marginPercent)}
                  </Td>
                  <Td align="right" className={m.negativeLines ? 'text-red-600 font-semibold' : ''}>
                    {m.negativeLines ? `${fmtInt(m.negativeLines)} (${formatCurrency(m.negativeAmount)})` : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  ABA: VENDEDORES
// ═══════════════════════════════════════════════════════════════════════════

const SellersTab: React.FC<{
  rows: ReturnType<typeof buildSellerSummaries>;
  thresholds: SalesAuditThresholds;
}> = ({ rows, thresholds }) => (
  <div className="space-y-4">
    <div className="rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] px-4 py-3 text-[11px] text-[#6B5A45] leading-relaxed">
      A coluna <strong>Desvio</strong> compara a margem % de cada vendedor com a <strong>mediana da equipe</strong>,
      considerando apenas quem tem faturamento material. É esse número que separa desempenho de política de preço:
      margem baixa quando a equipe inteira está baixa é problema de precificação da empresa; margem baixa isolada,
      com desconto alto e carteira concentrada, é problema de controle.
    </div>

    <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#FAF8F5] text-[#8B7D6B]">
            <tr>
              <Th>Vendedor</Th>
              <Th align="right">Notas</Th>
              <Th align="right">Clientes</Th>
              <Th align="right">Ticket médio</Th>
              <Th align="right">Bruto</Th>
              <Th align="right">Desconto</Th>
              <Th align="right">Desc. %</Th>
              <Th align="right">Receita líquida</Th>
              <Th align="right">Margem</Th>
              <Th align="right">Margem %</Th>
              <Th align="right">Desvio</Th>
              <Th align="right">Prejuízo</Th>
              <Th align="right">Sob auditoria</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EDE7]">
            {rows.map((s) => {
              const concentration = s.customers > 0 ? s.invoices / s.customers : 0;
              return (
                <tr key={s.sellerCode + s.sellerName} className="hover:bg-[#FAF8F5]">
                  <Td className="font-bold whitespace-nowrap">
                    {s.sellerName}
                    <span className="ml-1.5 text-[9px] font-normal text-[#8B7D6B]">#{s.sellerCode}</span>
                    {concentration > 5 && s.netAmount > 100000 && (
                      <span
                        className="ml-1.5 px-1 py-px rounded bg-amber-100 text-amber-800 text-[9px] font-bold"
                        title={`${fmtQty(concentration)} notas por cliente — carteira muito concentrada`}
                      >
                        carteira concentrada
                      </span>
                    )}
                  </Td>
                  <Td align="right">{fmtInt(s.invoices)}</Td>
                  <Td align="right">{fmtInt(s.customers)}</Td>
                  <Td align="right">{formatCurrency(s.averageTicket)}</Td>
                  <Td align="right">{formatCurrency(s.grossAmount)}</Td>
                  <Td align="right">{formatCurrency(s.discountAmount)}</Td>
                  <Td align="right" className={s.discountPercent > thresholds.maxDiscountPercent ? 'text-red-600 font-bold' : ''}>
                    {fmtPct(s.discountPercent)}
                  </Td>
                  <Td align="right" className="font-bold">{formatCurrency(s.netAmount)}</Td>
                  <Td align="right">{formatCurrency(s.marginAmount)}</Td>
                  <Td align="right" className={s.marginPercent < thresholds.minMarginPercent ? 'text-red-600 font-bold' : 'font-semibold'}>
                    {fmtPct(s.marginPercent)}
                  </Td>
                  <Td align="right">
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        s.marginDeviation < -3 ? 'bg-red-100 text-red-700'
                        : s.marginDeviation > 3 ? 'bg-emerald-100 text-emerald-700'
                        : 'text-[#8B7D6B]'
                      }`}
                    >
                      {s.marginDeviation > 0 ? '+' : ''}{s.marginDeviation.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.
                    </span>
                  </Td>
                  <Td align="right" className={s.negativeLines ? 'text-red-600 font-semibold' : 'text-[#8B7D6B]'}>
                    {s.negativeLines ? `${fmtInt(s.negativeLines)} · ${formatCurrency(s.negativeAmount)}` : '—'}
                  </Td>
                  <Td align="right" className="font-semibold">{formatCurrency(s.riskAmount)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
//  ABA: CLIENTES
// ═══════════════════════════════════════════════════════════════════════════

const CustomersTab: React.FC<{
  rows: ReturnType<typeof buildCustomerSummaries>;
  search: string;
  overdue: Map<string, number>;
  thresholds: SalesAuditThresholds;
}> = ({ rows, search, overdue, thresholds }) => {
  const [onlyRisk, setOnlyRisk] = useState(false);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (onlyRisk && c.discountPercent <= thresholds.maxDiscountPercent && c.negativeLines === 0) return false;
      if (!term) return true;
      return c.customerName.toLowerCase().includes(term) || c.customerCode.toLowerCase().includes(term);
    });
  }, [rows, search, onlyRisk, thresholds]);

  const { sorted, toggle, sortKey, sortDir } = useSort(filtered, 'netAmount', 'desc');
  const pager = usePagination(sorted, 40);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
          <input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} />
          Só clientes com desconto acima do teto ou item no prejuízo
        </label>
        <p className="text-[11px] text-[#8B7D6B]">
          {fmtInt(filtered.length)} clientes · receita {formatCurrency(filtered.reduce((a, c) => a + c.netAmount, 0))} ·
          desconto {formatCurrency(filtered.reduce((a, c) => a + c.discountAmount, 0))}
        </p>
      </div>

      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF8F5] text-[#8B7D6B]">
              <tr>
                <Th>Cliente</Th>
                <Th>Vínculo</Th>
                <Th align="right">Notas</Th>
                <SortTh field="grossAmount" label="Bruto" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="discountAmount" label="Desconto" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="discountPercent" label="Desc. %" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="netAmount" label="Receita líq." sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="marginPercent" label="Margem %" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <Th align="right">Prejuízo</Th>
                <Th align="right">Em atraso</Th>
                <Th>Vendedor principal</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE7]">
              {pager.items.map((c) => {
                const od = overdue.get(normalizePersonCode(c.customerCode)) || 0;
                return (
                  <tr key={c.customerCode} className="hover:bg-[#FAF8F5]">
                    <Td>
                      <span className="font-semibold">{c.customerName}</span>
                      <span className="ml-1.5 text-[9px] text-[#8B7D6B]">#{c.customerCode}</span>
                      {c.city && <span className="ml-1.5 text-[9px] text-[#8B7D6B]">{c.city}/{c.state}</span>}
                      {c.sellers.length > 3 && (
                        <span
                          className="ml-1.5 px-1 py-px rounded bg-slate-100 text-slate-700 text-[9px] font-bold"
                          title={c.sellers.join(', ')}
                        >
                          {c.sellers.length} vendedores
                        </span>
                      )}
                    </Td>
                    <Td>
                      {c.linked ? (
                        <span className="text-emerald-700 font-semibold">Cadastrado</span>
                      ) : (
                        <span className="text-amber-700 font-semibold" title="NF_PessoaCod sem correspondência em cod_cliente">
                          Sem cadastro
                        </span>
                      )}
                    </Td>
                    <Td align="right">{fmtInt(c.invoices)}</Td>
                    <Td align="right">{formatCurrency(c.grossAmount)}</Td>
                    <Td align="right">{formatCurrency(c.discountAmount)}</Td>
                    <Td align="right" className={c.discountPercent > thresholds.maxDiscountPercent ? 'text-red-600 font-bold' : ''}>
                      {fmtPct(c.discountPercent)}
                    </Td>
                    <Td align="right" className="font-bold">{formatCurrency(c.netAmount)}</Td>
                    <Td align="right" className={c.marginPercent < thresholds.minMarginPercent ? 'text-red-600 font-bold' : ''}>
                      {fmtPct(c.marginPercent)}
                    </Td>
                    <Td align="right" className={c.negativeLines ? 'text-red-600 font-semibold' : 'text-[#8B7D6B]'}>
                      {c.negativeLines ? formatCurrency(c.negativeAmount) : '—'}
                    </Td>
                    <Td align="right" className={od > 0 ? 'text-red-600 font-bold' : 'text-[#8B7D6B]'}>
                      {od > 0 ? formatCurrency(od) : '—'}
                    </Td>
                    <Td className="whitespace-nowrap text-[#8B7D6B]">{c.mainSeller}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager pager={pager} />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  ABA: PRODUTOS
// ═══════════════════════════════════════════════════════════════════════════

const ProductsTab: React.FC<{
  rows: ReturnType<typeof buildProductSummaries>;
  search: string;
  thresholds: SalesAuditThresholds;
}> = ({ rows, search, thresholds }) => {
  const [view, setView] = useState<'todos' | 'prejuizo' | 'dispersao' | 'sem_estoque'>('todos');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((p) => {
      if (view === 'prejuizo' && p.marginAmount >= 0) return false;
      if (view === 'dispersao' && !(p.priceSpread > 3 && p.lines >= 5)) return false;
      if (view === 'sem_estoque' && p.linked) return false;
      if (!term) return true;
      return (
        p.productDescription.toLowerCase().includes(term) ||
        p.productCode.toLowerCase().includes(term) ||
        p.brandReference.toLowerCase().includes(term)
      );
    });
  }, [rows, search, view]);

  const { sorted, toggle, sortKey, sortDir } = useSort(filtered, 'netAmount', 'desc');
  const pager = usePagination(sorted, 40);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {([
            ['todos', 'Todos'],
            ['prejuizo', 'Com prejuízo'],
            ['dispersao', 'Preço disperso (>3x)'],
            ['sem_estoque', 'Sem vínculo no estoque'],
          ] as [typeof view, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                view === v ? 'bg-[#2D2A26] text-white border-[#2D2A26]' : 'border-[#D8D2C7] hover:bg-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#8B7D6B]">
          {fmtInt(filtered.length)} produtos · receita {formatCurrency(filtered.reduce((a, p) => a + p.netAmount, 0))}
        </p>
      </div>

      <div className="rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] px-4 py-2.5 text-[11px] text-[#6B5A45] leading-relaxed">
        <strong>Dispersão</strong> é o maior preço unitário dividido pelo menor, para o mesmo código de produto.
        Até ~1,5x é negociação normal. Acima de 3x, com volume, costuma ser preço de favor, cadastro duplicado
        ou erro de digitação — e nos três casos alguém precisa olhar. As colunas de <strong>custo e preço atuais</strong>
        vêm do vínculo com o Estoque (Produto_Codigo) e mostram se a precificação de hoje ainda faz sentido.
      </div>

      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF8F5] text-[#8B7D6B]">
              <tr>
                <Th>Produto</Th>
                <Th>Estoque</Th>
                <SortTh field="quantity" label="Qtd. vendida" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="netAmount" label="Receita líq." sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="discountPercent" label="Desc. %" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="marginAmount" label="Margem" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <SortTh field="marginPercent" label="Margem %" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <Th align="right">Preço mín/mediano/máx</Th>
                <SortTh field="priceSpread" label="Dispersão" sortKey={sortKey} sortDir={sortDir} toggle={toggle} />
                <Th align="right">Custo atual</Th>
                <Th align="right">Saldo</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE7]">
              {pager.items.map((p) => (
                <tr key={p.productCode} className="hover:bg-[#FAF8F5]">
                  <Td>
                    <span className="font-semibold">{p.productDescription || '—'}</span>
                    <span className="ml-1.5 text-[9px] text-[#8B7D6B]">#{p.productCode}</span>
                    {p.brandReference && <span className="ml-1.5 text-[9px] text-[#8B7D6B]">{p.brandReference}</span>}
                  </Td>
                  <Td>
                    {p.linked ? (
                      <span className="text-emerald-700 font-semibold">Vinculado</span>
                    ) : (
                      <span className="text-amber-700 font-semibold" title="NFItem_ProdutoCod sem correspondência em Produto_Codigo">
                        Não encontrado
                      </span>
                    )}
                  </Td>
                  <Td align="right">{fmtQty(p.quantity)}</Td>
                  <Td align="right" className="font-bold">{formatCurrency(p.netAmount)}</Td>
                  <Td align="right" className={p.discountPercent > thresholds.maxDiscountPercent ? 'text-red-600 font-bold' : ''}>
                    {fmtPct(p.discountPercent)}
                  </Td>
                  <Td align="right" className={p.marginAmount < 0 ? 'text-red-600 font-bold' : ''}>
                    {formatCurrency(p.marginAmount)}
                  </Td>
                  <Td align="right" className={p.marginPercent < thresholds.minMarginPercent ? 'text-red-600 font-bold' : ''}>
                    {fmtPct(p.marginPercent)}
                  </Td>
                  <Td align="right" className="whitespace-nowrap text-[10px]">
                    {formatCurrency(p.minUnitPrice)} / <strong>{formatCurrency(p.medianUnitPrice)}</strong> / {formatCurrency(p.maxUnitPrice)}
                  </Td>
                  <Td align="right">
                    <span className={`font-bold ${p.priceSpread > 3 ? 'text-red-600' : p.priceSpread > 1.8 ? 'text-amber-700' : 'text-[#8B7D6B]'}`}>
                      {p.priceSpread ? `${p.priceSpread.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x` : '—'}
                    </span>
                  </Td>
                  <Td align="right">{p.linked ? formatCurrency(p.currentCost) : '—'}</Td>
                  <Td align="right">{p.linked ? fmtQty(p.availableQty) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager pager={pager} />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  ABA: AUDITORIA
// ═══════════════════════════════════════════════════════════════════════════

const AuditTab: React.FC<{
  rows: AuditedSale[];
  search: string;
  severityFilter: 'all' | 'critico' | 'alto' | 'medio';
  setSeverityFilter: (v: 'all' | 'critico' | 'alto' | 'medio') => void;
  flagFilter: string;
  setFlagFilter: (v: string) => void;
  risk: ReturnType<typeof auditSales>['risk'];
  onSelect: (s: AuditedSale) => void;
}> = ({ rows, search, severityFilter, setSeverityFilter, flagFilter, setFlagFilter, onSelect }) => {
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((a) => {
      if (severityFilter !== 'all' && a.worstSeverity !== severityFilter) return false;
      if (flagFilter !== 'all' && !a.flags.some((f) => f.code === flagFilter)) return false;
      if (!term) return true;
      return (
        a.customerName.toLowerCase().includes(term) ||
        a.productDescription.toLowerCase().includes(term) ||
        a.invoiceNumber.toLowerCase().includes(term) ||
        a.customerCode.toLowerCase().includes(term) ||
        a.productCode.toLowerCase().includes(term) ||
        a.sellerName.toLowerCase().includes(term)
      );
    });
  }, [rows, search, severityFilter, flagFilter]);

  const pager = usePagination(filtered, 40);

  const flagCounts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((a) => a.flags.forEach((f) => m.set(f.code, (m.get(f.code) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'critico', 'alto', 'medio'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
              severityFilter === s ? 'bg-[#2D2A26] text-white border-[#2D2A26]' : 'border-[#D8D2C7] hover:bg-white'
            }`}
          >
            {s === 'all' ? 'Todas' : s === 'critico' ? 'Críticas' : s === 'alto' ? 'Altas' : 'Médias'}
          </button>
        ))}
        <select
          value={flagFilter}
          onChange={(e) => setFlagFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-[#D8D2C7] text-[11px] font-semibold bg-white"
        >
          <option value="all">Todos os apontamentos</option>
          {flagCounts.map(([code, n]) => (
            <option key={code} value={code}>{FLAG_LABELS[code] || code} ({n})</option>
          ))}
        </select>
        <span className="text-[11px] text-[#8B7D6B] ml-auto">
          {fmtInt(filtered.length)} itens · valor em risco {formatCurrency(filtered.reduce((a, x) => a + x.riskAmount, 0))}
        </span>
      </div>

      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#FAF8F5] text-[#8B7D6B]">
              <tr>
                <Th>Sev.</Th>
                <Th>Data / NF</Th>
                <Th>Vendedor</Th>
                <Th>Cliente</Th>
                <Th>Produto</Th>
                <Th align="right">Qtd</Th>
                <Th align="right">Receita</Th>
                <Th align="right">Desc. %</Th>
                <Th align="right">Margem</Th>
                <Th>Apontamentos</Th>
                <Th align="right">Em risco</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE7]">
              {pager.items.map((a) => (
                <tr
                  key={a.dedupeKey}
                  className="hover:bg-[#FAF8F5] cursor-pointer"
                  onClick={() => onSelect(a)}
                >
                  <Td><SeverityBadge severity={a.worstSeverity} /></Td>
                  <Td className="whitespace-nowrap">
                    <span className="font-semibold">{a.issueDate.split('-').reverse().join('/')}</span>
                    <span className="block text-[9px] text-[#8B7D6B]">NF {a.invoiceNumber} · item {a.itemCode} · {a.origin}</span>
                  </Td>
                  <Td className="whitespace-nowrap">{a.sellerName}</Td>
                  <Td>
                    <span className="font-semibold">{a.customerName}</span>
                    <span className="block text-[9px] text-[#8B7D6B]">
                      #{a.customerCode} {a.linkedToCustomer ? '' : '· sem cadastro'}
                    </span>
                  </Td>
                  <Td>
                    <span>{a.productDescription}</span>
                    <span className="block text-[9px] text-[#8B7D6B]">
                      #{a.productCode} {a.linkedToStock ? '' : '· fora do estoque'}
                    </span>
                  </Td>
                  <Td align="right">{fmtQty(a.quantity)}</Td>
                  <Td align="right" className="font-semibold">{formatCurrency(a.netAmount)}</Td>
                  <Td align="right" className={a.discountPercent > 0 ? 'font-semibold' : 'text-[#8B7D6B]'}>
                    {a.discountPercent > 0 ? fmtPct(a.discountPercent) : '—'}
                  </Td>
                  <Td align="right" className={a.marginCalculated < 0 ? 'text-red-600 font-bold' : ''}>
                    {formatCurrency(a.marginCalculated)}
                    <span className="block text-[9px] font-normal">{fmtPct(a.marginPercentCalculated)}</span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {a.flags.map((f) => (
                        <span
                          key={f.code}
                          title={f.message}
                          className={`px-1.5 py-px rounded text-[9px] font-bold ${
                            f.severity === 'critico' ? 'bg-red-100 text-red-700'
                            : f.severity === 'alto' ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {FLAG_LABELS[f.code] || f.code}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td align="right" className="font-bold">{a.riskAmount > 0 ? formatCurrency(a.riskAmount) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager pager={pager} />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  ABA: VÍNCULOS
// ═══════════════════════════════════════════════════════════════════════════

const LinksTab: React.FC<{
  coverage: ReturnType<typeof auditSales>['coverage'];
  totalNet: number;
}> = ({ coverage, totalNet }) => (
  <div className="space-y-4">
    <div className="rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] px-4 py-3 text-[11px] text-[#6B5A45] leading-relaxed">
      Esta aba mede o <strong>ponto cego</strong> da análise. Todo produto que não casa com o Estoque perde a
      comparação com o custo de reposição atual; todo cliente que não casa com o Cadastro perde cidade, limite de
      crédito e situação de inadimplência. Cobertura baixa não invalida os números de margem — o custo vem da
      própria nota — mas limita o cruzamento. Os itens abaixo estão ordenados por receita: resolver os dez
      primeiros costuma recuperar a maior parte da cobertura.
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E0D8] flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B7D6B] flex items-center gap-1.5">
              <Boxes className="w-3.5 h-3.5" /> Produto → Estoque
            </p>
            <p className="text-[10px] text-[#8B7D6B]">NFItem_ProdutoCod ⇄ Produto_Codigo</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold tabular-nums">{fmtPct(coverage.products.coveragePercent)}</p>
            <p className="text-[10px] text-[#8B7D6B]">
              {fmtInt(coverage.products.linked)} de {fmtInt(coverage.products.total)}
            </p>
          </div>
        </div>
        <div className="px-4 py-2 bg-[#FAF8F5] text-[10px] text-[#8B7D6B] border-b border-[#E5E0D8]">
          Receita sem vínculo: <strong>{formatCurrency(coverage.unlinkedProductRevenue)}</strong>
          {totalNet > 0 && ` (${fmtPct((coverage.unlinkedProductRevenue / totalNet) * 100)} do total)`}
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-[#F0EDE7]">
              {coverage.products.unlinked.slice(0, 40).map((p) => (
                <tr key={p.code} className="hover:bg-[#FAF8F5]">
                  <Td className="text-[10px]">#{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td align="right" className="font-semibold">{formatCurrency(p.value)}</Td>
                </tr>
              ))}
              {!coverage.products.unlinked.length && (
                <tr><Td className="text-center text-[#8B7D6B] py-6">Todos os produtos vendidos existem no estoque.</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E0D8] bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E0D8] flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B7D6B] flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Cliente → Cadastro
            </p>
            <p className="text-[10px] text-[#8B7D6B]">NF_PessoaCod ⇄ cod_cliente</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold tabular-nums">{fmtPct(coverage.customers.coveragePercent)}</p>
            <p className="text-[10px] text-[#8B7D6B]">
              {fmtInt(coverage.customers.linked)} de {fmtInt(coverage.customers.total)}
            </p>
          </div>
        </div>
        <div className="px-4 py-2 bg-[#FAF8F5] text-[10px] text-[#8B7D6B] border-b border-[#E5E0D8]">
          Receita sem vínculo: <strong>{formatCurrency(coverage.unlinkedCustomerRevenue)}</strong>
          {totalNet > 0 && ` (${fmtPct((coverage.unlinkedCustomerRevenue / totalNet) * 100)} do total)`}
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-[#F0EDE7]">
              {coverage.customers.unlinked.slice(0, 40).map((c) => (
                <tr key={c.code} className="hover:bg-[#FAF8F5]">
                  <Td className="text-[10px]">#{c.code}</Td>
                  <Td>{c.name}</Td>
                  <Td align="right" className="font-semibold">{formatCurrency(c.value)}</Td>
                </tr>
              ))}
              {!coverage.customers.unlinked.length && (
                <tr><Td className="text-center text-[#8B7D6B] py-6">Todos os clientes das notas existem no cadastro.</Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
//  MODAL DE DETALHE
// ═══════════════════════════════════════════════════════════════════════════

const SaleDetailModal: React.FC<{ sale: AuditedSale; onClose: () => void }> = ({ sale, onClose }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 py-4 border-b border-[#E5E0D8] flex items-start justify-between sticky top-0 bg-white">
        <div>
          <p className="font-extrabold">{sale.productDescription}</p>
          <p className="text-xs text-[#8B7D6B]">
            NF {sale.invoiceNumber} · item {sale.itemCode} · {sale.issueDate.split('-').reverse().join('/')} ·
            {' '}{sale.companyName}
          </p>
        </div>
        <button onClick={onClose}><X className="w-5 h-5" /></button>
      </div>

      {sale.flags.length > 0 && (
        <div className="p-5 pb-0 space-y-2">
          {sale.flags.map((f) => (
            <div
              key={f.code}
              className={`rounded-lg border px-3 py-2.5 text-[11px] flex gap-2 ${
                f.severity === 'critico' ? 'bg-red-50 border-red-200 text-red-900'
                : f.severity === 'alto' ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>
                <strong>{FLAG_LABELS[f.code] || f.code}.</strong> {f.message}
                {f.impact > 0 && <> Impacto estimado: <strong>{formatCurrency(f.impact)}</strong>.</>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-xs">
        {([
          ['Empresa', sale.companyName],
          ['Origem', sale.origin === 'OFI' ? 'OFI — Oficina' : sale.origin === 'BLC' ? 'BLC — Balcão' : sale.origin],
          ['Natureza da operação', `${sale.operationDescription} (${sale.operationCode})`],
          ['Status da nota', sale.status],
          ['Série', sale.invoiceSeries],
          ['Condição de pagamento', sale.paymentTermDescription],
          ['Vendedor', `${sale.sellerName} (#${sale.sellerCode})`],
          ['Cliente', `${sale.customerName} (#${sale.customerCode})`],
          ['Cliente vinculado ao cadastro', sale.linkedToCustomer ? 'Sim' : 'Não — cod_cliente não encontrado'],
          ['Produto', `${sale.productDescription} (#${sale.productCode})`],
          ['Produto vinculado ao estoque', sale.linkedToStock ? 'Sim' : 'Não — Produto_Codigo não encontrado'],
          ['Referência da marca', sale.brandReference || '—'],
          ['Ordem de serviço', sale.osNumber ? `${sale.osNumber} (${sale.osTypeDescription})` : '—'],
          ['Quantidade', fmtQty(sale.quantity)],
          ['Preço unitário', formatCurrency(sale.unitPrice)],
          ['Bruto informado (unit.)', formatCurrency(sale.reportedUnitGross)],
          ['Valor bruto da linha', formatCurrency(sale.grossAmount)],
          ['Desconto', `${formatCurrency(sale.discountAmount)} (${fmtPct(sale.discountPercent)})`],
          ['Acréscimo', formatCurrency(sale.surchargeAmount)],
          ['Receita líquida', formatCurrency(sale.netAmount)],
          ['Custo da linha', formatCurrency(sale.lineCost)],
          ['Custo unitário', formatCurrency(sale.unitCost)],
          ['ICMS', formatCurrency(sale.taxIcms)],
          ['PIS/COFINS', formatCurrency(sale.taxPisCofins)],
          ['Total de impostos', formatCurrency(sale.taxTotal)],
          ['Margem informada pelo ERP', formatCurrency(sale.marginErp)],
          ['Margem recalculada', `${formatCurrency(sale.marginCalculated)} (${fmtPct(sale.marginPercentCalculated)})`],
          ['Divergência de margem', formatCurrency(sale.marginDivergence)],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] uppercase tracking-wider text-[#8B7D6B] font-bold">{label}</p>
            <p className="font-semibold break-words">{value || '—'}</p>
          </div>
        ))}
      </div>

      <div className="mx-5 mb-5 rounded-lg bg-[#FAF8F5] border border-[#E5E0D8] px-3 py-2.5 text-[10px] text-[#6B5A45] leading-relaxed">
        <strong>Como a margem recalculada é obtida:</strong> Receita líquida − Custo da linha − Impostos.
        O ERP informa a própria margem no campo NFItem_VlMargemCont; quando as duas divergem, a diferença
        aparece acima e a linha entra na auditoria como problema de dado — não necessariamente de venda.
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════════════════════════

const Th: React.FC<{ children: React.ReactNode; align?: 'left' | 'right' }> = ({ children, align = 'left' }) => (
  <th className={`px-3 py-2 font-bold uppercase tracking-wider text-[10px] ${align === 'right' ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);

function SortTh<T>({ field, label, sortKey, sortDir, toggle }: {
  field: keyof T; label: string; sortKey: keyof T | null; sortDir: 'asc' | 'desc'; toggle: (k: keyof T) => void;
}) {
  return (
    <th
      className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px] cursor-pointer select-none hover:text-[#C19A6B] transition-colors"
      onClick={() => toggle(field)}
    >
      {label}
      {sortKey === field && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

const Td: React.FC<{ children?: React.ReactNode; align?: 'left' | 'right'; className?: string; colSpan?: number }> = ({
  children, align = 'left', className = '', colSpan,
}) => (
  <td colSpan={colSpan} className={`px-3 py-2 ${align === 'right' ? 'text-right tabular-nums' : ''} ${className}`}>
    {children}
  </td>
);

const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const map: Record<string, string> = {
    critico: 'bg-red-600 text-white',
    alto: 'bg-amber-500 text-white',
    medio: 'bg-slate-400 text-white',
  };
  const label: Record<string, string> = { critico: 'CRÍT', alto: 'ALTA', medio: 'MÉD' };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${map[severity] || 'bg-slate-200'}`}>
      {label[severity] || severity}
    </span>
  );
};

const Pager: React.FC<{ pager: ReturnType<typeof usePagination<any>> }> = ({ pager }) => (
  <div className="px-4 py-2.5 border-t border-[#E5E0D8] flex items-center justify-between text-[11px] bg-[#FAF8F5]">
    <span className="text-[#8B7D6B]">
      {fmtInt(pager.from)}–{fmtInt(pager.to)} de {fmtInt(pager.total)}
    </span>
    <div className="flex items-center gap-1.5">
      <button
        onClick={pager.prev}
        disabled={!pager.canPrev}
        className="px-2 py-1 rounded border border-[#D8D2C7] font-bold disabled:opacity-30 hover:bg-white"
      >
        Anterior
      </button>
      <span className="text-[#8B7D6B]">{pager.page} / {pager.pageCount}</span>
      <button
        onClick={pager.next}
        disabled={!pager.canNext}
        className="px-2 py-1 rounded border border-[#D8D2C7] font-bold disabled:opacity-30 hover:bg-white"
      >
        Próxima
      </button>
    </div>
  </div>
);

const ParamInput: React.FC<{ label: string; hint: string; value: number; onChange: (v: number) => void }> = ({
  label, hint, value, onChange,
}) => (
  <div>
    <label className="text-[10px] uppercase tracking-wider text-[#8B7D6B] font-bold">{label}</label>
    <input
      type="number"
      value={value}
      min={0}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="w-full mt-1 px-2.5 py-1.5 rounded-lg border border-[#D8D2C7] text-xs font-semibold"
    />
    <p className="text-[9px] text-[#8B7D6B] mt-0.5">{hint}</p>
  </div>
);

const RiskCard: React.FC<{ label: string; value: number; hint: string; tone: 'critico' | 'alto' | 'medio' }> = ({
  label, value, hint, tone,
}) => {
  const styles =
    tone === 'critico' ? 'border-red-200 bg-red-50'
    : tone === 'alto' ? 'border-amber-200 bg-amber-50'
    : 'border-[#E5E0D8] bg-[#FAF8F5]';
  return (
    <div className={`rounded-lg border p-3 ${styles}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B5A45]">{label}</p>
      <p className="text-base font-extrabold mt-1 tabular-nums">{formatCurrency(value)}</p>
      <p className="text-[9px] text-[#8B7D6B] mt-0.5 leading-snug">{hint}</p>
    </div>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'dark' | 'warn';
}> = ({ icon, label, value, hint, tone = 'default' }) => {
  const styles =
    tone === 'dark' ? 'bg-[#2D2A26] text-[#EAE6DF] border-[#2D2A26]'
    : tone === 'warn' ? 'bg-amber-50 border-amber-200'
    : 'bg-white border-[#E5E0D8]';
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${tone === 'dark' ? 'text-[#C19A6B]' : 'text-[#8B7D6B]'}`}>
        {icon}{label}
      </div>
      <p className="text-lg font-extrabold mt-1.5 tabular-nums">{value}</p>
      {hint && <p className={`text-[10px] mt-0.5 ${tone === 'dark' ? 'text-[#EAE6DF]/60' : 'text-[#8B7D6B]'}`}>{hint}</p>}
    </div>
  );
};
