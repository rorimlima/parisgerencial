/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CashFlowView — "Fluxo de Caixa" (Planejamento Semanal Previsto x Realizado)
 *
 * Modelo inspirado na planilha operacional da Paris Dakar: cada mês é dividido
 * em Semanas 01–05, com as linhas Recebimentos, Desembolsos, Geração de Caixa,
 * Aportes e Saldo de Caixa. Para cada semana há duas colunas: PREVISTO
 * (planejamento manual do gestor) e REALIZADO (calculado automaticamente a
 * partir do Extrato Financeiro — entradas = recebimentos, saídas = desembolsos —
 * agrupado por semana). O saldo de caixa é encadeado semana a semana.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Download,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { CashFlowPendencia, CashFlowPlan, CashFlowWeekKey, FinancialStatementEntry } from '../types';
import {
  exportCashFlowPdfGeral,
  exportCashFlowPdfMensal,
  exportReportToExcel,
  formatCurrency,
} from '../utils/exportUtils';
import { PdfExportMenu } from './PdfExportMenu';

interface CashFlowViewProps {
  plans: CashFlowPlan[];
  statementEntries: FinancialStatementEntry[];
  selectedYear: number;
  onSavePlan: (plan: CashFlowPlan) => Promise<void> | void;
  userRole: string;
}

const MONTHS: { key: string; label: string }[] = [
  { key: 'jan', label: 'Janeiro' }, { key: 'fev', label: 'Fevereiro' }, { key: 'mar', label: 'Março' },
  { key: 'abr', label: 'Abril' }, { key: 'mai', label: 'Maio' }, { key: 'jun', label: 'Junho' },
  { key: 'jul', label: 'Julho' }, { key: 'ago', label: 'Agosto' }, { key: 'set', label: 'Setembro' },
  { key: 'out', label: 'Outubro' }, { key: 'nov', label: 'Novembro' }, { key: 'dez', label: 'Dezembro' },
];

const WEEKS: CashFlowWeekKey[] = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];
const WEEK_LABELS: Record<CashFlowWeekKey, string> = {
  sem01: 'Semana 1', sem02: 'Semana 2', sem03: 'Semana 3', sem04: 'Semana 4', sem05: 'Semana 5',
};

// Mapeia uma data (YYYY-MM-DD) para a semana do mês (0..4 → sem01..sem05).
// Dias 1–7 → S1, 8–14 → S2, 15–21 → S3, 22–28 → S4, 29–31 → S5.
const weekOfMonth = (iso: string): CashFlowWeekKey => {
  const day = parseInt((iso || '').slice(8, 10), 10);
  if (isNaN(day)) return 'sem01';
  const idx = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
  return WEEKS[idx];
};

// Classifica um recebimento por tipo, a partir do documento/descrição do extrato.
const categorizeReceipt = (e: FinancialStatementEntry): string => {
  const t = `${e.documentType || ''} ${e.description || ''}`.toLowerCase();
  if (t.includes('pix')) return 'PIX';
  if (t.includes('boleto')) return 'BOLETO';
  if (t.includes('cart') || t.includes('cred') || t.includes('deb')) return 'CARTÃO';
  if (t.includes('cheque')) return 'CHEQUE';
  if (t.includes('dinheiro') || t.includes('espéc') || t.includes('espec') || t.includes('caixa')) return 'ESPÉCIE';
  if (t.includes('ordem') || t.includes(' os ') || t.startsWith('os')) return 'OS';
  if (t.includes('ted') || t.includes('doc') || t.includes('transf')) return 'TRANSFERÊNCIA';
  return 'OUTROS';
};

const emptyWeekPlan = () => ({ recebimentos: 0, desembolsos: 0, aportes: 0 });
const emptyPlan = (year: number, monthKey: string): CashFlowPlan => ({
  id: `${year}_${monthKey}`,
  year,
  monthKey,
  saldoInicial: 0,
  useSaldoAutomatico: false,
  weeks: {
    sem01: emptyWeekPlan(), sem02: emptyWeekPlan(), sem03: emptyWeekPlan(),
    sem04: emptyWeekPlan(), sem05: emptyWeekPlan(),
  },
  pendencias: [],
});

const sumWeeks = (fn: (w: CashFlowWeekKey) => number): number =>
  WEEKS.reduce((acc, w) => acc + fn(w), 0);

export const CashFlowView: React.FC<CashFlowViewProps> = ({
  plans,
  statementEntries,
  selectedYear,
  onSavePlan,
  userRole,
}) => {
  const now = new Date();
  const defaultMonth = MONTHS[Math.min(11, now.getMonth())].key;
  const [monthKey, setMonthKey] = useState<string>(defaultMonth);
  const [draft, setDraft] = useState<CashFlowPlan>(emptyPlan(selectedYear, defaultMonth));
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canEdit = userRole !== 'analista';

  const planForMonth = useMemo(
    () => plans.find((p) => p.monthKey === monthKey && p.year === selectedYear),
    [plans, monthKey, selectedYear]
  );

  // Sincroniza o rascunho editável com o plano salvo quando muda o mês/ano.
  useEffect(() => {
    setDraft(planForMonth ? { ...planForMonth, weeks: { ...planForMonth.weeks } } : emptyPlan(selectedYear, monthKey));
    setSavedMsg(null);
    setSaveError(null);
  }, [planForMonth, monthKey, selectedYear]);

  // ── REALIZADO: agregação a partir do Extrato Financeiro ──────────────────
  const realized = useMemo(() => {
    const weeks: Record<CashFlowWeekKey, { receb: number; desemb: number }> = {
      sem01: { receb: 0, desemb: 0 }, sem02: { receb: 0, desemb: 0 }, sem03: { receb: 0, desemb: 0 },
      sem04: { receb: 0, desemb: 0 }, sem05: { receb: 0, desemb: 0 },
    };
    const recebByType: Record<string, Record<CashFlowWeekKey, number>> = {};
    const desembBySource: Record<string, Record<CashFlowWeekKey, number>> = {};

    for (const e of statementEntries) {
      if (e.year !== selectedYear || e.monthKey !== monthKey) continue;
      const wk = weekOfMonth(e.date);
      if (e.entryAmount > 0) {
        weeks[wk].receb += e.entryAmount;
        const cat = categorizeReceipt(e);
        if (!recebByType[cat]) recebByType[cat] = { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 };
        recebByType[cat][wk] += e.entryAmount;
      }
      if (e.exitAmount > 0) {
        weeks[wk].desemb += e.exitAmount;
        const src = e.sourceLabel || 'Outros';
        if (!desembBySource[src]) desembBySource[src] = { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 };
        desembBySource[src][wk] += e.exitAmount;
      }
    }
    return { weeks, recebByType, desembBySource };
  }, [statementEntries, selectedYear, monthKey]);

  // ── Cálculo das linhas (previsto e realizado) ────────────────────────────
  const rows = useMemo(() => {
    const prevReceb = (w: CashFlowWeekKey) => draft.weeks[w]?.recebimentos || 0;
    const prevDesemb = (w: CashFlowWeekKey) => draft.weeks[w]?.desembolsos || 0; // já negativo
    const aporte = (w: CashFlowWeekKey) => draft.weeks[w]?.aportes || 0;
    // Realizado: manual (histórico importado) quando `realizadoManual`, senão vem do Extrato.
    const realReceb = (w: CashFlowWeekKey) =>
      draft.realizadoManual ? (draft.weeks[w]?.recebRealizado || 0) : realized.weeks[w].receb;
    const realDesemb = (w: CashFlowWeekKey) =>
      draft.realizadoManual ? (draft.weeks[w]?.desembRealizado || 0) : -realized.weeks[w].desemb; // saída como negativo

    const prevGer = (w: CashFlowWeekKey) => prevReceb(w) + prevDesemb(w);
    const realGer = (w: CashFlowWeekKey) => realReceb(w) + realDesemb(w);

    // Saldo encadeado
    const prevSaldo: Record<CashFlowWeekKey, number> = {} as any;
    const realSaldo: Record<CashFlowWeekKey, number> = {} as any;
    let accPrev = draft.saldoInicial || 0;
    let accReal = draft.saldoInicial || 0;
    for (const w of WEEKS) {
      accPrev = accPrev + prevGer(w) + aporte(w);
      accReal = accReal + realGer(w) + aporte(w);
      prevSaldo[w] = accPrev;
      realSaldo[w] = accReal;
    }

    return { prevReceb, prevDesemb, aporte, realReceb, realDesemb, prevGer, realGer, prevSaldo, realSaldo };
  }, [draft, realized]);

  // Saldo final realizado do mês anterior (para herança automática)
  const previousMonthFinalSaldo = useMemo(() => {
    const idx = MONTHS.findIndex((m) => m.key === monthKey);
    if (idx <= 0) return null;
    const prevKey = MONTHS[idx - 1].key;
    const prevPlan = plans.find((p) => p.monthKey === prevKey && p.year === selectedYear);
    let acc = prevPlan?.saldoInicial || 0;
    for (const e of statementEntries) {
      if (e.year !== selectedYear || e.monthKey !== prevKey) continue;
      acc += (e.entryAmount || 0) - (e.exitAmount || 0);
    }
    if (prevPlan) acc += sumWeeks((w) => prevPlan.weeks[w]?.aportes || 0);
    return acc;
  }, [plans, statementEntries, monthKey, selectedYear]);

  // ── Edição de células ────────────────────────────────────────────────────
  // Aceita tanto formato pt-BR ("7.016,87") quanto plano ("7016.87" / "7016").
  const parseInput = (v: string): number => {
    if (!v) return 0;
    let s = v.toString().trim().replace(/[^0-9.,\-]/g, '');
    if (s.includes(',')) {
      // pt-BR: ponto = milhar, vírgula = decimal
      s = s.replace(/\./g, '').replace(',', '.');
    }
    // sem vírgula: ponto é tratado como decimal (formato plano)
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };
  const setWeekValue = (
    w: CashFlowWeekKey,
    field: 'recebimentos' | 'desembolsos' | 'aportes' | 'recebRealizado' | 'desembRealizado',
    raw: string
  ) => {
    setDraft((d) => ({
      ...d,
      weeks: { ...d.weeks, [w]: { ...d.weeks[w], [field]: parseInput(raw) } },
    }));
  };

  // ── Pendências (obrigações em aberto) ────────────────────────────────────
  const pendencias = draft.pendencias || [];
  const totalPendencias = pendencias.reduce((a, p) => a + (Number(p.valor) || 0), 0);
  const setPendencia = (idx: number, field: keyof CashFlowPendencia, raw: string) => {
    setDraft((d) => {
      const list = [...(d.pendencias || [])];
      list[idx] = { ...list[idx], [field]: field === 'valor' ? parseInput(raw) : raw };
      return { ...d, pendencias: list };
    });
  };
  const addPendencia = () => setDraft((d) => ({ ...d, pendencias: [...(d.pendencias || []), { descricao: '', valor: 0 }] }));
  const removePendencia = (idx: number) => setDraft((d) => ({ ...d, pendencias: (d.pendencias || []).filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!canEdit) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedMsg(null);
    try {
      await onSavePlan({ ...draft, id: `${selectedYear}_${monthKey}`, year: selectedYear, monthKey });
      setSavedMsg('Planejamento salvo com sucesso.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Falha ao salvar. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const inheritSaldo = () => {
    if (previousMonthFinalSaldo == null) return;
    setDraft((d) => ({ ...d, saldoInicial: previousMonthFinalSaldo, useSaldoAutomatico: true }));
  };

  // ── Totais do mês ────────────────────────────────────────────────────────
  const totalPrevReceb = sumWeeks(rows.prevReceb);
  const totalPrevDesemb = sumWeeks(rows.prevDesemb);
  const totalRealReceb = sumWeeks(rows.realReceb);
  const totalRealDesemb = sumWeeks(rows.realDesemb);
  const totalAporte = sumWeeks(rows.aporte);
  const saldoFinalReal = rows.realSaldo.sem05;
  const saldoFinalPrev = rows.prevSaldo.sem05;
  const acuracia = totalPrevReceb > 0 ? (totalRealReceb / totalPrevReceb) * 100 : 0;

  const monthLabel = MONTHS.find((m) => m.key === monthKey)?.label || monthKey;

  // ── Exportação ───────────────────────────────────────────────────────────
  const handleExport = () => {
    const data: any[] = [];
    const pushRow = (linha: string, get: (w: CashFlowWeekKey) => number) => {
      const row: any = { Linha: linha };
      WEEKS.forEach((w) => { row[WEEK_LABELS[w]] = get(w); });
      row['Total'] = sumWeeks(get);
      data.push(row);
    };
    data.push({ Linha: `SALDO INICIAL`, 'Semana 1': draft.saldoInicial });
    pushRow('Recebimentos (Previsto)', rows.prevReceb);
    pushRow('Recebimentos (Realizado)', rows.realReceb);
    pushRow('Desembolsos (Previsto)', rows.prevDesemb);
    pushRow('Desembolsos (Realizado)', rows.realDesemb);
    pushRow('Geração de Caixa (Previsto)', rows.prevGer);
    pushRow('Geração de Caixa (Realizado)', rows.realGer);
    pushRow('Aportes', rows.aporte);
    pushRow('Saldo de Caixa (Previsto)', (w) => rows.prevSaldo[w]);
    pushRow('Saldo de Caixa (Realizado)', (w) => rows.realSaldo[w]);
    exportReportToExcel(data, `FLUXO_CAIXA_${monthLabel}_${selectedYear}`, `Fluxo_Caixa_${monthLabel}_${selectedYear}.xlsx`);
  };

  const handleExportGeralPdf = () => {
    exportCashFlowPdfGeral(plans, statementEntries, selectedYear);
  };

  const handleExportMensalPdf = (mKey: string) => {
    const targetPlan = plans.find((p) => p.monthKey === mKey && p.year === selectedYear) || (mKey === monthKey ? draft : undefined);
    exportCashFlowPdfMensal(targetPlan, statementEntries, selectedYear, mKey);
  };

  const receiptTypes = Object.keys(realized.recebByType).sort();
  const paymentSources = Object.keys(realized.desembBySource).sort();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              PLANEJAMENTO & REALIZADO
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Fluxo de Caixa Semanal — Previsto x Realizado</h2>
          <p className="text-xs text-[#8B7D6B]">
            Planejamento semanal do mês. O <b>Realizado</b> é calculado automaticamente a partir do Extrato Financeiro
            (entradas e saídas por semana). O <b>Previsto</b> é preenchido para planejar o caixa futuro.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs font-bold text-[#2D2A26] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#C19A6B]"
          >
            {MONTHS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>

          <PdfExportMenu
            selectedYear={selectedYear}
            currentMonthKey={monthKey}
            onExportGeral={handleExportGeralPdf}
            onExportMensal={handleExportMensalPdf}
          />

          <button
            onClick={handleExport}
            className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-2 border border-[#EAE6DF]"
          >
            <Download className="w-4 h-4 text-[#8B7D6B]" />
            <span>Exportar Excel</span>
          </button>
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2.5 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {isSaving ? (
                <svg className="animate-spin w-4 h-4 text-[#C19A6B]" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                </svg>
              ) : (
                <Save className="w-4 h-4 text-[#C19A6B]" />
              )}
              <span>{isSaving ? 'Salvando...' : 'Salvar Planejamento'}</span>
            </button>
          )}
        </div>
      </div>

      {savedMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-bold">{savedMsg}</p>
        </div>
      )}
      {saveError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <p className="text-xs font-bold">{saveError}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider flex items-center gap-1">
            <Wallet className="w-3.5 h-3.5 text-[#C19A6B]" /> Saldo Inicial
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(draft.saldoInicial)}</p>
          <span className="text-[10px] text-[#8B7D6B]">{monthLabel}/{selectedYear}</span>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5" /> Recebido (Real.)
          </span>
          <p className="text-lg font-black text-emerald-800 mt-1">{formatCurrency(totalRealReceb)}</p>
          <span className="text-[10px] text-emerald-700">Previsto: {formatCurrency(totalPrevReceb)}</span>
        </div>
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5" /> Pago (Real.)
          </span>
          <p className="text-lg font-black text-rose-800 mt-1">{formatCurrency(Math.abs(totalRealDesemb))}</p>
          <span className="text-[10px] text-rose-700">Previsto: {formatCurrency(Math.abs(totalPrevDesemb))}</span>
        </div>
        <div className={`p-4 rounded-xl shadow-xs border ${saldoFinalReal >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${saldoFinalReal >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
            <TrendingUp className="w-3.5 h-3.5" /> Saldo Final (Real.)
          </span>
          <p className={`text-lg font-black mt-1 ${saldoFinalReal >= 0 ? 'text-blue-800' : 'text-amber-800'}`}>{formatCurrency(saldoFinalReal)}</p>
          <span className={`text-[10px] ${saldoFinalReal >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>Previsto: {formatCurrency(saldoFinalPrev)}</span>
        </div>
      </div>

      {/* Saldo inicial editável + herança */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="text-xs font-bold text-[#433E37] whitespace-nowrap">Saldo inicial de {monthLabel}:</label>
        <input
          type="text"
          disabled={!canEdit}
          value={draft.saldoInicial || ''}
          onChange={(e) => setDraft((d) => ({ ...d, saldoInicial: parseInput(e.target.value), useSaldoAutomatico: false }))}
          placeholder="0,00"
          className="w-40 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-sm font-mono text-right focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
        />
        {previousMonthFinalSaldo != null && canEdit && (
          <button
            onClick={inheritSaldo}
            className="px-3 py-2 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF] flex items-center gap-1.5"
            title="Usar o saldo final realizado do mês anterior"
          >
            <RefreshCcw className="w-3.5 h-3.5 text-[#C19A6B]" />
            Herdar do mês anterior ({formatCurrency(previousMonthFinalSaldo)})
          </button>
        )}
        <div className="sm:ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] font-bold text-[#433E37] cursor-pointer select-none" title="Ative para meses históricos: o Realizado é digitado manualmente. Desative para o Realizado vir automaticamente do Extrato Financeiro.">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={!!draft.realizadoManual}
              onChange={(e) => setDraft((d) => ({ ...d, realizadoManual: e.target.checked }))}
              className="accent-[#C19A6B] w-4 h-4"
            />
            Realizado manual (histórico)
          </label>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${draft.realizadoManual ? 'bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            {draft.realizadoManual ? 'Manual' : 'Automático (Extrato)'}
          </span>
        </div>
      </div>

      {/* Grade principal Previsto x Realizado */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-[#2D2A26] text-[#EAE6DF]">
                <th className="p-2.5 text-left sticky left-0 bg-[#2D2A26] z-10 min-w-[150px]">Linha</th>
                {WEEKS.map((w) => (
                  <th key={w} colSpan={2} className="p-2 text-center border-l border-[#3F3B35]">{WEEK_LABELS[w]}</th>
                ))}
                <th colSpan={2} className="p-2 text-center border-l border-[#C19A6B] bg-[#3F3B35]">TOTAL</th>
              </tr>
              <tr className="bg-[#3F3B35] text-[#EAE6DF]/80 text-[10px]">
                <th className="p-1.5 sticky left-0 bg-[#3F3B35] z-10"></th>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <th className="p-1.5 text-center border-l border-[#4a453d] font-semibold">PREV.</th>
                    <th className="p-1.5 text-center font-semibold text-[#C19A6B]">REAL.</th>
                  </React.Fragment>
                ))}
                <th className="p-1.5 text-center border-l border-[#C19A6B] font-semibold">PREV.</th>
                <th className="p-1.5 text-center font-semibold text-[#C19A6B]">REAL.</th>
              </tr>
            </thead>
            <tbody className="text-[#433E37]">
              {/* Recebimentos */}
              <tr className="border-b border-[#EAE6DF] hover:bg-[#FDFBF7]">
                <td className="p-2 font-bold sticky left-0 bg-white z-10">Recebimentos</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className="p-1 border-l border-[#EAE6DF]">
                      <input
                        type="text" disabled={!canEdit}
                        value={draft.weeks[w].recebimentos || ''}
                        onChange={(e) => setWeekValue(w, 'recebimentos', e.target.value)}
                        placeholder="0"
                        className="w-full bg-emerald-50/40 border border-transparent hover:border-emerald-200 focus:border-emerald-400 rounded px-1.5 py-1 text-right font-mono text-[11px] focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="p-1">
                      {draft.realizadoManual && canEdit ? (
                        <input
                          type="text"
                          value={draft.weeks[w].recebRealizado || ''}
                          onChange={(e) => setWeekValue(w, 'recebRealizado', e.target.value)}
                          placeholder="0"
                          className="w-full bg-emerald-100/50 border border-transparent hover:border-emerald-300 focus:border-emerald-500 rounded px-1.5 py-1 text-right font-mono text-[11px] text-emerald-800 font-semibold focus:outline-none"
                        />
                      ) : (
                        <span className="block px-1.5 text-right font-mono text-[11px] text-emerald-700 font-semibold">{formatCurrency(rows.realReceb(w))}</span>
                      )}
                    </td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B]/40 bg-[#F9F7F2]">{formatCurrency(totalPrevReceb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-emerald-700 bg-[#F9F7F2]">{formatCurrency(totalRealReceb)}</td>
              </tr>

              {/* Desembolsos */}
              <tr className="border-b border-[#EAE6DF] hover:bg-[#FDFBF7]">
                <td className="p-2 font-bold sticky left-0 bg-white z-10">Desembolsos</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className="p-1 border-l border-[#EAE6DF]">
                      <input
                        type="text" disabled={!canEdit}
                        value={draft.weeks[w].desembolsos || ''}
                        onChange={(e) => setWeekValue(w, 'desembolsos', e.target.value)}
                        placeholder="0"
                        className="w-full bg-rose-50/40 border border-transparent hover:border-rose-200 focus:border-rose-400 rounded px-1.5 py-1 text-right font-mono text-[11px] focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="p-1">
                      {draft.realizadoManual && canEdit ? (
                        <input
                          type="text"
                          value={draft.weeks[w].desembRealizado || ''}
                          onChange={(e) => setWeekValue(w, 'desembRealizado', e.target.value)}
                          placeholder="0"
                          className="w-full bg-rose-100/50 border border-transparent hover:border-rose-300 focus:border-rose-500 rounded px-1.5 py-1 text-right font-mono text-[11px] text-rose-800 font-semibold focus:outline-none"
                        />
                      ) : (
                        <span className="block px-1.5 text-right font-mono text-[11px] text-rose-700 font-semibold">{formatCurrency(rows.realDesemb(w))}</span>
                      )}
                    </td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B]/40 bg-[#F9F7F2]">{formatCurrency(totalPrevDesemb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-rose-700 bg-[#F9F7F2]">{formatCurrency(totalRealDesemb)}</td>
              </tr>

              {/* Geração de Caixa */}
              <tr className="border-b-2 border-[#EAE6DF] bg-[#F9F7F2]/50">
                <td className="p-2 font-black sticky left-0 bg-[#F9F7F2] z-10">Geração de Caixa</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#EAE6DF] ${rows.prevGer(w) >= 0 ? 'text-[#2D2A26]' : 'text-rose-600'}`}>{formatCurrency(rows.prevGer(w))}</td>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-bold ${rows.realGer(w) >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatCurrency(rows.realGer(w))}</td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-black border-l border-[#C19A6B]/40 bg-[#EAE6DF]/50">{formatCurrency(totalPrevReceb + totalPrevDesemb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-black bg-[#EAE6DF]/50">{formatCurrency(totalRealReceb + totalRealDesemb)}</td>
              </tr>

              {/* Aportes */}
              <tr className="border-b border-[#EAE6DF] hover:bg-[#FDFBF7]">
                <td className="p-2 font-bold sticky left-0 bg-white z-10">Aportes</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className="p-1 border-l border-[#EAE6DF]">
                      <input
                        type="text" disabled={!canEdit}
                        value={draft.weeks[w].aportes || ''}
                        onChange={(e) => setWeekValue(w, 'aportes', e.target.value)}
                        placeholder="0"
                        className="w-full bg-[#C19A6B]/10 border border-transparent hover:border-[#C19A6B]/40 focus:border-[#C19A6B] rounded px-1.5 py-1 text-right font-mono text-[11px] focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="p-1.5 text-right font-mono text-[11px] text-[#8B7D6B]">{formatCurrency(rows.aporte(w))}</td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B]/40 bg-[#F9F7F2]">{formatCurrency(totalAporte)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-[#8B7D6B] bg-[#F9F7F2]">{formatCurrency(totalAporte)}</td>
              </tr>

              {/* Saldo de Caixa */}
              <tr className="bg-[#2D2A26] text-[#EAE6DF]">
                <td className="p-2 font-black sticky left-0 bg-[#2D2A26] z-10">Saldo de Caixa</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#3F3B35] ${rows.prevSaldo[w] >= 0 ? 'text-[#EAE6DF]' : 'text-rose-300'}`}>{formatCurrency(rows.prevSaldo[w])}</td>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-black ${rows.realSaldo[w] >= 0 ? 'text-[#C19A6B]' : 'text-rose-300'}`}>{formatCurrency(rows.realSaldo[w])}</td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B] bg-[#3F3B35]">{formatCurrency(saldoFinalPrev)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-black text-[#C19A6B] bg-[#3F3B35]">{formatCurrency(saldoFinalReal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#EAE6DF] text-[10px] text-[#8B7D6B] flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Células <b className="text-emerald-700">verdes/vermelhas/douradas</b> são editáveis (Previsto). As colunas <b>REAL.</b> vêm automaticamente do Extrato Financeiro.
        </div>
      </div>

      {/* Tabelas de apoio */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recebimentos por tipo */}
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Recebimentos por Tipo (Realizado)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                <tr>
                  <th className="p-2 text-left">Tipo</th>
                  {WEEKS.map((w) => (<th key={w} className="p-2 text-right">{WEEK_LABELS[w].replace('Semana ', 'S')}</th>))}
                  <th className="p-2 text-right border-l border-[#EAE6DF]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {receiptTypes.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-[#8B7D6B]">Sem recebimentos no extrato deste mês.</td></tr>
                )}
                {receiptTypes.map((t) => {
                  const row = realized.recebByType[t];
                  const total = WEEKS.reduce((a, w) => a + row[w], 0);
                  return (
                    <tr key={t} className="hover:bg-[#FDFBF7]">
                      <td className="p-2 font-semibold text-[#433E37]">{t}</td>
                      {WEEKS.map((w) => (<td key={w} className="p-2 text-right font-mono text-[#433E37]">{row[w] ? formatCurrency(row[w]) : '—'}</td>))}
                      <td className="p-2 text-right font-mono font-bold text-emerald-700 border-l border-[#EAE6DF]">{formatCurrency(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Desembolsos por origem */}
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-rose-600" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Desembolsos por Origem (Realizado)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                <tr>
                  <th className="p-2 text-left">Origem</th>
                  {WEEKS.map((w) => (<th key={w} className="p-2 text-right">{WEEK_LABELS[w].replace('Semana ', 'S')}</th>))}
                  <th className="p-2 text-right border-l border-[#EAE6DF]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {paymentSources.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-[#8B7D6B]">Sem desembolsos no extrato deste mês.</td></tr>
                )}
                {paymentSources.map((s) => {
                  const row = realized.desembBySource[s];
                  const total = WEEKS.reduce((a, w) => a + row[w], 0);
                  return (
                    <tr key={s} className="hover:bg-[#FDFBF7]">
                      <td className="p-2 font-semibold text-[#433E37]">{s}</td>
                      {WEEKS.map((w) => (<td key={w} className="p-2 text-right font-mono text-[#433E37]">{row[w] ? formatCurrency(row[w]) : '—'}</td>))}
                      <td className="p-2 text-right font-mono font-bold text-rose-700 border-l border-[#EAE6DF]">{formatCurrency(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pendências (obrigações em aberto) */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-[#EAE6DF] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-[#C19A6B]" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Pendências — Obrigações em Aberto</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#8B7D6B]">Total:</span>
            <span className="text-sm font-black text-rose-700">{formatCurrency(totalPendencias)}</span>
            {canEdit && (
              <button
                onClick={addPendencia}
                className="px-2.5 py-1.5 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF] flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5 text-[#C19A6B]" /> Adicionar
              </button>
            )}
          </div>
        </div>
        <div className="p-4">
          {pendencias.length === 0 ? (
            <p className="text-xs text-[#8B7D6B] text-center py-3">Nenhuma pendência registrada para {monthLabel}/{selectedYear}.</p>
          ) : (
            <div className="space-y-2">
              {pendencias.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={p.descricao}
                    onChange={(e) => setPendencia(idx, 'descricao', e.target.value)}
                    placeholder="Descrição (ex: PRÓ-LABORE REF JULHO/2026)"
                    className="flex-1 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs text-[#433E37] focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
                  />
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={p.valor || ''}
                    onChange={(e) => setPendencia(idx, 'valor', e.target.value)}
                    placeholder="0,00"
                    className="w-36 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-mono text-right text-rose-700 font-semibold focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
                  />
                  {canEdit && (
                    <button
                      onClick={() => removePendencia(idx)}
                      className="p-2 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white transition-colors"
                      title="Remover pendência"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-[#8B7D6B] mt-3">
            Pendências são obrigações já vencidas/programadas ainda não pagas (pró-labore, aluguel, etc.), importadas da planilha. Não entram no saldo até serem quitadas — servem de alerta de compromissos futuros.
          </p>
        </div>
      </div>

      {/* Rodapé de acurácia */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-[#8B7D6B]">
          Acurácia do planejamento (Realizado / Previsto de recebimentos):
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40 h-2 rounded-full bg-[#EAE6DF] overflow-hidden">
            <div
              className={`h-full ${acuracia >= 90 ? 'bg-emerald-500' : acuracia >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
              style={{ width: `${Math.min(100, acuracia)}%` }}
            />
          </div>
          <span className="text-sm font-black text-[#2D2A26]">{acuracia.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
};
