/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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
  ArrowUpRight,
  BarChart3,
  DollarSign,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { EconomicMonthData, FinancialMonthData, ViewTab } from '../types';
import { formatCurrency, formatPercent } from '../utils/exportUtils';

interface DashboardViewProps {
  economicMonths: Record<string, EconomicMonthData>;
  financialMonths: Record<string, FinancialMonthData>;
  selectedYear: number;
  onNavigateTab?: (tab: ViewTab) => void;
  setActiveTab?: (tab: ViewTab) => void;
  customers?: any[];
  delinquentTitles?: any[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  economicMonths,
  financialMonths,
  selectedYear,
  onNavigateTab,
  setActiveTab,
}) => {
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

