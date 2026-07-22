/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  AlertTriangle,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Package,
  PlusCircle,
  Wallet,
} from 'lucide-react';
import { FinancialMonthData } from '../types';
import { exportReportToExcel, exportReportToPdf, formatCurrency, formatPercent } from '../utils/exportUtils';

interface FinancialViewProps {
  financialMonths: Record<string, FinancialMonthData>;
  selectedYear: number;
  onOpenLaunchModal: () => void;
  userRole: string;
}

export const FinancialView: React.FC<FinancialViewProps> = ({
  financialMonths,
  selectedYear,
  onOpenLaunchModal,
  userRole,
}) => {
  const monthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const totalBancos = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.entradasBancos || 0), 0);
  const totalTesouraria = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.entradasTesouraria || 0), 0);
  const totalEntradas = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.totalEntradas || 0), 0);
  const totalSaidas = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.totalSaidas || 0), 0);
  const totalResFin = totalEntradas - totalSaidas;
  const totalResFinPct = totalEntradas > 0 ? (totalResFin / totalEntradas) * 100 : 0;

  const activeMonths = monthKeys.filter((m) => (financialMonths[m]?.totalEntradas || 0) > 0);
  const activeCount = activeMonths.length || 1;

  const avgEstoque = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.estoque || 0), 0) / activeCount;
  const avgInadMensal =
    monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.inadimplenciaMensal || 0), 0) / activeCount;
  const avgInadAcumulada =
    monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.inadimplenciaAcumulada || 0), 0) / activeCount;

  const handleExportPdf = () => {
    const headers = ['Métrica Financeira', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Total Ano'];

    const rows = [
      [
        'ENTRADAS - Bancos',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.entradasBancos)),
        formatCurrency(totalBancos),
      ],
      [
        'ENTRADAS - Tesouraria',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.entradasTesouraria)),
        formatCurrency(totalTesouraria),
      ],
      [
        'TOTAL ENTRADAS',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.totalEntradas)),
        formatCurrency(totalEntradas),
      ],
      [
        'TOTAL SAÍDAS',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.totalSaidas)),
        formatCurrency(totalSaidas),
      ],
      [
        'RESULTADO FINANCEIRO',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map(
          (m) => `${formatCurrency(financialMonths[m]?.resultadoFinanceiro)} (${formatPercent(financialMonths[m]?.resultadoPercent)})`
        ),
        `${formatCurrency(totalResFin)} (${formatPercent(totalResFinPct)})`,
      ],
      [
        'ESTOQUE (Ativo Circulante)',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.estoque)),
        `Média: ${formatCurrency(avgEstoque)}`,
      ],
      [
        'INADIMPLÊNCIA MENSAL',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.inadimplenciaMensal)),
        `Média: ${formatCurrency(avgInadMensal)}`,
      ],
      [
        'INADIMPLÊNCIA ACUMULADA',
        ...['jan', 'fev', 'mar', 'abr', 'mai', 'jun'].map((m) => formatCurrency(financialMonths[m]?.inadimplenciaAcumulada)),
        `Média: ${formatCurrency(avgInadAcumulada)}`,
      ],
    ];

    exportReportToPdf({
      title: `RESULTADO FINANCEIRO — JANEIRO A DEZEMBRO DE ${selectedYear}`,
      subtitle: `Demonstrativo de Fluxo de Caixa, Movimentação Bancária, Estoque e Inadimplência — Paris Dakar Gerencial`,
      summaryCards: [
        { label: 'Total Entradas Bancos/Tesouraria', value: formatCurrency(totalEntradas) },
        { label: 'Total Saídas Efetivadas', value: formatCurrency(totalSaidas) },
        { label: 'Resultado Financeiro Líquido', value: formatCurrency(totalResFin) },
        { label: 'Estoque Médio', value: formatCurrency(avgEstoque) },
      ],
      headers,
      rows,
      filename: `Paris_Dakar_Resultado_Financeiro_${selectedYear}.pdf`,
    });
  };

  const handleExportExcel = () => {
    const excelData = [
      {
        Rubrica: 'ENTRADAS - Bancos',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.entradasBancos || 0])),
        Total: totalBancos,
      },
      {
        Rubrica: 'ENTRADAS - Tesouraria',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.entradasTesouraria || 0])),
        Total: totalTesouraria,
      },
      {
        Rubrica: 'TOTAL ENTRADAS',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.totalEntradas || 0])),
        Total: totalEntradas,
      },
      {
        Rubrica: 'TOTAL SAÍDAS',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.totalSaidas || 0])),
        Total: totalSaidas,
      },
      {
        Rubrica: 'RESULTADO FINANCEIRO',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.resultadoFinanceiro || 0])),
        Total: totalResFin,
      },
      {
        Rubrica: 'ESTOQUE',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.estoque || 0])),
        Total: avgEstoque,
      },
      {
        Rubrica: 'INADIMPLÊNCIA MENSAL',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.inadimplenciaMensal || 0])),
        Total: avgInadMensal,
      },
      {
        Rubrica: 'INADIMPLÊNCIA ACUMULADA',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), financialMonths[m]?.inadimplenciaAcumulada || 0])),
        Total: avgInadAcumulada,
      },
    ];

    exportReportToExcel(excelData, `FINANCEIRO_${selectedYear}`, `Resultado_Financeiro_Paris_Dakar_${selectedYear}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header & Export Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#EAE6DF] p-5 rounded-xl shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200">
              FLUXO DE CAIXA
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-extrabold text-[#2D2A26] mt-1">
            RESULTADO FINANCEIRO - JANEIRO A DEZEMBRO DE {selectedYear}
          </h2>
          <p className="text-xs text-[#8B7D6B]">
            Acompanhamento de Entradas (Bancos & Tesouraria), Saídas, Resultado Financeiro, Estoque e Inadimplência.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleExportPdf}
            className="px-3.5 py-2 text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg transition-all flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4 text-red-600" />
            <span>Exportar PDF</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Exportar Excel</span>
          </button>

          {userRole !== 'analista' && (
            <button
              onClick={onOpenLaunchModal}
              className="px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4 text-[#C19A6B]" />
              <span>Lançamento Manual</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Financial Spreadsheet Table (matching PDF 2) */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
                <th className="p-3 min-w-[200px] sticky left-0 bg-[#F9F7F2] z-10 border-r border-[#EAE6DF]">
                  ENTRADAS / SAÍDAS / ESTOQUE
                </th>
                {monthKeys.map((m) => (
                  <th key={m} className="p-2.5 text-center min-w-[105px] border-r border-[#EAE6DF] uppercase">
                    {m}
                  </th>
                ))}
                <th className="p-3 text-right min-w-[130px] bg-[#F3F1ED] text-[#2D2A26] font-black">
                  TOTAL ANO
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {/* Entradas - Bancos */}
              <tr className="hover:bg-[#FDFBF7] transition-colors">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] font-semibold text-[#433E37] pl-6">
                  Bancos
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.entradasBancos || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-[#433E37]">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">R$ -</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-bold text-[#2D2A26] font-mono">
                  {formatCurrency(totalBancos)}
                </td>
              </tr>

              {/* Entradas - Tesouraria */}
              <tr className="hover:bg-[#FDFBF7] transition-colors">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] font-semibold text-[#433E37] pl-6">
                  Tesouraria
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.entradasTesouraria || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-[#433E37]">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">R$ -</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-bold text-[#2D2A26] font-mono">
                  {formatCurrency(totalTesouraria)}
                </td>
              </tr>

              {/* Total Entradas */}
              <tr className="bg-emerald-50/60 hover:bg-emerald-50 font-extrabold border-t border-b border-emerald-200">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-emerald-800">
                  Total Entradas
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.totalEntradas || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-emerald-800">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">R$ -</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-emerald-100/50 font-black text-emerald-900 font-mono">
                  {formatCurrency(totalEntradas)}
                </td>
              </tr>

              {/* Total Saídas */}
              <tr className="hover:bg-[#FDFBF7] transition-colors font-bold text-[#433E37]">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-rose-700">
                  TOTAL SAÍDAS
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.totalSaidas || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-rose-700">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">R$ 0,00</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-black text-rose-800 font-mono">
                  {formatCurrency(totalSaidas)}
                </td>
              </tr>

              {/* Resultado Financeiro */}
              <tr className="hover:bg-[#FDFBF7] transition-colors font-black border-t-2 border-[#EAE6DF]">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-[#2D2A26]">
                  RESULTADO FINANCEIRO
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.resultadoFinanceiro || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {val !== 0 ? (
                        <span className={val >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatCurrency(val)}</span>
                      ) : (
                        <span className="text-[#8B7D6B]">R$ 0,00</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F3F1ED] font-black font-mono">
                  <span className={totalResFin >= 0 ? 'text-emerald-800' : 'text-rose-800'}>
                    {formatCurrency(totalResFin)}
                  </span>
                </td>
              </tr>

              {/* % Resultado */}
              <tr className="hover:bg-[#FDFBF7] transition-colors text-[#433E37]">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] font-semibold text-[#8B7D6B] pl-6">
                  % RESULTADO
                </td>
                {monthKeys.map((m) => {
                  const pct = financialMonths[m]?.resultadoPercent || 0;
                  const hasValue = (financialMonths[m]?.totalEntradas || 0) > 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {hasValue ? (
                        <span className={pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatPercent(pct)}</span>
                      ) : (
                        <span className="text-[#8B7D6B]">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-bold font-mono">
                  <span className={totalResFinPct >= 0 ? 'text-emerald-800' : 'text-rose-800'}>
                    {formatPercent(totalResFinPct)}
                  </span>
                </td>
              </tr>

              {/* ESTOQUE */}
              <tr className="bg-[#C19A6B]/15 hover:bg-[#C19A6B]/20 font-bold border-t border-b border-[#C19A6B]/30">
                <td className="p-3 sticky left-0 bg-[#F9F7F2] z-10 border-r border-[#EAE6DF] text-[#2D2A26] flex items-center justify-between">
                  <span>ESTOQUE</span>
                  <span className="text-[9px] bg-[#C19A6B]/20 text-[#C19A6B] px-1.5 py-0.5 rounded font-mono">
                    ESTOQUE MÉDIO
                  </span>
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.estoque || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-[#2D2A26]">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">-</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#C19A6B]/25 text-[#2D2A26] font-black font-mono">
                  {formatCurrency(avgEstoque)}
                </td>
              </tr>

              {/* INADIMPLÊNCIA MENSAL */}
              <tr className="hover:bg-[#FDFBF7] transition-colors">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] font-semibold text-[#433E37] flex items-center justify-between">
                  <span>INADIMPLÊNCIA MENSAL</span>
                  <span className="text-[9px] bg-[#F3F1ED] text-[#8B7D6B] px-1.5 py-0.5 rounded font-mono">
                    MÉDIA MENSAL
                  </span>
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.inadimplenciaMensal || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-rose-700">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">-</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] text-rose-800 font-bold font-mono">
                  {formatCurrency(avgInadMensal)}
                </td>
              </tr>

              {/* INADIMPLÊNCIA MENSAL ATUAL (ACUMULADA) */}
              <tr className="hover:bg-[#FDFBF7] transition-colors bg-rose-50/50 font-bold">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-rose-800 flex items-center justify-between">
                  <span>INADIMPLÊNCIA ACUMULADA</span>
                  <span className="text-[9px] bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-mono">
                    MÉDIA TOTAL
                  </span>
                </td>
                {monthKeys.map((m) => {
                  const val = financialMonths[m]?.inadimplenciaAcumulada || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-rose-800">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">-</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-rose-100/60 text-rose-900 font-black font-mono">
                  {formatCurrency(avgInadAcumulada)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
