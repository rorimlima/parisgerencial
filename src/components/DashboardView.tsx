/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  FileSearch,
  HelpCircle,
  Receipt,
  ShieldCheck,
  Sigma,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  BillingMonthSummary,
  EconomicMonthData,
  FinancialMonthData,
  FinancialStatementEntry,
  PayableTitle,
  ViewTab,
} from '../types';
import { formatCurrency, formatPercent } from '../utils/exportUtils';
import {
  AuditSeverity,
  buildAuditChecks,
  buildCalcMemory,
  buildOperatingRows,
  buildOperatingTotals,
  safeDiv,
  summarizeAudit,
} from '../utils/financialAudit';

interface DashboardViewProps {
  economicMonths: Record<string, EconomicMonthData>;
  financialMonths: Record<string, FinancialMonthData>;
  selectedYear: number;
  onNavigateTab?: (tab: ViewTab) => void;
  setActiveTab?: (tab: ViewTab) => void;
  customers?: any[];
  delinquentTitles?: any[];
  billingSummaries?: BillingMonthSummary[];
  payables?: PayableTitle[];
  statementEntries?: FinancialStatementEntry[];
}

// Paleta por severidade da conferência de auditoria
const SEVERITY_STYLE: Record<AuditSeverity, { chip: string; label: string; dot: string }> = {
  ok: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Conforme', dot: 'bg-emerald-600' },
  atencao: { chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Atenção', dot: 'bg-amber-500' },
  critico: { chip: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Crítico', dot: 'bg-rose-600' },
  'sem-dados': { chip: 'bg-stone-100 text-[#8B7D6B] border-[#EAE6DF]', label: 'Sem dados', dot: 'bg-[#8B7D6B]' },
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  economicMonths,
  financialMonths,
  selectedYear,
  onNavigateTab,
  setActiveTab,
  billingSummaries = [],
  payables = [],
  statementEntries = [],
}) => {
  const [showMemory, setShowMemory] = useState(false);
  const [showAudit, setShowAudit] = useState(true);
  const handleNav = (tab: ViewTab) => {
    if (onNavigateTab) onNavigateTab(tab);
    if (setActiveTab) setActiveTab(tab);
  };

  // Meses com dados reais (econômico e financeiro)
  const allMonthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const ecoMonthKeys = allMonthKeys.filter((m) => (economicMonths[m]?.receitaBruta || 0) > 0);
  const finMonthKeys = allMonthKeys.filter((m) => (financialMonths[m]?.totalEntradas || 0) > 0);
  // Para gráficos, usa todos os meses que têm algum dado
  const monthKeys = Array.from(new Set([...ecoMonthKeys, ...finMonthKeys])).sort(
    (a, b) => allMonthKeys.indexOf(a) - allMonthKeys.indexOf(b)
  );
  const displayMonths = monthKeys.length > 0 ? monthKeys : allMonthKeys.slice(0, 6);

  // Calculations for Economic DRE
  const totalReceita = displayMonths.reduce((acc, m) => acc + (economicMonths[m]?.receitaBruta || 0), 0);
  const totalCmv = displayMonths.reduce((acc, m) => acc + (economicMonths[m]?.cmv || 0), 0);
  const totalMargem = displayMonths.reduce((acc, m) => acc + (economicMonths[m]?.margemBruta || 0), 0);
  const totalResEco = displayMonths.reduce((acc, m) => acc + (economicMonths[m]?.resultadoEconomico || 0), 0);
  const avgPontoEquilibrio =
    displayMonths.length > 0
      ? displayMonths.reduce((acc, m) => acc + (economicMonths[m]?.pontoEquilibrio || 0), 0) / displayMonths.length
      : 0;

  // Calculations for Financial Cash Flow
  const totalEntradas = displayMonths.reduce((acc, m) => acc + (financialMonths[m]?.totalEntradas || 0), 0);
  const totalSaidas = displayMonths.reduce((acc, m) => acc + (financialMonths[m]?.totalSaidas || 0), 0);
  const totalResFin = totalEntradas - totalSaidas;
  const avgEstoque =
    finMonthKeys.length > 0
      ? finMonthKeys.reduce((acc, m) => acc + (financialMonths[m]?.estoque || 0), 0) / finMonthKeys.length
      : 0;
  // Pega a inadimplência acumulada do último mês com dados
  const lastFinMonth = [...finMonthKeys].pop();
  const currentInadAcumulada = lastFinMonth ? (financialMonths[lastFinMonth]?.inadimplenciaAcumulada || 0) : 0;

  // Chart Data Preparation
  const dreChartData = displayMonths.map((m) => {
    const item = economicMonths[m] || {};
    return {
      name: m.toUpperCase(),
      ReceitaBruta: item.receitaBruta || 0,
      CMV: item.cmv || 0,
      MargemBruta: item.margemBruta || 0,
    };
  });

  const cashflowChartData = displayMonths.map((m) => {
    const item = financialMonths[m] || {};
    return {
      name: m.toUpperCase(),
      EntradasTotal: item.totalEntradas || 0,
      SaidasTotal: item.totalSaidas || 0,
      ResFinanceiro: item.resultadoFinanceiro || 0,
    };
  });

  const riskChartData = displayMonths.map((m) => {
    const item = financialMonths[m] || {};
    return {
      name: m.toUpperCase(),
      InadimplenciaMensal: item.inadimplenciaMensal || 0,
      InadimplenciaAcumulada: item.inadimplenciaAcumulada || 0,
      Estoque: item.estoque || 0,
    };
  });

  /**
   * CICLO OPERACIONAL — Faturado → Recebido → Pago
   * Cruzamento das quatro bases (notas, resultado financeiro, contas a pagar e
   * extrato). Toda a matemática mora em utils/financialAudit.ts, função pura e
   * testável; aqui só desenhamos o resultado.
   */
  const operatingRows = useMemo(
    () =>
      buildOperatingRows({
        economicMonths,
        financialMonths,
        billingSummaries,
        payables,
        statementEntries,
        year: selectedYear,
      }),
    [economicMonths, financialMonths, billingSummaries, payables, statementEntries, selectedYear]
  );

  const totals = useMemo(
    () => buildOperatingTotals(operatingRows, economicMonths, financialMonths),
    [operatingRows, economicMonths, financialMonths]
  );

  const calcMemory = useMemo(() => buildCalcMemory(totals), [totals]);
  const auditChecks = useMemo(
    () => buildAuditChecks({ totals, payables, year: selectedYear }),
    [totals, payables, selectedYear]
  );
  const auditSummary = useMemo(() => summarizeAudit(auditChecks), [auditChecks]);

  const cycleChartData = operatingRows.map((r) => ({
    name: r.label,
    Faturado: r.faturado,
    Recebido: r.recebido,
    Pago: r.pago,
    Conversao: r.conversao,
  }));

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              MONITORAMENTO EM TEMPO REAL
            </span>
            <span className="text-xs text-[#8B7D6B]">• Ano Base Ativo: {selectedYear}</span>
          </div>
          <h1 className="text-2xl font-black text-[#2D2A26] tracking-tight">
            Paris Dakar Gerencial — Painel Executivo
          </h1>
          <p className="text-xs text-[#8B7D6B] mt-1">
            Consolidação do DRE econômico, fluxo de caixa financeiro, níveis de estoque e inadimplência.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => handleNav('economic')}
            className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] hover:bg-[#EAE6DF] text-[#433E37] rounded-lg border border-[#EAE6DF] transition-all flex items-center gap-1.5"
          >
            <BarChart3 className="w-4 h-4 text-[#C19A6B]" />
            <span>DRE Completo</span>
          </button>
          <button
            onClick={() => handleNav('financial')}
            className="px-4 py-2 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all flex items-center gap-1.5"
          >
            <DollarSign className="w-4 h-4 text-[#C19A6B]" />
            <span>Fluxo Financeiro</span>
          </button>
        </div>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Receita Bruta DRE */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Receita Bruta (DRE)</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#2D2A26]">{formatCurrency(totalReceita)}</p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>CMV Médio: {formatPercent(totalReceita > 0 ? (totalCmv / totalReceita) * 100 : 0)}</span>
            <span className="text-emerald-700 font-semibold">
              Margem: {formatCurrency(totalMargem)}
            </span>
          </div>
        </div>

        {/* Card 2: Resultado Econômico */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Resultado Econômico</span>
            <div className="p-2 rounded-lg bg-[#C19A6B]/15 text-[#C19A6B]">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#C19A6B]">
            {formatCurrency(totalResEco)}
          </p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>Ponto Equilíbrio Médio:</span>
            <span className="text-[#2D2A26] font-semibold">{formatCurrency(avgPontoEquilibrio)}</span>
          </div>
        </div>

        {/* Card 3: Entradas x Saídas Financeiras */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Entradas Financeiras</span>
            <div className="p-2 rounded-lg bg-stone-100 text-[#2D2A26]">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#2D2A26]">{formatCurrency(totalEntradas)}</p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>Saídas: {formatCurrency(totalSaidas)}</span>
            <span className={totalResFin >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
              {formatCurrency(totalResFin)}
            </span>
          </div>
        </div>

        {/* Card 4: Inadimplência & Estoque */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Inadimplência</span>
            <div className="p-2 rounded-lg bg-orange-50 text-orange-700">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-orange-700">{formatCurrency(currentInadAcumulada)}</p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>Estoque Médio:</span>
            <span className="text-[#C19A6B] font-semibold">{formatCurrency(avgEstoque)}</span>
          </div>
        </div>
      </div>

      {/* ══ CICLO OPERACIONAL: Faturado → Recebido → Pago ══════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Faturado */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Faturado (vendido)</span>
            <div className="p-2 rounded-lg bg-[#C19A6B]/15 text-[#C19A6B]">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#2D2A26]">{formatCurrency(totals.faturado)}</p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>{totals.mesesComDados} {totals.mesesComDados === 1 ? 'mês' : 'meses'}</span>
            <span
              className="font-semibold text-[#C19A6B]"
              title={
                totals.faturamentoDeNotas
                  ? 'Origem: notas fiscais emitidas (RPR014)'
                  : 'Origem: Receita Bruta do DRE — base de notas não carregada'
              }
            >
              {totals.faturamentoDeNotas ? 'Fonte: Notas Fiscais' : 'Fonte: DRE'}
            </span>
          </div>
        </div>

        {/* Recebido */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Recebido (entrou)</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-emerald-700">{formatCurrency(totals.recebido)}</p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>Conversão do faturado:</span>
            <span
              className={
                totals.conversao >= 90
                  ? 'text-emerald-700 font-bold'
                  : totals.conversao >= 75
                  ? 'text-amber-600 font-bold'
                  : 'text-rose-700 font-bold'
              }
            >
              {formatPercent(totals.conversao)}
            </span>
          </div>
        </div>

        {/* Pago */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">Pago (saiu)</span>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-700">
              <ArrowDownCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-rose-700">{formatCurrency(totals.pago)}</p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>Cobertura (recebido÷pago):</span>
            <span className={totals.cobertura >= 100 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
              {formatPercent(totals.cobertura)}
            </span>
          </div>
        </div>

        {/* Geração de caixa */}
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs hover:border-[#C19A6B]/50 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">
              {totals.resultadoCaixa >= 0 ? 'Geração de Caixa' : 'Queima de Caixa'}
            </span>
            <div className="p-2 rounded-lg bg-stone-100 text-[#2D2A26]">
              <Sigma className="w-4 h-4" />
            </div>
          </div>
          <p className={totals.resultadoCaixa >= 0 ? 'text-xl font-bold text-emerald-700' : 'text-xl font-bold text-rose-700'}>
            {formatCurrency(totals.resultadoCaixa)}
          </p>
          <div className="flex items-center justify-between text-[11px] mt-2 pt-2 border-t border-[#EAE6DF] text-[#8B7D6B]">
            <span>Recebido − Pago</span>
            <span className="text-[#2D2A26] font-semibold">
              {formatPercent(safeDiv(totals.resultadoCaixa, totals.recebido) * 100)}
            </span>
          </div>
        </div>
      </div>

      {/* Gráfico: Faturado × Recebido × Pago */}
      <div className="bg-white border border-[#EAE6DF] p-5 rounded-xl shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#C19A6B]" />
              Ciclo Operacional — Faturado × Recebido × Pago
            </h3>
            <p className="text-[11px] text-[#8B7D6B]">
              Quanto vendemos, quanto entrou no caixa e quanto saiu, mês a mês. A linha mostra a conversão do
              faturamento em dinheiro.
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-[#F3F1ED] text-[#8B7D6B] font-bold self-start">
            {totals.faturamentoDeNotas ? 'NOTAS + CAIXA' : 'DRE + CAIXA'}
          </span>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cycleChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EAE6DF" />
              <XAxis dataKey="name" stroke="#8B7D6B" fontSize={11} />
              <YAxis
                yAxisId="left"
                stroke="#8B7D6B"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#8B7D6B"
                fontSize={10}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#EAE6DF', borderRadius: '8px', color: '#2D2A26' }}
                formatter={(value: any, name: any) =>
                  name === 'Conversão'
                    ? [formatPercent(Number(value)), name]
                    : [formatCurrency(Number(value)), name]
                }
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              <Bar yAxisId="left" dataKey="Faturado" name="Faturado" fill="#C19A6B" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="Recebido" name="Recebido" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="Pago" name="Pago" fill="#DC2626" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Conversao"
                name="Conversão"
                stroke="#2D2A26"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Tabela de apoio: os mesmos números do gráfico, auditáveis linha a linha */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#8B7D6B] border-b border-[#EAE6DF]">
                <th className="text-left font-bold py-2 px-2">Mês</th>
                <th className="text-right font-bold py-2 px-2">Faturado</th>
                <th className="text-right font-bold py-2 px-2">Recebido</th>
                <th className="text-right font-bold py-2 px-2">Pago</th>
                <th className="text-right font-bold py-2 px-2">Saldo do mês</th>
                <th className="text-right font-bold py-2 px-2">Conversão</th>
                <th className="text-right font-bold py-2 px-2">Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {operatingRows.map((r) => (
                <tr key={r.monthKey} className="border-b border-[#F3F1ED] hover:bg-[#F9F7F2]">
                  <td className="py-1.5 px-2 font-bold text-[#2D2A26]">{r.label}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#2D2A26]">{formatCurrency(r.faturado)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-emerald-700">{formatCurrency(r.recebido)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-rose-700">{formatCurrency(r.pago)}</td>
                  <td
                    className={
                      r.resultadoCaixa >= 0
                        ? 'py-1.5 px-2 text-right font-mono font-bold text-emerald-700'
                        : 'py-1.5 px-2 text-right font-mono font-bold text-rose-700'
                    }
                  >
                    {formatCurrency(r.resultadoCaixa)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#8B7D6B]">{formatPercent(r.conversao)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#8B7D6B]">{formatPercent(r.cobertura)}</td>
                </tr>
              ))}
              <tr className="bg-[#F9F7F2] font-bold">
                <td className="py-2 px-2 text-[#2D2A26]">TOTAL</td>
                <td className="py-2 px-2 text-right font-mono text-[#2D2A26]">{formatCurrency(totals.faturado)}</td>
                <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatCurrency(totals.recebido)}</td>
                <td className="py-2 px-2 text-right font-mono text-rose-700">{formatCurrency(totals.pago)}</td>
                <td
                  className={
                    totals.resultadoCaixa >= 0
                      ? 'py-2 px-2 text-right font-mono text-emerald-700'
                      : 'py-2 px-2 text-right font-mono text-rose-700'
                  }
                >
                  {formatCurrency(totals.resultadoCaixa)}
                </td>
                <td className="py-2 px-2 text-right font-mono text-[#8B7D6B]">{formatPercent(totals.conversao)}</td>
                <td className="py-2 px-2 text-right font-mono text-[#8B7D6B]">{formatPercent(totals.cobertura)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ AUDITORIA FINANCEIRA ═══════════════════════════════════════════ */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <button
          onClick={() => setShowAudit((v) => !v)}
          className="w-full p-5 flex items-center justify-between hover:bg-[#F9F7F2] transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#2D2A26] text-[#C19A6B]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2D2A26]">Auditoria Financeira — Conferências Automáticas</h3>
              <p className="text-[11px] text-[#8B7D6B]">
                Cruzamento entre bases independentes: nota fiscal, caixa, extrato bancário e contas a pagar.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {auditSummary.critico > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded border bg-rose-50 text-rose-700 border-rose-200">
                {auditSummary.critico} crítico(s)
              </span>
            )}
            {auditSummary.atencao > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded border bg-amber-50 text-amber-700 border-amber-200">
                {auditSummary.atencao} atenção
              </span>
            )}
            <span className="text-[10px] font-bold px-2 py-1 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
              {auditSummary.ok} conforme
            </span>
            {showAudit ? (
              <ChevronDown className="w-4 h-4 text-[#8B7D6B]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[#8B7D6B]" />
            )}
          </div>
        </button>

        {showAudit && (
          <div className="px-5 pb-5 space-y-3 border-t border-[#EAE6DF] pt-4">
            {auditChecks.map((c) => {
              const style = SEVERITY_STYLE[c.severity];
              return (
                <div key={c.id} className="border border-[#EAE6DF] rounded-lg p-4 hover:border-[#C19A6B]/40 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                      <div>
                        <p className="text-xs font-bold text-[#2D2A26]">{c.label}</p>
                        <p className="text-[11px] text-[#8B7D6B] italic flex items-center gap-1">
                          <HelpCircle className="w-3 h-3 shrink-0" />
                          {c.question}
                        </p>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded border shrink-0 ${style.chip}`}>
                      {style.label}
                    </span>
                  </div>

                  {/* Memória da conferência: os dois números e a diferença */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono bg-[#F9F7F2] rounded-lg p-3 border border-[#EAE6DF]">
                    <div>
                      <span className="block text-[10px] text-[#8B7D6B] font-sans">{c.baseLabel}</span>
                      <span className="font-bold text-[#2D2A26]">
                        {c.id === 'baixas-pendentes' ? formatCurrency(c.baseValue) : formatCurrency(c.baseValue)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#8B7D6B] font-sans">{c.compareLabel}</span>
                      <span className="font-bold text-[#2D2A26]">
                        {c.id === 'baixas-pendentes'
                          ? `${c.compareValue} título(s)`
                          : formatCurrency(c.compareValue)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#8B7D6B] font-sans">Diferença</span>
                      <span
                        className={
                          c.severity === 'ok'
                            ? 'font-bold text-emerald-700'
                            : c.severity === 'sem-dados'
                            ? 'font-bold text-[#8B7D6B]'
                            : c.severity === 'atencao'
                            ? 'font-bold text-amber-600'
                            : 'font-bold text-rose-700'
                        }
                      >
                        {formatCurrency(c.diff)} ({formatPercent(c.diffPct)})
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#433E37] mt-2.5 leading-relaxed">
                    <span className="font-bold text-[#2D2A26]">Achado: </span>
                    {c.finding}
                  </p>
                  {c.severity !== 'ok' && (
                    <p className="text-[11px] text-[#8B7D6B] mt-1 leading-relaxed">
                      <span className="font-bold text-[#C19A6B]">Recomendação: </span>
                      {c.action}
                    </p>
                  )}
                </div>
              );
            })}

            <p className="text-[10px] text-[#8B7D6B] pt-1 leading-relaxed flex items-start gap-1.5">
              <FileSearch className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Faixas de tolerância: até 1% de diferença é tratado como arredondamento/corte de data (conforme), até 5%
                exige explicação (atenção), acima de 5% é erro de lançamento até prova em contrário (crítico).
                Conferências marcadas como "sem dados" dependem de bases ainda não importadas para {selectedYear}.
              </span>
            </p>
          </div>
        )}
      </div>

      {/* ══ MEMÓRIA DE CÁLCULO ═════════════════════════════════════════════ */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <button
          onClick={() => setShowMemory((v) => !v)}
          className="w-full p-5 flex items-center justify-between hover:bg-[#F9F7F2] transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              <Sigma className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2D2A26]">Memória de Cálculo dos Indicadores</h3>
              <p className="text-[11px] text-[#8B7D6B]">
                Cada indicador com a fórmula, os valores substituídos e a leitura gerencial — para conferir na mão.
              </p>
            </div>
          </div>
          {showMemory ? (
            <ChevronDown className="w-4 h-4 text-[#8B7D6B]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[#8B7D6B]" />
          )}
        </button>

        {showMemory && (
          <div className="px-5 pb-5 border-t border-[#EAE6DF] pt-4 space-y-3">
            {calcMemory.map((m) => (
              <div key={m.id} className="border border-[#EAE6DF] rounded-lg p-4 hover:border-[#C19A6B]/40 transition-all">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                  <p className="text-xs font-bold text-[#2D2A26] flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#C19A6B]" />
                    {m.label}
                  </p>
                  <span className="text-sm font-black text-[#C19A6B] font-mono">{m.result}</span>
                </div>
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3 space-y-1">
                  <p className="text-[11px] font-mono text-[#8B7D6B]">
                    <span className="font-sans font-bold text-[10px] uppercase tracking-wider text-[#C19A6B] mr-1.5">
                      Fórmula
                    </span>
                    {m.formula}
                  </p>
                  <p className="text-[11px] font-mono text-[#2D2A26]">
                    <span className="font-sans font-bold text-[10px] uppercase tracking-wider text-[#C19A6B] mr-1.5">
                      Cálculo
                    </span>
                    {m.substitution} = <span className="font-bold">{m.result}</span>
                  </p>
                </div>
                <p className="text-[11px] text-[#433E37] mt-2 leading-relaxed">
                  <span className="font-bold text-[#2D2A26]">Leitura: </span>
                  {m.reading}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart Section 1: Economic Performance DRE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#EAE6DF] p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#C19A6B]" />
                Comparativo Econômico Mensal
              </h3>
              <p className="text-[11px] text-[#8B7D6B]">Composição do DRE no período</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#F3F1ED] text-[#8B7D6B] font-bold">DRE</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dreChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE6DF" />
                <XAxis dataKey="name" stroke="#8B7D6B" fontSize={11} />
                <YAxis stroke="#8B7D6B" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#EAE6DF', borderRadius: '8px', color: '#2D2A26' }}
                  formatter={(value: any) => [formatCurrency(Number(value)), '']}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="ReceitaBruta" name="Receita Bruta" fill="#C19A6B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="CMV" name="CMV (Custos)" fill="#8B7D6B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="MargemBruta" name="Margem Bruta" fill="#2D2A26" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart Section 2: Cashflow Entradas vs Saídas */}
        <div className="bg-white border border-[#EAE6DF] p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[#C19A6B]" />
                Fluxo Financeiro de Caixa
              </h3>
              <p className="text-[11px] text-[#8B7D6B]">Entradas vs Saídas de Caixa</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#F3F1ED] text-[#8B7D6B] font-bold">Caixa</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cashflowChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE6DF" />
                <XAxis dataKey="name" stroke="#8B7D6B" fontSize={11} />
                <YAxis stroke="#8B7D6B" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#EAE6DF', borderRadius: '8px', color: '#2D2A26' }}
                  formatter={(value: any) => [formatCurrency(Number(value)), '']}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Line type="monotone" dataKey="EntradasTotal" name="Entradas" stroke="#059669" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="SaidasTotal" name="Saídas" stroke="#DC2626" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="ResFinanceiro" name="Resultado Líquido" stroke="#C19A6B" strokeWidth={2} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Chart Section 3: Risk & Delinquency vs Inventory */}
      <div className="bg-white border border-[#EAE6DF] p-5 rounded-xl shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              Evolução da Inadimplência vs Saldo de Estoque
            </h3>
            <p className="text-[11px] text-[#8B7D6B]">
              Acompanhamento de títulos pendentes e nível de estoque
            </p>
          </div>
          <button
            onClick={() => handleNav('delinquency')}
            className="text-xs text-[#C19A6B] font-bold hover:underline flex items-center gap-1"
          >
            <span>Ver Relatório de Cobrança</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={riskChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorInadAcum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EA580C" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#EA580C" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorEstoque" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#C19A6B" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#C19A6B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#EAE6DF" />
              <XAxis dataKey="name" stroke="#8B7D6B" fontSize={11} />
              <YAxis stroke="#8B7D6B" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#EAE6DF', borderRadius: '8px', color: '#2D2A26' }}
                formatter={(value: any) => [formatCurrency(Number(value)), '']}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              <Area type="monotone" dataKey="InadimplenciaAcumulada" name="Inadimplência Acumulada" stroke="#EA580C" fillOpacity={1} fill="url(#colorInadAcum)" />
              <Area type="monotone" dataKey="Estoque" name="Valor em Estoque" stroke="#C19A6B" fillOpacity={1} fill="url(#colorEstoque)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

