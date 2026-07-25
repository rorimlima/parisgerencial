/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingView — "Faturamento" (relatório RPR014 — Notas Fiscais)
 *
 * Três camadas, da mais barata para a mais cara em leitura do Firestore:
 *   1. Resumos mensais (12 documentos por ano) — sempre carregados;
 *   2. Consolidado por cliente — carregado uma vez, alimenta o cruzamento com
 *      a inadimplência;
 *   3. Detalhe nota a nota — carregado SOB DEMANDA, só quando o usuário clica
 *      em "carregar detalhe do ano". É por isso que a tela abre instantânea
 *      mesmo com 29 mil notas no banco.
 *
 * O cruzamento com Títulos em Atraso é feito por PessoaCod = cod_cliente, o
 * mesmo código nos dois relatórios do ERP. O indicador que interessa não é o
 * valor vencido isolado, e sim o valor vencido dividido pelo que o cliente
 * comprou: é isso que distingue um bom cliente com atraso pontual de um cliente
 * que virou prejuízo.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  FileText,
  Link2,
  Receipt,
  Search,
  ShieldAlert,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  BillingCustomerSummary,
  BillingMonthSummary,
  Customer,
  DelinquentTitle,
  InvoiceRecord,
} from '../types';
import { exportReportToExcel, formatCurrency, MONTH_KEYS_LIST } from '../utils/exportUtils';
import { parseInvoiceRows } from '../utils/sheetParsers';
import {
  buildCustomerRiskRows,
  buildSellerExposure,
  measureBillingLinkCoverage,
} from '../utils/linking';
import { useDebouncedValue, usePagination } from '../utils/uiHooks';

interface BillingViewProps {
  summaries: BillingMonthSummary[];
  billingCustomers: BillingCustomerSummary[];
  customers: Customer[];
  delinquentTitles: DelinquentTitle[];
  selectedYear: number;
  isLoading: boolean;
  onImportInvoices: (records: InvoiceRecord[]) => Promise<void> | void;
  onLoadYearDetail: (year: number) => Promise<InvoiceRecord[]>;
  onReload: () => void;
  userRole: string;
}

type Panel = 'visao' | 'risco' | 'detalhe';

const formatPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const formatInt = (n: number) => n.toLocaleString('pt-BR');

const RISK_STYLES: Record<string, string> = {
  'Crítico': 'bg-red-100 text-red-800 border-red-200',
  'Alto': 'bg-orange-100 text-orange-800 border-orange-200',
  'Médio': 'bg-amber-100 text-amber-800 border-amber-200',
  'Baixo': 'bg-sky-100 text-sky-800 border-sky-200',
  'Sem atraso': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const BillingView: React.FC<BillingViewProps> = ({
  summaries,
  billingCustomers,
  customers,
  delinquentTitles,
  selectedYear,
  isLoading,
  onImportInvoices,
  onLoadYearDetail,
  onReload,
  userRole,
}) => {
  const [panel, setPanel] = useState<Panel>('visao');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [importStatus, setImportStatus] = useState('');
  const [importProgress, setImportProgress] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [detail, setDetail] = useState<InvoiceRecord[]>([]);
  const [detailLoaded, setDetailLoaded] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<InvoiceRecord | null>(null);

  const canEdit = userRole !== 'analista';

  // ── Série mensal do ano selecionado ────────────────────────────────────────
  const yearMonths = useMemo(() => {
    const map = new Map(summaries.filter((s) => s.year === selectedYear).map((s) => [s.monthKey, s]));
    return MONTH_KEYS_LIST.map((mk) => map.get(mk) || null);
  }, [summaries, selectedYear]);

  const yearTotals = useMemo(() => {
    const list = summaries.filter((s) => s.year === selectedYear);
    const revenue = list.reduce((a, s) => a + s.grossRevenue, 0);
    const invoices = list.reduce((a, s) => a + s.invoiceCount, 0);
    const taxes = list.reduce((a, s) => a + s.taxTotal, 0);
    const canceled = list.reduce((a, s) => a + s.canceledValue, 0);
    const monthsWithData = list.filter((s) => s.grossRevenue > 0).length;
    return {
      revenue,
      invoices,
      taxes,
      canceled,
      monthsWithData,
      averageTicket: invoices ? revenue / invoices : 0,
      averageMonth: monthsWithData ? revenue / monthsWithData : 0,
    };
  }, [summaries, selectedYear]);

  // Comparação com o ano anterior no MESMO número de meses — comparar um ano
  // fechado com um ano em curso daria uma queda falsa.
  const previousComparison = useMemo(() => {
    const cur = summaries.filter((s) => s.year === selectedYear && s.grossRevenue > 0);
    const monthsWithData = new Set(cur.map((s) => s.monthKey));
    const prev = summaries.filter((s) => s.year === selectedYear - 1 && monthsWithData.has(s.monthKey));
    const curTotal = cur.reduce((a, s) => a + s.grossRevenue, 0);
    const prevTotal = prev.reduce((a, s) => a + s.grossRevenue, 0);
    return {
      curTotal,
      prevTotal,
      variation: prevTotal > 0 ? (curTotal / prevTotal - 1) * 100 : 0,
      monthCount: monthsWithData.size,
      hasBase: prevTotal > 0,
    };
  }, [summaries, selectedYear]);

  const bySeller = useMemo(() => {
    const map = new Map<string, number>();
    summaries.filter((s) => s.year === selectedYear).forEach((s) => {
      Object.entries(s.bySeller || {}).forEach(([k, v]) => map.set(k, (map.get(k) || 0) + v));
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [summaries, selectedYear]);

  const bySegment = useMemo(() => {
    const map = new Map<string, number>();
    summaries.filter((s) => s.year === selectedYear).forEach((s) => {
      Object.entries(s.bySegment || {}).forEach(([k, v]) => map.set(k, (map.get(k) || 0) + v));
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [summaries, selectedYear]);

  const maxMonth = useMemo(
    () => Math.max(1, ...yearMonths.map((m) => m?.grossRevenue || 0)),
    [yearMonths]
  );

  // ── Cruzamento Faturamento × Inadimplência ─────────────────────────────────
  // Janela de receita = ano selecionado + anterior. Um título vencido hoje deve
  // ser comparado com o faturamento recente, não com o histórico de 6 anos.
  const riskRows = useMemo(
    () => buildCustomerRiskRows(billingCustomers, delinquentTitles, customers, [selectedYear, selectedYear - 1]),
    [billingCustomers, delinquentTitles, customers, selectedYear]
  );

  const coverage = useMemo(
    () => measureBillingLinkCoverage(billingCustomers, customers),
    [billingCustomers, customers]
  );

  const sellerExposure = useMemo(() => buildSellerExposure(riskRows), [riskRows]);

  const riskTotals = useMemo(() => {
    const withOverdue = riskRows.filter((r) => r.overdueAmount > 0);
    const overdue = withOverdue.reduce((a, r) => a + r.overdueAmount, 0);
    const revenueWindow = riskRows.reduce((a, r) => a + r.totalRevenue, 0);
    return {
      overdue,
      customers: withOverdue.length,
      critical: withOverdue.filter((r) => r.riskLevel === 'Crítico').length,
      revenueWindow,
      rate: revenueWindow > 0 ? (overdue / revenueWindow) * 100 : 0,
    };
  }, [riskRows]);

  const filteredRisk = useMemo(() => {
    const term = search.trim().toLowerCase();
    return riskRows.filter((r) => {
      if (riskFilter === 'all' ? false : r.riskLevel !== riskFilter) return false;
      if (riskFilter === 'all' && r.overdueAmount <= 0 && !term) return false;
      if (!term) return true;
      return r.personName.toLowerCase().includes(term) || r.personCode.toLowerCase().includes(term);
    });
  }, [riskRows, riskFilter, search]);

  const riskPager = usePagination(filteredRisk, 40);

  // ── Detalhe do ano (sob demanda) ───────────────────────────────────────────
  const filteredDetail = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return detail;
    return detail.filter((d) =>
      d.personName.toLowerCase().includes(term) ||
      d.invoiceNumber.toLowerCase().includes(term) ||
      d.personCode.toLowerCase().includes(term) ||
      d.sellerName.toLowerCase().includes(term)
    );
  }, [detail, search]);

  const detailPager = usePagination(filteredDetail, 50);

  const handleLoadDetail = async () => {
    setLoadingDetail(true);
    try {
      const rows = await onLoadYearDetail(selectedYear);
      setDetail(rows);
      setDetailLoaded(selectedYear);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ── Importação do RPR014 ───────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setIsImporting(true);
    setImportStatus('');
    setImportProgress('Lendo a planilha (arquivos grandes levam alguns segundos)...');
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      setImportProgress(`Interpretando ${formatInt(rows.length)} linhas...`);
      const parsed = parseInvoiceRows(rows);

      if (!parsed.records.length) {
        setImportStatus('Nenhuma nota válida encontrada na planilha.');
        setImportProgress('');
        setIsImporting(false);
        return;
      }

      const years = [...new Set(parsed.records.map((r) => r.year))].sort();
      setImportProgress(
        `Gravando ${formatInt(parsed.records.length)} linhas de ${years.length} ano(s): ${years.join(', ')}. ` +
        'Registros já existentes são atualizados, não duplicados.'
      );
      await onImportInvoices(parsed.records);

      const warn = parsed.missingHeaders.length
        ? ` Atenção: colunas ausentes no arquivo (${parsed.missingHeaders.slice(0, 4).join(', ')}${parsed.missingHeaders.length > 4 ? '...' : ''}).`
        : '';
      setImportStatus(
        `Importação concluída: ${formatInt(parsed.records.length)} linhas processadas, ` +
        `${formatInt(new Set(parsed.records.map((r) => r.invoiceCode)).size)} notas distintas, ` +
        `${formatInt(new Set(parsed.records.map((r) => r.personCode)).size)} clientes.` +
        (parsed.duplicateKeys ? ` ${parsed.duplicateKeys} chaves repetidas no próprio arquivo foram consolidadas.` : '') +
        (parsed.errors.length ? ` ${parsed.errors.length} linhas ignoradas por erro.` : '') +
        warn
      );
      setImportProgress('');
      setDetail([]);
      setDetailLoaded(null);
    } catch (err: any) {
      setImportStatus(`Erro ao importar: ${err?.message || err}`);
      setImportProgress('');
    } finally {
      setIsImporting(false);
    }
  };

  const exportRisk = () => {
    exportReportToExcel(
      filteredRisk.map((r) => ({
        'Cód. Cliente': r.personCode,
        Cliente: r.personName,
        'Faturado (janela)': r.totalRevenue,
        'Vencido': r.overdueAmount,
        'Títulos vencidos': r.overdueCount,
        '% Vencido/Faturado': r.overdueRate * 100,
        'Pior aging': r.worstAging,
        'Dias em atraso (máx.)': r.maxDaysOverdue,
        'Última compra': r.lastPurchaseDate,
        'Vendedor': r.mainSeller,
        Risco: r.riskLevel,
      })),
      'Risco por Cliente',
      `risco_faturamento_inadimplencia_${selectedYear}`
    );
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#C19A6B]" />
            Faturamento
          </h2>
          <p className="text-xs text-[#8B7D6B]">
            Relatório RPR014 — notas fiscais emitidas, vinculadas ao cadastro de clientes e aos títulos em atraso
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onReload} className="px-3 py-2 rounded-lg text-xs font-bold border border-[#D8D2C7] hover:bg-white transition-colors">
            Atualizar
          </button>
          {canEdit && (
            <label className={`px-3 py-2 rounded-lg text-xs font-bold bg-[#C19A6B] text-white hover:bg-[#A9835A] cursor-pointer transition-colors flex items-center gap-1.5 ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
              <UploadCloud className="w-3.5 h-3.5" />
              {isImporting ? 'Importando...' : 'Importar RPR014'}
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

      {(importProgress || importStatus) && (
        <div className="rounded-lg border border-[#C19A6B]/40 bg-[#C19A6B]/10 px-4 py-2.5 text-xs font-semibold text-[#6B5A45] flex items-start justify-between gap-3">
          <span>{importProgress || importStatus}</span>
          {!isImporting && <button onClick={() => { setImportStatus(''); setImportProgress(''); }} className="shrink-0"><X className="w-3.5 h-3.5" /></button>}
        </div>
      )}

      {/* Abas */}
      <div className="flex gap-1 border-b border-[#E5E0D8]">
        {([['visao', 'Visão do ano', FileText], ['risco', 'Risco por cliente', ShieldAlert], ['detalhe', 'Notas fiscais', Receipt]] as [Panel, string, any][]).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            className={`px-4 py-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              panel === id ? 'border-[#C19A6B] text-[#2D2A26]' : 'border-transparent text-[#8B7D6B] hover:text-[#2D2A26]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ════════════════ VISÃO DO ANO ════════════════ */}
      {panel === 'visao' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label={`Faturamento ${selectedYear}`}
              value={formatCurrency(yearTotals.revenue)}
              hint={`${yearTotals.monthsWithData} meses com movimento · média ${formatCurrency(yearTotals.averageMonth)}/mês`}
              tone="dark"
            />
            <Kpi
              label="vs. ano anterior"
              value={previousComparison.hasBase ? `${previousComparison.variation >= 0 ? '+' : ''}${formatPct(previousComparison.variation)}` : '—'}
              hint={previousComparison.hasBase
                ? `${formatCurrency(previousComparison.curTotal)} contra ${formatCurrency(previousComparison.prevTotal)} nos mesmos ${previousComparison.monthCount} meses`
                : 'Sem base do ano anterior importada'}
              tone={previousComparison.hasBase ? (previousComparison.variation >= 0 ? 'good' : 'bad') : 'default'}
              icon={previousComparison.hasBase ? (previousComparison.variation >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />) : undefined}
            />
            <Kpi
              label="Notas emitidas"
              value={formatInt(yearTotals.invoices)}
              hint={`Ticket médio ${formatCurrency(yearTotals.averageTicket)}`}
            />
            <Kpi
              label="Impostos destacados"
              value={formatCurrency(yearTotals.taxes)}
              hint={`${formatPct(yearTotals.revenue ? (yearTotals.taxes / yearTotals.revenue) * 100 : 0)} da receita${yearTotals.canceled ? ` · ${formatCurrency(yearTotals.canceled)} cancelado` : ''}`}
            />
          </div>

          {/* Série mensal */}
          <div className="bg-white rounded-xl border border-[#E5E0D8] p-4">
            <h3 className="text-sm font-extrabold mb-3">Faturamento mês a mês — {selectedYear}</h3>
            {yearTotals.revenue === 0 ? (
              <p className="text-xs text-[#8B7D6B] py-6 text-center">
                Nenhum faturamento importado para {selectedYear}. Use "Importar RPR014".
              </p>
            ) : (
              <div className="flex items-end gap-1.5 h-40">
                {yearMonths.map((m, idx) => {
                  const value = m?.grossRevenue || 0;
                  const height = (value / maxMonth) * 100;
                  return (
                    <div key={MONTH_KEYS_LIST[idx]} className="flex-1 flex flex-col items-center justify-end h-full group">
                      <span className="text-[9px] font-bold text-[#8B7D6B] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {formatCurrency(value)}
                      </span>
                      <div
                        className="w-full rounded-t bg-[#C19A6B] hover:bg-[#A9835A] transition-colors"
                        style={{ height: `${Math.max(height, value > 0 ? 3 : 0)}%` }}
                        title={`${MONTH_KEYS_LIST[idx]}: ${formatCurrency(value)}`}
                      />
                      <span className="text-[9px] font-bold text-[#8B7D6B] mt-1 uppercase">{MONTH_KEYS_LIST[idx]}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <RankPanel title="Faturamento por vendedor" subtitle="Concentração da receita na equipe" rows={bySeller} total={yearTotals.revenue} />
            <RankPanel title="Faturamento por segmento" subtitle="Oficina x balcão — mix de canal" rows={bySegment} total={yearTotals.revenue} />
          </div>

          {/* Cobertura do vínculo */}
          <div className="bg-white rounded-xl border border-[#E5E0D8] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Link2 className="w-4 h-4 text-[#C19A6B]" />
              <h3 className="text-sm font-extrabold">Vínculo com o cadastro de clientes</h3>
            </div>
            <p className="text-[11px] text-[#8B7D6B] mb-3">
              PessoaCod (faturamento) casado com cod_cliente (cadastro). O que não casa não some — fica listado abaixo para você completar o cadastro.
            </p>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-2 bg-[#F0EDE7] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${coverage.coveragePercent}%` }} />
              </div>
              <span className="text-xs font-extrabold tabular-nums">{formatPct(coverage.coveragePercent)}</span>
            </div>
            <p className="text-[11px] text-[#8B7D6B]">
              {formatInt(coverage.linked)} de {formatInt(coverage.total)} clientes com faturamento estão no cadastro.
              {coverage.unlinked > 0 && ` ${formatInt(coverage.unlinked)} sem cadastro correspondente.`}
            </p>
            {coverage.unlinkedCodes.length > 0 && (
              <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-[#F0EDE7]">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#F7F5F1] text-[#8B7D6B] sticky top-0">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left font-bold">Cód.</th>
                      <th className="px-2.5 py-1.5 text-left font-bold">Nome na nota</th>
                      <th className="px-2.5 py-1.5 text-right font-bold">Faturado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F5F3EF]">
                    {coverage.unlinkedCodes.slice(0, 25).map((u) => (
                      <tr key={u.code}>
                        <td className="px-2.5 py-1.5 font-mono">{u.code}</td>
                        <td className="px-2.5 py-1.5">{u.name}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(u.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ RISCO POR CLIENTE ════════════════ */}
      {panel === 'risco' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Vencido total" value={formatCurrency(riskTotals.overdue)} hint={`${formatInt(riskTotals.customers)} clientes com título em atraso`} tone="dark" />
            <Kpi
              label="Vencido / Faturado"
              value={formatPct(riskTotals.rate)}
              hint={`Base: faturamento de ${selectedYear - 1} e ${selectedYear} (${formatCurrency(riskTotals.revenueWindow)})`}
              tone={riskTotals.rate > 5 ? 'bad' : riskTotals.rate > 2 ? 'warn' : 'good'}
            />
            <Kpi label="Clientes críticos" value={formatInt(riskTotals.critical)} hint="Mais de 90 dias em atraso ou metade do faturado vencido" tone={riskTotals.critical > 0 ? 'warn' : 'default'} />
            <Kpi label="Títulos em atraso" value={formatInt(delinquentTitles.length)} hint="Base do módulo de Inadimplência" />
          </div>

          {/* Exposição por vendedor */}
          {sellerExposure.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E0D8] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E5E0D8]">
                <h3 className="text-sm font-extrabold">Exposição por vendedor</h3>
                <p className="text-[11px] text-[#8B7D6B]">Quanto da carteira que cada vendedor construiu está vencida</p>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-[#F7F5F1] text-[#8B7D6B]">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Vendedor</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Faturado</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Vencido</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">% vencido</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Clientes em atraso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE7]">
                  {sellerExposure.filter((s) => s.revenue > 0 || s.overdueAmount > 0).slice(0, 12).map((s) => (
                    <tr key={s.sellerName} className="hover:bg-[#FBFAF8]">
                      <td className="px-3 py-2 font-semibold">{s.sellerName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{formatCurrency(s.overdueAmount)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${s.overdueRate > 0.05 ? 'text-red-600' : ''}`}>{formatPct(s.overdueRate * 100)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.customersAtRisk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-[#E5E0D8] p-3 flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B7D6B]" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar cliente por nome ou código..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#D8D2C7] text-xs focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40"
              />
            </div>
            <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-[#D8D2C7] text-xs font-semibold bg-white">
              <option value="all">Somente com atraso</option>
              <option value="Crítico">Crítico</option>
              <option value="Alto">Alto</option>
              <option value="Médio">Médio</option>
              <option value="Baixo">Baixo</option>
              <option value="Sem atraso">Sem atraso</option>
            </select>
            <button onClick={exportRisk} disabled={!filteredRisk.length} className="px-3 py-2 rounded-lg text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] disabled:opacity-40 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Exportar
            </button>
          </div>

          <div className="bg-white rounded-xl border border-[#E5E0D8] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F7F5F1] text-[#8B7D6B]">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Cliente</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Faturado</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Vencido</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">% venc./fat.</th>
                    <th className="px-3 py-2 text-center font-bold uppercase text-[10px] tracking-wider">Aging</th>
                    <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Dias</th>
                    <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Vendedor</th>
                    <th className="px-3 py-2 text-center font-bold uppercase text-[10px] tracking-wider">Risco</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE7]">
                  {isLoading && <tr><td colSpan={8} className="px-3 py-8 text-center text-[#8B7D6B]">Carregando...</td></tr>}
                  {!isLoading && riskPager.items.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-[#8B7D6B]">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      {billingCustomers.length === 0
                        ? 'Importe o RPR014 para cruzar faturamento com inadimplência.'
                        : 'Nenhum cliente atende ao filtro.'}
                    </td></tr>
                  )}
                  {riskPager.items.map((r) => (
                    <tr key={r.personCode} className="hover:bg-[#FBFAF8]">
                      <td className="px-3 py-2">
                        <p className="font-semibold max-w-[220px] truncate" title={r.personName}>{r.personName}</p>
                        <p className="text-[10px] text-[#8B7D6B] font-mono">
                          {r.personCode}
                          {r.customerId ? <span className="ml-1.5 text-emerald-600">● vinculado</span> : <span className="ml-1.5 text-amber-600">● sem cadastro</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.totalRevenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{r.overdueAmount > 0 ? formatCurrency(r.overdueAmount) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${r.overdueRate >= 0.25 ? 'text-red-600' : ''}`}>
                        {r.overdueAmount > 0 ? formatPct(r.overdueRate * 100) : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">{r.worstAging}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.maxDaysOverdue || '—'}</td>
                      <td className="px-3 py-2 text-[#8B7D6B] max-w-[120px] truncate">{r.mainSeller || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${RISK_STYLES[r.riskLevel]}`}>{r.riskLevel}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager pager={riskPager} />
          </div>
        </div>
      )}

      {/* ════════════════ DETALHE DAS NOTAS ════════════════ */}
      {panel === 'detalhe' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#E5E0D8] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold">Detalhe nota a nota — {selectedYear}</h3>
              <p className="text-[11px] text-[#8B7D6B]">
                Carregado sob demanda para não pesar a abertura do sistema. Cada linha é uma nota quebrada por CFOP / conta gerencial.
              </p>
            </div>
            <button
              onClick={handleLoadDetail}
              disabled={loadingDetail}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] disabled:opacity-40 whitespace-nowrap"
            >
              {loadingDetail ? 'Carregando...' : detailLoaded === selectedYear ? 'Recarregar detalhe' : `Carregar detalhe de ${selectedYear}`}
            </button>
          </div>

          {detailLoaded === selectedYear && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B7D6B]" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Buscar por cliente, nº da nota, código ou vendedor..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[#D8D2C7] text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40"
                />
              </div>

              <div className="bg-white rounded-xl border border-[#E5E0D8] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F7F5F1] text-[#8B7D6B]">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Emissão</th>
                        <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Nota</th>
                        <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Cliente</th>
                        <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Vendedor</th>
                        <th className="px-3 py-2 text-left font-bold uppercase text-[10px] tracking-wider">Tipo doc.</th>
                        <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">CFOP</th>
                        <th className="px-3 py-2 text-right font-bold uppercase text-[10px] tracking-wider">Valor</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0EDE7]">
                      {detailPager.items.map((d) => (
                        <tr key={d.dedupeKey} className={`hover:bg-[#FBFAF8] ${d.cancelDate ? 'opacity-50 line-through' : ''}`}>
                          <td className="px-3 py-2 tabular-nums">{d.issueDate.split('-').reverse().join('/')}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">{d.invoiceNumber}<span className="text-[#8B7D6B]">/{d.invoiceSeries}</span></td>
                          <td className="px-3 py-2 max-w-[200px] truncate" title={d.personName}>{d.personName}</td>
                          <td className="px-3 py-2 text-[#8B7D6B]">{d.sellerName}</td>
                          <td className="px-3 py-2 text-[#8B7D6B] max-w-[140px] truncate">{d.documentTypeDescription}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px]">{d.cfop}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold">{formatCurrency(d.totalValue)}</td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => setDetailInvoice(d)} className="text-[#C19A6B] hover:text-[#A9835A] font-bold text-[11px]">Ver</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager pager={detailPager} />
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal: todos os campos da nota */}
      {detailInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetailInvoice(null)}>
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-5 py-4 border-b border-[#E5E0D8] flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#C19A6B]">
                  Nota {detailInvoice.invoiceNumber}/{detailInvoice.invoiceSeries} · {detailInvoice.documentTypeDescription}
                </p>
                <h3 className="text-base font-extrabold">{detailInvoice.personName}</h3>
                <p className="text-xs text-[#8B7D6B]">{formatCurrency(detailInvoice.totalValue)} · emitida em {detailInvoice.issueDate.split('-').reverse().join('/')}</p>
              </div>
              <button onClick={() => setDetailInvoice(null)}><X className="w-5 h-5" /></button>
            </div>
            {detailInvoice.cancelDate && (
              <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-800 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Nota cancelada em {detailInvoice.cancelDate.split('-').reverse().join('/')}{detailInvoice.cancelUserName && ` por ${detailInvoice.cancelUserName}`}. {detailInvoice.cancelNotes}</span>
              </div>
            )}
            <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-x-5 gap-y-3 text-xs">
              {([
                ['Empresa', `${detailInvoice.companyCode} — ${detailInvoice.companyName}`],
                ['Cód. da nota', detailInvoice.invoiceCode],
                ['Sequência', String(detailInvoice.seqOrder)],
                ['Cód. do cliente', detailInvoice.personCode],
                ['CPF/CNPJ', detailInvoice.personDocument],
                ['RG / IE', detailInvoice.personDocRgIe],
                ['Endereço', [detailInvoice.addressStreetType, detailInvoice.addressStreet, detailInvoice.addressNumber].filter(Boolean).join(' ')],
                ['Município / UF', `${detailInvoice.addressCity} / ${detailInvoice.addressState}`],
                ['Natureza da operação', `${detailInvoice.operationCode} — ${detailInvoice.operationDescription}`],
                ['Departamento', `${detailInvoice.departmentDescription} (${detailInvoice.departmentAcronym})`],
                ['Condição de pagamento', detailInvoice.paymentTermDescription],
                ['Segmento de mercado', detailInvoice.marketSegmentDescription],
                ['Origem', detailInvoice.origin],
                ['Ordem de serviço', detailInvoice.serviceOrderCode || '—'],
                ['Funcionário', detailInvoice.employeeName],
                ['Vendedor', `${detailInvoice.sellerCode} — ${detailInvoice.sellerName}`],
                ['Status', detailInvoice.status],
                ['Movimento', detailInvoice.movement],
                ['Data movimento', detailInvoice.movementDate.split('-').reverse().join('/')],
                ['Data cadastro', detailInvoice.registerDateTime || '—'],
                ['CFOP', detailInvoice.cfop],
                ['Chave NF-e', detailInvoice.nfeKey || '—'],
                ['Conta gerencial', `${detailInvoice.managerialAccountCode} — ${detailInvoice.managerialAccountName}`],
                ['Identificador contábil', detailInvoice.managerialAccountIdent],
                ['ICMS', formatCurrency(detailInvoice.totalIcms)],
                ['ICMS ST', formatCurrency(detailInvoice.totalIcmsSt)],
                ['ISS', formatCurrency(detailInvoice.totalIss)],
                ['PIS', formatCurrency(detailInvoice.totalPis)],
                ['IPI', formatCurrency(detailInvoice.totalIpi)],
                ['COFINS', formatCurrency(detailInvoice.totalCofins)],
                ['CSLL', formatCurrency(detailInvoice.totalCsll)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-[#8B7D6B] font-bold">{label}</p>
                  <p className="font-semibold break-words">{value || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Componentes auxiliares ───────────────────────────────────────────────────

const Kpi: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'dark' | 'good' | 'bad' | 'warn';
  icon?: React.ReactNode;
}> = ({ label, value, hint, tone = 'default', icon }) => {
  const styles =
    tone === 'dark' ? 'bg-[#2D2A26] text-[#EAE6DF] border-[#2D2A26]'
    : tone === 'good' ? 'bg-emerald-50 border-emerald-200'
    : tone === 'bad' ? 'bg-red-50 border-red-200'
    : tone === 'warn' ? 'bg-amber-50 border-amber-200'
    : 'bg-white border-[#E5E0D8]';
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${tone === 'dark' ? 'text-[#C19A6B]' : 'text-[#8B7D6B]'}`}>{label}</p>
      <p className="text-lg font-extrabold mt-1.5 tabular-nums flex items-center gap-1">{icon}{value}</p>
      {hint && <p className={`text-[10px] mt-0.5 ${tone === 'dark' ? 'text-[#EAE6DF]/60' : 'text-[#8B7D6B]'}`}>{hint}</p>}
    </div>
  );
};

const RankPanel: React.FC<{ title: string; subtitle: string; rows: { name: string; value: number }[]; total: number }> = ({
  title, subtitle, rows, total,
}) => (
  <div className="bg-white rounded-xl border border-[#E5E0D8] p-4">
    <h3 className="text-sm font-extrabold">{title}</h3>
    <p className="text-[11px] text-[#8B7D6B] mb-3">{subtitle}</p>
    {rows.length === 0 ? (
      <p className="text-xs text-[#8B7D6B] py-4 text-center">Sem dados no período.</p>
    ) : (
      <div className="space-y-2">
        {rows.slice(0, 8).map((r) => (
          <div key={r.name}>
            <div className="flex justify-between text-[11px] font-semibold mb-0.5">
              <span className="truncate max-w-[60%]" title={r.name}>{r.name}</span>
              <span className="tabular-nums">
                {formatCurrency(r.value)}
                <span className="text-[#8B7D6B] ml-1.5">{formatPct(total ? (r.value / total) * 100 : 0)}</span>
              </span>
            </div>
            <div className="h-1.5 bg-[#F0EDE7] rounded-full overflow-hidden">
              <div className="h-full bg-[#C19A6B]" style={{ width: `${total ? (r.value / total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const Pager: React.FC<{ pager: ReturnType<typeof usePagination<any>> }> = ({ pager }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#E5E0D8] bg-[#FBFAF8] text-xs">
    <span className="text-[#8B7D6B] font-semibold">Mostrando {pager.from}–{pager.to} de {formatInt(pager.total)}</span>
    <div className="flex items-center gap-2">
      <select value={pager.pageSize} onChange={(e) => pager.setPageSize(Number(e.target.value))} className="px-2 py-1.5 rounded border border-[#D8D2C7] font-semibold bg-white">
        {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} por página</option>)}
      </select>
      <button onClick={pager.prev} disabled={!pager.canPrev} className="px-3 py-1.5 rounded border border-[#D8D2C7] font-bold disabled:opacity-40 bg-white hover:bg-[#F7F5F1]">Anterior</button>
      <span className="font-bold">{pager.page}/{pager.pageCount}</span>
      <button onClick={pager.next} disabled={!pager.canNext} className="px-3 py-1.5 rounded border border-[#D8D2C7] font-bold disabled:opacity-40 bg-white hover:bg-[#F7F5F1]">Próxima</button>
    </div>
  </div>
);
