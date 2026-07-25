/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StockView — "Estoque / Lista de Preço" (relatório RPR053)
 *
 * Cada linha do RPR053 é um SKU com saldo disponível, custo de reposição e
 * preço de venda. Esta tela responde às três perguntas que importam para o
 * caixa: quanto dinheiro está parado em mercadoria, onde ele está parado, e
 * qual margem esse estoque promete se for vendido.
 *
 * Performance: a lista tem 5.188 SKUs. Nada é renderizado de uma vez — busca
 * com debounce, filtro memoizado e paginação. Os cartões de topo vêm do
 * documento de resumo (1 leitura no Firestore), não de varrer a coleção.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Download,
  Layers,
  PackageSearch,
  Percent,
  Search,
  TrendingUp,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { StockItem, StockSummary } from '../types';
import { exportReportToExcel, formatCurrency } from '../utils/exportUtils';
import { parseStockRows } from '../utils/sheetParsers';
import { useDebouncedValue, usePagination, useSort } from '../utils/uiHooks';

interface StockViewProps {
  items: StockItem[];
  summary: StockSummary | null;
  isLoading: boolean;
  onImportStock: (items: StockItem[]) => Promise<void> | void;
  onReload: () => void;
  userRole: string;
}

type BalanceFilter = 'all' | 'com_saldo' | 'zerado';

const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const formatPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export const StockView: React.FC<StockViewProps> = ({
  items,
  summary,
  isLoading,
  onImportStock,
  onReload,
  userRole,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('com_saldo');
  const [detailItem, setDetailItem] = useState<StockItem | null>(null);
  const [importStatus, setImportStatus] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);

  const canEdit = userRole !== 'analista';

  // ── Indicadores ────────────────────────────────────────────────────────────
  // Preferimos o documento de resumo (barato). Se ele ainda não existir — por
  // exemplo antes da primeira importação — calculamos a partir do que já está
  // carregado, para a tela nunca aparecer vazia sem explicação.
  const kpis = useMemo(() => {
    if (summary && summary.totalSkus > 0) {
      return {
        totalSkus: summary.totalSkus,
        withBalance: summary.skusWithBalance,
        zeroed: summary.skusZeroed,
        qty: summary.totalQty,
        cost: summary.totalValueAtCost,
        sale: summary.totalValueAtSale,
        margin: summary.potentialGrossMargin,
        markup: summary.averageMarkup,
        reference: summary.referenceDate,
      };
    }
    const withBalance = items.filter((i) => i.availableQty > 0);
    const cost = items.reduce((a, i) => a + i.stockValueAtCost, 0);
    const sale = items.reduce((a, i) => a + i.stockValueAtSale, 0);
    return {
      totalSkus: items.length,
      withBalance: withBalance.length,
      zeroed: items.length - withBalance.length,
      qty: items.reduce((a, i) => a + i.availableQty, 0),
      cost,
      sale,
      margin: sale - cost,
      markup: cost > 0 ? (sale / cost - 1) * 100 : 0,
      reference: '',
    };
  }, [summary, items]);

  const types = useMemo(() => {
    const set = new Set(items.map((i) => i.productTypeDescription).filter(Boolean));
    return [...set].sort();
  }, [items]);

  // Consolidado por tipo de produto — mostra ONDE o capital está parado.
  const byType = useMemo(() => {
    const map = new Map<string, { type: string; skus: number; withBalance: number; qty: number; cost: number; sale: number }>();
    items.forEach((i) => {
      const t = i.productTypeDescription || 'SEM TIPO';
      const cur = map.get(t) || { type: t, skus: 0, withBalance: 0, qty: 0, cost: 0, sale: 0 };
      cur.skus++;
      if (i.availableQty > 0) cur.withBalance++;
      cur.qty += i.availableQty;
      cur.cost += i.stockValueAtCost;
      cur.sale += i.stockValueAtSale;
      map.set(t, cur);
    });
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [items]);

  // ── Filtro (memoizado: não roda de novo ao abrir modal, trocar página etc.) ─
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((i) => {
      if (balanceFilter === 'com_saldo' && i.availableQty <= 0) return false;
      if (balanceFilter === 'zerado' && i.availableQty > 0) return false;
      if (typeFilter !== 'all' && i.productTypeDescription !== typeFilter) return false;
      if (!term) return true;
      return (
        i.productCode.toLowerCase().includes(term) ||
        i.productDescription.toLowerCase().includes(term) ||
        i.brandReference.toLowerCase().includes(term) ||
        i.locationIdentifier.toLowerCase().includes(term)
      );
    });
  }, [items, search, typeFilter, balanceFilter]);

  const { sorted, sortKey, sortDir, toggle } = useSort<StockItem>(filtered, 'stockValueAtCost', 'desc');
  const pager = usePagination(sorted, 50);

  const filteredTotals = useMemo(() => ({
    cost: filtered.reduce((a, i) => a + i.stockValueAtCost, 0),
    sale: filtered.reduce((a, i) => a + i.stockValueAtSale, 0),
    qty: filtered.reduce((a, i) => a + i.availableQty, 0),
  }), [filtered]);

  // ── Importação ─────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setIsImporting(true);
    setImportStatus('Lendo a planilha...');
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      const parsed = parseStockRows(rows);

      if (parsed.missingHeaders.length) {
        setImportStatus(
          `Atenção: faltam colunas no arquivo (${parsed.missingHeaders.slice(0, 5).join(', ')}` +
          `${parsed.missingHeaders.length > 5 ? '...' : ''}). Os campos ausentes ficam vazios.`
        );
      }
      if (!parsed.items.length) {
        setImportStatus('Nenhum produto válido encontrado na planilha.');
        setIsImporting(false);
        return;
      }
      setImportStatus(`Gravando ${parsed.items.length} produtos (atualiza os existentes, não duplica)...`);
      await onImportStock(parsed.items);
      setImportStatus(
        `Importação concluída: ${parsed.items.length} produtos processados` +
        `${parsed.duplicateKeys ? `, ${parsed.duplicateKeys} códigos repetidos no arquivo consolidados` : ''}` +
        `${parsed.errors.length ? `, ${parsed.errors.length} linhas com erro` : ''}.`
      );
    } catch (err: any) {
      setImportStatus(`Erro ao importar: ${err?.message || err}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = () => {
    exportReportToExcel(
      sorted.map((i) => ({
        Código: i.productCode,
        Produto: i.productDescription,
        Tipo: i.productTypeDescription,
        Referência: i.brandReference,
        Localização: i.locationIdentifier,
        Unidade: i.unit,
        'ABC Estoque': i.abcStock,
        'ABC Venda': i.abcSales,
        Quantidade: i.availableQty,
        'Custo Unit.': i.replacementCost,
        'Venda Unit.': i.salePrice,
        'Valor a Custo': i.stockValueAtCost,
        'Valor a Venda': i.stockValueAtSale,
        'Markup %': i.markupPercent,
        'Margem %': i.marginPercent,
      })),
      'Estoque',
      `estoque_${new Date().toISOString().slice(0, 10)}`
    );
  };

  const SortHeader: React.FC<{ field: keyof StockItem; label: string; align?: string }> = ({ field, label, align = 'left' }) => (
    <th
      className={`px-3 py-2 text-${align} font-bold uppercase tracking-wider text-[10px] cursor-pointer select-none hover:text-[#C19A6B] transition-colors`}
      onClick={() => toggle(field)}
    >
      {label}
      {sortKey === field && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <Boxes className="w-5 h-5 text-[#C19A6B]" />
            Estoque &amp; Lista de Preço
          </h2>
          <p className="text-xs text-[#8B7D6B]">
            Relatório RPR053 — saldo disponível, custo de reposição e preço de venda por SKU
            {kpis.reference && ` · posição de ${kpis.reference.split('-').reverse().join('/')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReload}
            className="px-3 py-2 rounded-lg text-xs font-bold border border-[#D8D2C7] hover:bg-white transition-colors"
          >
            Atualizar
          </button>
          <button
            onClick={handleExport}
            disabled={!sorted.length}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Exportar
          </button>
          {canEdit && (
            <label className={`px-3 py-2 rounded-lg text-xs font-bold bg-[#C19A6B] text-white hover:bg-[#A9835A] cursor-pointer transition-colors flex items-center gap-1.5 ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
              <UploadCloud className="w-3.5 h-3.5" />
              {isImporting ? 'Importando...' : 'Importar RPR053'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ''; }}
              />
            </label>
          )}
        </div>
      </div>

      {importStatus && (
        <div className="rounded-lg border border-[#C19A6B]/40 bg-[#C19A6B]/10 px-4 py-2.5 text-xs font-semibold text-[#6B5A45] flex items-start justify-between gap-3">
          <span>{importStatus}</span>
          <button onClick={() => setImportStatus('')} className="shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          label="Capital parado (custo)"
          value={formatCurrency(kpis.cost)}
          hint={`${formatQty(kpis.qty)} unidades em ${formatQty(kpis.withBalance)} SKUs`}
          tone="dark"
        />
        <KpiCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Valor potencial de venda"
          value={formatCurrency(kpis.sale)}
          hint={`Margem bruta potencial ${formatCurrency(kpis.margin)}`}
        />
        <KpiCard
          icon={<Percent className="w-4 h-4" />}
          label="Markup médio do estoque"
          value={formatPct(kpis.markup)}
          hint={`Margem sobre venda ${formatPct(kpis.sale > 0 ? (kpis.margin / kpis.sale) * 100 : 0)}`}
        />
        <KpiCard
          icon={<Layers className="w-4 h-4" />}
          label="SKUs cadastrados"
          value={formatQty(kpis.totalSkus)}
          hint={`${formatQty(kpis.zeroed)} sem saldo (${formatPct(kpis.totalSkus ? (kpis.zeroed / kpis.totalSkus) * 100 : 0)} do cadastro)`}
          tone={kpis.zeroed / Math.max(kpis.totalSkus, 1) > 0.6 ? 'warn' : 'default'}
        />
      </div>

      {/* Onde o capital está parado */}
      {byType.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E0D8] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E0D8]">
            <h3 className="text-sm font-extrabold">Onde o capital está parado</h3>
            <p className="text-[11px] text-[#8B7D6B]">Valor a custo por categoria de produto — a base para decidir o que liquidar primeiro</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F7F5F1] text-[#8B7D6B]">
                <tr>
                  <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-[10px]">Categoria</th>
                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">SKUs c/ saldo</th>
                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Qtde</th>
                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Valor a custo</th>
                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">% do capital</th>
                  <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[10px]">Markup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE7]">
                {byType.slice(0, 12).map((t) => (
                  <tr key={t.type} className="hover:bg-[#FBFAF8]">
                    <td className="px-3 py-2 font-semibold">{t.type}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.withBalance}/{t.skus}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(t.qty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{formatCurrency(t.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-[#F0EDE7] rounded-full overflow-hidden">
                          <div className="h-full bg-[#C19A6B]" style={{ width: `${kpis.cost ? (t.cost / kpis.cost) * 100 : 0}%` }} />
                        </div>
                        <span>{formatPct(kpis.cost ? (t.cost / kpis.cost) * 100 : 0)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPct(t.cost > 0 ? (t.sale / t.cost - 1) * 100 : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-[#E5E0D8] p-3 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B7D6B]" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por código, descrição, referência ou localização..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#D8D2C7] text-xs focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[#D8D2C7] text-xs font-semibold bg-white"
        >
          <option value="all">Todas as categorias</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex rounded-lg border border-[#D8D2C7] overflow-hidden text-xs font-bold">
          {([['com_saldo', 'Com saldo'], ['zerado', 'Zerados'], ['all', 'Todos']] as [BalanceFilter, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setBalanceFilter(v)}
              className={`px-3 py-2 transition-colors ${balanceFilter === v ? 'bg-[#2D2A26] text-white' : 'bg-white hover:bg-[#F7F5F1]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Resultado do filtro */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[#8B7D6B] font-semibold px-1">
        <span>{formatQty(filtered.length)} SKUs no filtro</span>
        <span>Qtde {formatQty(filteredTotals.qty)}</span>
        <span>Custo <strong className="text-[#2D2A26]">{formatCurrency(filteredTotals.cost)}</strong></span>
        <span>Venda <strong className="text-[#2D2A26]">{formatCurrency(filteredTotals.sale)}</strong></span>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-[#E5E0D8] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F7F5F1] text-[#8B7D6B]">
              <tr>
                <SortHeader field="productCode" label="Código" />
                <SortHeader field="productDescription" label="Produto" />
                <SortHeader field="productTypeDescription" label="Categoria" />
                <SortHeader field="locationIdentifier" label="Local" />
                <SortHeader field="availableQty" label="Qtde" align="right" />
                <SortHeader field="replacementCost" label="Custo un." align="right" />
                <SortHeader field="salePrice" label="Venda un." align="right" />
                <SortHeader field="stockValueAtCost" label="Capital parado" align="right" />
                <SortHeader field="markupPercent" label="Markup" align="right" />
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE7]">
              {isLoading && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-[#8B7D6B]">Carregando estoque...</td></tr>
              )}
              {!isLoading && pager.items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-[#8B7D6B]">
                    <PackageSearch className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    {items.length === 0
                      ? 'Nenhum produto cadastrado. Importe o relatório RPR053 para começar.'
                      : 'Nenhum produto atende aos filtros.'}
                  </td>
                </tr>
              )}
              {pager.items.map((i) => (
                <tr key={i.id} className="hover:bg-[#FBFAF8]">
                  <td className="px-3 py-2 font-mono text-[11px]">{i.productCode}</td>
                  <td className="px-3 py-2 font-semibold max-w-[260px] truncate" title={i.productDescription}>
                    {i.productDescription}
                    {i.brandReference && <span className="ml-1.5 text-[10px] text-[#8B7D6B] font-normal">{i.brandReference}</span>}
                  </td>
                  <td className="px-3 py-2 text-[#8B7D6B]">{i.productTypeDescription}</td>
                  <td className="px-3 py-2 text-[#8B7D6B]">{i.locationIdentifier || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    {formatQty(i.availableQty)} <span className="text-[10px] font-normal text-[#8B7D6B]">{i.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(i.replacementCost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(i.salePrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{formatCurrency(i.stockValueAtCost)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${i.markupPercent < 20 ? 'text-red-600' : i.markupPercent > 100 ? 'text-emerald-700' : ''}`}>
                    {formatPct(i.markupPercent)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setDetailItem(i)} className="text-[#C19A6B] hover:text-[#A9835A] font-bold text-[11px]">Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#E5E0D8] bg-[#FBFAF8] text-xs">
          <span className="text-[#8B7D6B] font-semibold">
            Mostrando {pager.from}–{pager.to} de {formatQty(pager.total)}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pager.pageSize}
              onChange={(e) => pager.setPageSize(Number(e.target.value))}
              className="px-2 py-1.5 rounded border border-[#D8D2C7] font-semibold bg-white"
            >
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} por página</option>)}
            </select>
            <button onClick={pager.prev} disabled={!pager.canPrev} className="px-3 py-1.5 rounded border border-[#D8D2C7] font-bold disabled:opacity-40 bg-white hover:bg-[#F7F5F1]">Anterior</button>
            <span className="font-bold">{pager.page}/{pager.pageCount}</span>
            <button onClick={pager.next} disabled={!pager.canNext} className="px-3 py-1.5 rounded border border-[#D8D2C7] font-bold disabled:opacity-40 bg-white hover:bg-[#F7F5F1]">Próxima</button>
          </div>
        </div>
      </div>

      {/* Detalhe do SKU — todos os campos do RPR053 */}
      {detailItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetailItem(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-5 py-4 border-b border-[#E5E0D8] flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#C19A6B]">Produto {detailItem.productCode}</p>
                <h3 className="text-base font-extrabold">{detailItem.productDescription}</h3>
              </div>
              <button onClick={() => setDetailItem(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
              {([
                ['Empresa', detailItem.companyName],
                ['Estoque', detailItem.stockDescription],
                ['Categoria', detailItem.productTypeDescription],
                ['Referência da marca', detailItem.brandReference],
                ['Descrição detalhada', detailItem.detailedDescription],
                ['Localização', detailItem.locationIdentifier || '—'],
                ['Unidade', detailItem.unit],
                ['Grupo de produto', detailItem.productGroupCode],
                ['Grupo de lucratividade', detailItem.profitabilityGroup],
                ['ABC popularidade', detailItem.abcPopularity || '—'],
                ['ABC venda', detailItem.abcSales || '—'],
                ['ABC estoque', detailItem.abcStock || '—'],
                ['Quantidade disponível', `${formatQty(detailItem.availableQty)} ${detailItem.unit}`],
                ['Custo de reposição', formatCurrency(detailItem.replacementCost)],
                ['Preço de venda', formatCurrency(detailItem.salePrice)],
                ['Preço público sugerido', formatCurrency(detailItem.publicPrice)],
                ['Valor de garantia', formatCurrency(detailItem.warrantyPrice)],
                ['Capital parado (custo)', formatCurrency(detailItem.stockValueAtCost)],
                ['Valor potencial (venda)', formatCurrency(detailItem.stockValueAtSale)],
                ['Markup', formatPct(detailItem.markupPercent)],
                ['Margem sobre venda', formatPct(detailItem.marginPercent)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-[#8B7D6B] font-bold">{label}</p>
                  <p className="font-semibold break-words">{value || '—'}</p>
                </div>
              ))}
            </div>
            {detailItem.availableQty > 0 && detailItem.markupPercent < 20 && (
              <div className="mx-5 mb-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-900 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Markup de {formatPct(detailItem.markupPercent)} — abaixo do markup médio do estoque
                  ({formatPct(kpis.markup)}). Verifique se o preço de venda está desatualizado
                  em relação ao custo de reposição.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
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
