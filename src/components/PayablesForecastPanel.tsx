/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PayablesForecastPanel — "Previsão de Pagamento" (RFN046 — Títulos em aberto)
 *
 * Responde a uma pergunta só, e responde direito: QUANTO EU VOU PAGAR ENTRE
 * TAL DIA E TAL DIA. O gestor escolhe o intervalo (atalhos de 7/15/30 dias ou
 * datas livres) e a tela devolve o total previsto, a quebra por semana do mês
 * — a mesma régua do Fluxo de Caixa, para os números conversarem — e a lista
 * dos títulos que compõem esse total.
 *
 * SEPARAÇÃO DE BASES (decisão de auditoria)
 * -----------------------------------------
 * Esta base NÃO se mistura com os títulos pagos (RFN006). Lá é dinheiro que
 * saiu; aqui é dinheiro que vai sair. Um título que aparecesse nas duas seria
 * contado duas vezes no fluxo de caixa do mês.
 */

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  Trash2,
  TrendingDown,
  UploadCloud,
  Search,
} from 'lucide-react';
import { PayableForecastTitle } from '../types';
import { exportReportToExcel, formatCurrency } from '../utils/exportUtils';
import { ForecastPreviewRow, RawForecastRow, looksLikeRfn046, parseRfn046Rows } from '../utils/rfn046Parser';
import {
  FORECAST_WEEKS,
  ForecastWeekKey,
  addDaysIso,
  forecastInRange,
  formatIsoBr,
  groupForecast,
  isOpenForecast,
  sumForecast,
  todayIso,
  weekOfMonthFromIso,
} from '../utils/payableForecast';

interface PayablesForecastPanelProps {
  forecasts: PayableForecastTitle[];
  selectedYear: number;
  onImportForecasts: (rows: RawForecastRow[]) => Promise<void> | void;
  onClearForecasts?: () => void | Promise<void>;
  userRole: string;
}

const WEEK_LABELS: Record<ForecastWeekKey, string> = {
  sem01: 'Semana 1 (dias 1–7)',
  sem02: 'Semana 2 (dias 8–14)',
  sem03: 'Semana 3 (dias 15–21)',
  sem04: 'Semana 4 (dias 22–28)',
  sem05: 'Semana 5 (dias 29–31)',
};

const MONTH_LABELS: Record<string, string> = {
  jan: 'Janeiro', fev: 'Fevereiro', mar: 'Março', abr: 'Abril', mai: 'Maio', jun: 'Junho',
  jul: 'Julho', ago: 'Agosto', set: 'Setembro', out: 'Outubro', nov: 'Novembro', dez: 'Dezembro',
};

type GroupMode = 'vencimento' | 'credor' | 'departamento' | 'empresa' | 'tipo';

const GROUP_LABELS: Record<GroupMode, string> = {
  vencimento: 'Data de vencimento',
  credor: 'Credor',
  departamento: 'Departamento',
  empresa: 'Empresa',
  tipo: 'Tipo de título',
};

export const PayablesForecastPanel: React.FC<PayablesForecastPanelProps> = ({
  forecasts,
  selectedYear,
  onImportForecasts,
  onClearForecasts,
  userRole,
}) => {
  const canEdit = userRole !== 'analista';
  const hoje = todayIso();

  // ── Intervalo consultado ──────────────────────────────────────────────────
  // Começa em "próximos 30 dias a partir de hoje", que é a pergunta que o
  // gestor faz na segunda-feira de manhã.
  const [startDate, setStartDate] = useState<string>(hoje);
  const [endDate, setEndDate] = useState<string>(addDaysIso(hoje, 30));
  const [includeOverdue, setIncludeOverdue] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('vencimento');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // ── Importação ────────────────────────────────────────────────────────────
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewRows, setPreviewRows] = useState<ForecastPreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  useEffect(() => { setCurrentPage(1); }, [startDate, endDate, includeOverdue, searchQuery]);

  const openTitles = useMemo(() => forecasts.filter(isOpenForecast), [forecasts]);

  // Vencidos: em aberto com vencimento anterior a hoje. Entram no intervalo por
  // padrão porque quem está atrasado continua sendo saída de caixa — e some do
  // total se o gestor desmarcar, para enxergar só o que ainda está no prazo.
  const overdue = useMemo(() => openTitles.filter((t) => t.dueDate < hoje), [openTitles, hoje]);

  const rangeTitles = useMemo(() => {
    const inRange = forecastInRange(openTitles, startDate, endDate);
    if (!includeOverdue) return inRange;
    // Vencidos anteriores ao início do intervalo entram uma única vez (o filtro
    // acima já pegou os que caem dentro dele).
    const extra = overdue.filter((t) => t.dueDate < startDate);
    return [...extra, ...inRange];
  }, [openTitles, overdue, startDate, endDate, includeOverdue]);

  const filteredTitles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rangeTitles;
    return rangeTitles.filter(
      (t) =>
        t.supplierName.toLowerCase().includes(q) ||
        t.supplierCode.toLowerCase().includes(q) ||
        (t.titleNumber || '').toLowerCase().includes(q) ||
        (t.parcela || '').toLowerCase().includes(q) ||
        (t.department || '').toLowerCase().includes(q) ||
        (t.titleType || '').toLowerCase().includes(q)
    );
  }, [rangeTitles, searchQuery]);

  const sortedTitles = useMemo(
    () => [...filteredTitles].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.balance - a.balance)),
    [filteredTitles]
  );

  const paginated = useMemo(
    () => sortedTitles.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [sortedTitles, currentPage]
  );
  const totalPages = Math.ceil(sortedTitles.length / itemsPerPage);

  // ── Totais ────────────────────────────────────────────────────────────────
  const totalIntervalo = sumForecast(filteredTitles);
  const totalVencidoNoIntervalo = sumForecast(filteredTitles.filter((t) => t.dueDate < hoje));
  const totalAVencer = totalIntervalo - totalVencidoNoIntervalo;
  const totalBase = sumForecast(openTitles);
  const proximos7 = sumForecast(forecastInRange(openTitles, hoje, addDaysIso(hoje, 7)));

  // ── Quebra por semana (mesma régua do Fluxo de Caixa) ─────────────────────
  const byMonthWeek = useMemo(() => {
    const map = new Map<string, { year: number; monthKey: string; weeks: Record<ForecastWeekKey, number>; total: number }>();
    for (const t of filteredTitles) {
      const key = `${t.year}_${t.monthKey}`;
      if (!map.has(key)) {
        map.set(key, {
          year: t.year,
          monthKey: t.monthKey,
          weeks: { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 },
          total: 0,
        });
      }
      const row = map.get(key)!;
      row.weeks[weekOfMonthFromIso(t.dueDate)] += t.balance || 0;
      row.total += t.balance || 0;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.year !== b.year ? a.year - b.year : (a.monthKey < b.monthKey ? -1 : 1)
    );
  }, [filteredTitles]);

  const grouped = useMemo(() => {
    const keyOf = (t: PayableForecastTitle): string => {
      if (groupMode === 'vencimento') return t.dueDate;
      if (groupMode === 'credor') return `${t.supplierName} (${t.supplierCode})`;
      if (groupMode === 'departamento') return t.department || 'Sem departamento';
      if (groupMode === 'empresa') return t.companyName || 'Sem empresa';
      return t.titleType || 'Sem tipo';
    };
    const list = groupForecast(filteredTitles, keyOf);
    return groupMode === 'vencimento' ? [...list].sort((a, b) => (a.key < b.key ? -1 : 1)) : list;
  }, [filteredTitles, groupMode]);

  // ── Atalhos de intervalo ──────────────────────────────────────────────────
  const applyPreset = (days: number) => {
    setStartDate(hoje);
    setEndDate(addDaysIso(hoje, days));
  };
  const applyThisMonth = () => {
    const d = new Date();
    const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setStartDate(first);
    setEndDate(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`);
  };
  const applyNextMonth = () => {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 2, 0);
    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    setStartDate(fmt(first));
    setEndDate(fmt(last));
  };

  // ── Upload ────────────────────────────────────────────────────────────────
  const processFile = (file: File) => {
    setFileName(file.name);
    setIsProcessing(true);
    setImportMsg(null);
    setImportError(null);
    setPreviewRows([]);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      setImportError('Envie a planilha RFN046 em formato .xlsx ou .xls.');
      setIsProcessing(false);
      setFileName(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
        if (!looksLikeRfn046(jsonRows)) {
          setImportError(
            'Esta planilha não parece ser o RFN046: faltam as colunas Titulo_Codigo, Titulo_DataVencimento e Titulo_Saldo. ' +
              'O relatório de títulos PAGOS (RFN006) deve ser enviado na aba "Títulos Pagos".'
          );
          setPreviewRows([]);
          return;
        }
        setPreviewRows(parseRfn046Rows(jsonRows));
      } catch (err: any) {
        setImportError(`Erro ao processar a planilha: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
      setImportError('Erro ao ler o arquivo.');
      setIsProcessing(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const validCount = previewRows.filter((r) => r.valid).length;
  const invalidCount = previewRows.length - validCount;
  const previewTotal = previewRows.filter((r) => r.valid).reduce((a, r) => a + r.balance, 0);
  const filteredPreview = previewRows.filter((r) =>
    previewFilter === 'valid' ? r.valid : previewFilter === 'invalid' ? !r.valid : true
  );

  const handleCommit = async () => {
    const rows = previewRows.filter((r) => r.valid);
    if (rows.length === 0) {
      setImportError('Nenhum título válido para importar.');
      return;
    }
    setIsImporting(true);
    setImportError(null);
    try {
      await onImportForecasts(rows);
      setImportMsg(`${rows.length} título(s) a vencer importado(s), totalizando ${formatCurrency(previewTotal)} de saldo previsto.`);
      setPreviewRows([]);
      setFileName(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Falha ao importar a previsão. Tente novamente.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = () => {
    const data = sortedTitles.map((t) => ({
      'Título': t.titleCode,
      'Número': t.titleNumber || '',
      Parcela: t.parcela || '',
      Credor: t.supplierName,
      'Cód. Credor': t.supplierCode,
      Empresa: t.companyName || '',
      Tipo: t.titleType || '',
      Departamento: t.department || '',
      Emissão: t.issueDate || '',
      Vencimento: t.dueDate,
      'Semana do mês': WEEK_LABELS[weekOfMonthFromIso(t.dueDate)],
      'Valor do título': t.amount,
      'Saldo previsto a pagar': t.balance,
      Situação: t.dueDate < hoje ? 'VENCIDO' : 'A vencer',
      Status: t.status || '',
      Observação: t.observation || '',
    }));
    exportReportToExcel(
      data,
      `PREVISAO_PAGAMENTO_${startDate}_a_${endDate}`,
      `Previsao_Pagamento_${startDate}_a_${endDate}.xlsx`
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              PREVISÃO DE PAGAMENTO
            </span>
            <span className="text-xs text-[#8B7D6B]">• RFN046 — Títulos em aberto</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Quanto vou pagar no intervalo</h2>
          <p className="text-xs text-[#8B7D6B]">
            Base de títulos <b>ainda não pagos</b>, separada dos títulos pagos (RFN006). O valor considerado é o{' '}
            <b>saldo</b> de cada título na sua <b>data de vencimento</b>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExport}
            disabled={sortedTitles.length === 0}
            className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-2 border border-[#EAE6DF] disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-[#8B7D6B]" />
            <span>Exportar Excel</span>
          </button>
          {canEdit && onClearForecasts && openTitles.length > 0 && (
            <button
              onClick={() => setIsClearConfirmOpen(true)}
              className="px-3.5 py-2.5 text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>Zerar Previsão</span>
            </button>
          )}
        </div>
      </div>

      {/* Seletor de intervalo */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-[#C19A6B]" />
          <h3 className="text-sm font-bold text-[#2D2A26]">Intervalo consultado</h3>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-[#8B7D6B] uppercase mb-1">De</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-mono text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-[#8B7D6B] uppercase mb-1">Até</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-mono text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[7, 15, 30, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => applyPreset(d)}
                className="px-2.5 py-2 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF]"
              >
                {d} dias
              </button>
            ))}
            <button onClick={applyThisMonth} className="px-2.5 py-2 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF]">
              Este mês
            </button>
            <button onClick={applyNextMonth} className="px-2.5 py-2 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF]">
              Próximo mês
            </button>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold text-[#433E37] cursor-pointer select-none ml-auto">
            <input
              type="checkbox"
              checked={includeOverdue}
              onChange={(e) => setIncludeOverdue(e.target.checked)}
              className="accent-[#C19A6B] w-4 h-4"
            />
            Incluir títulos já vencidos e não pagos
          </label>
        </div>
        <p className="text-[10px] text-[#8B7D6B]">
          Consultando vencimentos de <b>{formatIsoBr(startDate)}</b> a <b>{formatIsoBr(endDate)}</b>
          {includeOverdue && overdue.length > 0 && (
            <> + {overdue.filter((t) => t.dueDate < startDate).length} título(s) vencido(s) antes do início do intervalo</>
          )}.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#2D2A26] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#C19A6B] uppercase tracking-wider flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5" /> Previsto no intervalo
          </span>
          <p className="text-xl font-black text-white mt-1">{formatCurrency(totalIntervalo)}</p>
          <span className="text-[10px] text-[#EAE6DF]/70">{filteredTitles.length} título(s)</span>
        </div>
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Vencido e não pago
          </span>
          <p className="text-lg font-black text-rose-800 mt-1">{formatCurrency(totalVencidoNoIntervalo)}</p>
          <span className="text-[10px] text-rose-700">{filteredTitles.filter((t) => t.dueDate < hoje).length} título(s) em atraso</span>
        </div>
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
            <CalendarClock className="w-3.5 h-3.5" /> A vencer no intervalo
          </span>
          <p className="text-lg font-black text-amber-800 mt-1">{formatCurrency(totalAVencer)}</p>
          <span className="text-[10px] text-amber-700">Próximos 7 dias: {formatCurrency(proximos7)}</span>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-[#C19A6B]" /> Base completa em aberto
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(totalBase)}</p>
          <span className="text-[10px] text-[#8B7D6B]">{openTitles.length} título(s) sem baixa</span>
        </div>
      </div>

      {/* Quebra por semana do mês */}
      {byMonthWeek.length > 0 && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-[#C19A6B]" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Previsão por Semana do Mês</h3>
            <span className="text-[10px] text-[#8B7D6B]">
              — mesma divisão de semanas do Fluxo de Caixa (1–7, 8–14, 15–21, 22–28, 29–31)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                <tr>
                  <th className="p-2 text-left">Mês</th>
                  {FORECAST_WEEKS.map((w) => (
                    <th key={w} className="p-2 text-right">{WEEK_LABELS[w].split(' (')[0]}</th>
                  ))}
                  <th className="p-2 text-right border-l border-[#EAE6DF]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {byMonthWeek.map((row) => (
                  <tr key={`${row.year}_${row.monthKey}`} className="hover:bg-[#FDFBF7]">
                    <td className="p-2 font-semibold text-[#433E37]">
                      {MONTH_LABELS[row.monthKey] || row.monthKey}/{row.year}
                    </td>
                    {FORECAST_WEEKS.map((w) => (
                      <td key={w} className="p-2 text-right font-mono text-[#433E37]">
                        {row.weeks[w] ? formatCurrency(row.weeks[w]) : '—'}
                      </td>
                    ))}
                    <td className="p-2 text-right font-mono font-bold text-rose-700 border-l border-[#EAE6DF]">
                      {formatCurrency(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#EAE6DF] text-[10px] text-[#8B7D6B]">
            Estes são os mesmos números que alimentam a coluna <b>AUTOM.</b> de desembolsos do Fluxo de Caixa nas semanas futuras.
          </div>
        </div>
      )}

      {/* Agrupamento */}
      {grouped.length > 0 && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#C19A6B]" /> Composição do valor previsto
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(GROUP_LABELS) as GroupMode[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupMode(g)}
                  className={`px-2.5 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${
                    groupMode === g
                      ? 'bg-[#2D2A26] text-white border-[#2D2A26]'
                      : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF] hover:bg-[#EAE6DF]'
                  }`}
                >
                  {GROUP_LABELS[g]}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold sticky top-0">
                <tr>
                  <th className="p-2 text-left">{GROUP_LABELS[groupMode]}</th>
                  <th className="p-2 text-center">Títulos</th>
                  <th className="p-2 text-right">Valor previsto</th>
                  <th className="p-2 text-right">% do total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {grouped.map((g) => (
                  <tr key={g.key} className="hover:bg-[#FDFBF7]">
                    <td className="p-2 font-semibold text-[#433E37] max-w-md truncate" title={g.key}>
                      {groupMode === 'vencimento' ? formatIsoBr(g.key) : g.key}
                    </td>
                    <td className="p-2 text-center font-mono text-[#8B7D6B]">{g.count}</td>
                    <td className="p-2 text-right font-mono font-bold text-[#2D2A26]">{formatCurrency(g.total)}</td>
                    <td className="p-2 text-right font-mono text-[#8B7D6B]">
                      {totalIntervalo > 0 ? ((g.total / totalIntervalo) * 100).toFixed(1) : '0,0'}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lista de títulos */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-[#EAE6DF] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#C19A6B]" />
            Títulos a pagar no intervalo ({sortedTitles.length})
          </h3>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar credor, título, parcela, departamento..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:border-[#C19A6B]"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
              <tr>
                <th className="p-3 whitespace-nowrap">Vencimento</th>
                <th className="p-3 whitespace-nowrap">Credor</th>
                <th className="p-3 whitespace-nowrap">Título / Parcela</th>
                <th className="p-3 whitespace-nowrap">Tipo</th>
                <th className="p-3 whitespace-nowrap">Departamento</th>
                <th className="p-3 text-right whitespace-nowrap">Saldo previsto</th>
                <th className="p-3 text-center whitespace-nowrap">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {paginated.map((t) => {
                const atrasado = t.dueDate < hoje;
                return (
                  <tr key={t.id} className={`hover:bg-[#FDFBF7] transition-colors ${atrasado ? 'bg-rose-50/40' : ''}`}>
                    <td className="p-3 font-mono whitespace-nowrap">{formatIsoBr(t.dueDate)}</td>
                    <td className="p-3 max-w-xs truncate" title={t.supplierName}>
                      <span className="truncate">{t.supplierName}</span>
                      <p className="text-[10px] text-[#8B7D6B] font-mono">cód: {t.supplierCode}</p>
                    </td>
                    <td className="p-3 font-mono whitespace-nowrap">
                      {t.titleNumber || t.titleCode}
                      {t.parcela ? ` / ${t.parcela}` : ''}
                    </td>
                    <td className="p-3 whitespace-nowrap">{t.titleType || '—'}</td>
                    <td className="p-3 whitespace-nowrap">{t.department || '—'}</td>
                    <td className="p-3 text-right font-mono font-bold text-[#2D2A26] whitespace-nowrap">{formatCurrency(t.balance)}</td>
                    <td className="p-3 text-center whitespace-nowrap">
                      {atrasado ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">VENCIDO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">A vencer</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedTitles.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-[#8B7D6B]">
                    {openTitles.length === 0
                      ? 'Nenhum título a vencer importado ainda. Envie a planilha RFN046 abaixo.'
                      : 'Nenhum título vence dentro do intervalo selecionado.'}
                  </td>
                </tr>
              )}
            </tbody>
            {sortedTitles.length > 0 && (
              <tfoot>
                <tr className="bg-[#2D2A26] text-[#EAE6DF] font-black">
                  <td colSpan={5} className="p-3 text-right">TOTAL PREVISTO NO INTERVALO</td>
                  <td className="p-3 text-right font-mono text-[#C19A6B]">{formatCurrency(totalIntervalo)}</td>
                  <td className="p-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {totalPages > 1 && (
          <div className="p-4 border-t border-[#EAE6DF] flex items-center justify-between gap-3 bg-[#F9F7F2]">
            <span className="text-xs font-semibold text-[#8B7D6B]">
              Página {currentPage} de {totalPages}
            </span>
            <div className="flex items-center space-x-1.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED] disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED] disabled:opacity-50"
              >
                Próximo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Importação do RFN046 */}
      {canEdit && (
        <div className="space-y-4">
          {importMsg && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <p className="text-xs font-bold">{importMsg}</p>
            </div>
          )}
          {importError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-bold">{importError}</p>
            </div>
          )}

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-[#EAE6DF] bg-white hover:border-[#C19A6B] rounded-xl p-8 text-center transition-all"
          >
            <div className="max-w-md mx-auto space-y-3">
              <div className="w-12 h-12 rounded-xl bg-[#C19A6B]/15 text-[#C19A6B] flex items-center justify-center mx-auto border border-[#C19A6B]/30">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#2D2A26]">Arraste a planilha RFN046 (Títulos em aberto) aqui</p>
                <p className="text-xs text-[#8B7D6B] mt-0.5">
                  Formatos aceitos: .xlsx, .xls — reimportar atualiza os saldos sem duplicar títulos
                </p>
              </div>
              <div>
                <label className="px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg cursor-pointer shadow-xs inline-block transition-all">
                  <span>Selecionar Arquivo do Computador</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => e.target.files && e.target.files[0] && processFile(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
              {fileName && (
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#F3F1ED] text-xs text-[#C19A6B] font-mono border border-[#EAE6DF]">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{fileName}</span>
                </div>
              )}
              {isProcessing && <p className="text-xs text-[#8B7D6B] animate-pulse">Processando arquivo...</p>}
            </div>
          </div>

          {previewRows.length > 0 && (
            <div className="bg-white border border-[#EAE6DF] rounded-xl p-6 shadow-xs space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-[#EAE6DF]">
                <div className="bg-[#F9F7F2] rounded-lg p-3 border border-[#EAE6DF]">
                  <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Linhas do arquivo</p>
                  <p className="text-lg font-black text-[#2D2A26]">{previewRows.length}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase">Válidos</p>
                  <p className="text-lg font-black text-emerald-800">{validCount}</p>
                </div>
                <div className="bg-rose-50 rounded-lg p-3 border border-rose-200">
                  <p className="text-[10px] font-bold text-rose-700 uppercase">Descartados</p>
                  <p className="text-lg font-black text-rose-800">{invalidCount}</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <p className="text-[10px] font-bold text-amber-700 uppercase">Saldo previsto (válidos)</p>
                  <p className="text-sm font-black text-amber-800">{formatCurrency(previewTotal)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#C19A6B]" /> Validação dos títulos a vencer
                </h3>
                <div className="flex items-center space-x-2">
                  {(['all', 'valid', 'invalid'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setPreviewFilter(f)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                        previewFilter === f
                          ? f === 'valid'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : f === 'invalid'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-[#2D2A26] text-white border-[#2D2A26]'
                          : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF]'
                      }`}
                    >
                      {f === 'all' ? `Todos (${previewRows.length})` : f === 'valid' ? `Válidos (${validCount})` : `Descartados (${invalidCount})`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 border border-[#EAE6DF] rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#F9F7F2] text-[#8B7D6B] sticky top-0">
                    <tr className="border-b border-[#EAE6DF] font-bold">
                      <th className="p-2.5 w-10 text-center">#</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Título</th>
                      <th className="p-2.5">Credor</th>
                      <th className="p-2.5">Vencimento</th>
                      <th className="p-2.5 text-right">Saldo</th>
                      <th className="p-2.5">Motivo do descarte</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
                    {filteredPreview.slice(0, 300).map((row) => (
                      <tr key={row.rowNumber} className={`hover:bg-[#FDFBF7] ${!row.valid ? 'bg-rose-50/40' : ''}`}>
                        <td className="p-2.5 text-center text-[#8B7D6B] font-mono">{row.rowNumber}</td>
                        <td className="p-2.5">
                          {row.valid ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">VÁLIDO</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">DESCARTADO</span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono">{row.titleNumber || row.titleCode || '-'}</td>
                        <td className="p-2.5 max-w-xs truncate" title={row.supplierName}>{row.supplierName || '-'}</td>
                        <td className="p-2.5 font-mono">{row.dueDate ? formatIsoBr(row.dueDate) : '-'}</td>
                        <td className="p-2.5 text-right font-mono">{row.balance > 0 ? formatCurrency(row.balance) : '-'}</td>
                        <td className="p-2.5 text-rose-700 text-[11px]">{row.errors.length > 0 ? row.errors.join(' | ') : '✓'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-[#8B7D6B]">
                  <span>Serão importados </span>
                  <strong className="text-emerald-700 font-bold">{validCount} título(s)</strong>
                  <span> totalizando </span>
                  <strong className="text-emerald-700">{formatCurrency(previewTotal)}</strong>
                  <span> de saldo previsto</span>
                </div>
                <button
                  onClick={handleCommit}
                  disabled={validCount === 0 || isImporting}
                  className="px-6 py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isImporting ? (
                    <svg className="animate-spin w-4 h-4 text-[#C19A6B]" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                    </svg>
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#C19A6B]" />
                  )}
                  <span>{isImporting ? 'Importando...' : `Confirmar e Importar (${validCount})`}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmação de limpeza */}
      {isClearConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <Trash2 className="w-6 h-6" />
            </div>
            <h4 className="text-base font-black text-[#2D2A26]">Zerar a base de previsão?</h4>
            <p className="text-xs text-[#8B7D6B]">
              Os {openTitles.length} título(s) a vencer serão apagados. Os títulos já pagos (RFN006) não são afetados.
              A previsão volta quando você reimportar o RFN046.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setIsClearConfirmOpen(false)}
                className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setIsClearConfirmOpen(false);
                  if (onClearForecasts) await onClearForecasts();
                }}
                className="px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-700"
              >
                Zerar Previsão
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-[#8B7D6B] text-center">
        Exercício selecionado: {selectedYear}. A previsão é consultada por data de vencimento e ignora o filtro de ano —
        um vencimento de janeiro precisa aparecer quando se planeja dezembro.
      </p>
    </div>
  );
};
