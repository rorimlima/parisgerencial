/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Calculator,
  FileSpreadsheet,
  FileText,
  PlusCircle,
} from 'lucide-react';
import { EconomicMonthData } from '../types';
import {
  exportEconomicPdfGeral,
  exportEconomicPdfMensal,
  exportReportToExcel,
  formatCurrency,
  formatPercent,
} from '../utils/exportUtils';
import { PdfExportMenu } from './PdfExportMenu';

interface EconomicViewProps {
  economicMonths: Record<string, EconomicMonthData>;
  selectedYear: number;
  onOpenLaunchModal: () => void;
  userRole: string;
}

export const EconomicView: React.FC<EconomicViewProps> = ({
  economicMonths,
  selectedYear,
  onOpenLaunchModal,
  userRole,
}) => {
  const monthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Calculate Totals & Averages
  const totalReceita = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.receitaBruta || 0), 0);
  const totalCmv = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.cmv || 0), 0);
  const totalMargem = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.margemBruta || 0), 0);
  const totalDespesas = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.despesasFixas || 0), 0);
  const totalResEco = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.resultadoEconomico || 0), 0);

  const avgReceita = totalReceita / 12;
  const avgCmv = totalCmv / 12;
  const avgMargem = totalMargem / 12;
  const avgDespesas = totalDespesas / 12;
  const avgResEco = totalResEco / 12;

  const totalCmvPercent = totalReceita > 0 ? (totalCmv / totalReceita) * 100 : 0;
  const totalMargemPercent = totalReceita > 0 ? (totalMargem / totalReceita) * 100 : 0;
  const totalDespesasPercent = totalReceita > 0 ? (totalDespesas / totalReceita) * 100 : 0;
  const totalResEcoPercent = totalReceita > 0 ? (totalResEco / totalReceita) * 100 : 0;

  const handleExportGeralPdf = () => {
    exportEconomicPdfGeral(economicMonths, selectedYear);
  };

  const handleExportMensalPdf = (mKey: string) => {
    exportEconomicPdfMensal(economicMonths, selectedYear, mKey);
  };

  const handleExportExcel = () => {
    const excelData = [
      {
        Indicador: 'Receita Bruta',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), economicMonths[m]?.receitaBruta || 0])),
        Total: totalReceita,
        Media: avgReceita,
      },
      {
        Indicador: 'CMV',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), economicMonths[m]?.cmv || 0])),
        Total: totalCmv,
        Media: avgCmv,
      },
      {
        Indicador: 'Margem Bruta',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), economicMonths[m]?.margemBruta || 0])),
        Total: totalMargem,
        Media: avgMargem,
      },
      {
        Indicador: 'Despesas Fixas',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), economicMonths[m]?.despesasFixas || 0])),
        Total: totalDespesas,
        Media: avgDespesas,
      },
      {
        Indicador: 'Resultado Econômico',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), economicMonths[m]?.resultadoEconomico || 0])),
        Total: totalResEco,
        Media: avgResEco,
      },
      {
        Indicador: 'Ponto de Equilíbrio',
        ...Object.fromEntries(monthKeys.map((m) => [m.toUpperCase(), economicMonths[m]?.pontoEquilibrio || 0])),
        Total: '-',
        Media: avgDespesas / (totalMargemPercent / 100 || 1),
      },
    ];

    exportReportToExcel(excelData, `DRE_${selectedYear}`, `Resultado_Economico_Paris_Dakar_${selectedYear}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header & Export Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#EAE6DF] p-5 rounded-xl shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              DEMONSTRATIVO DRE
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-extrabold text-[#2D2A26] mt-1">
            RESULTADO ECONÔMICO - JANEIRO A DEZEMBRO DE {selectedYear}
          </h2>
          <p className="text-xs text-[#8B7D6B]">
            Acompanhamento mensal de Receita Bruta, CMV, Margem de Contribuição, Despesas Fixas e Ponto de Equilíbrio.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <PdfExportMenu
            selectedYear={selectedYear}
            onExportGeral={handleExportGeralPdf}
            onExportMensal={handleExportMensalPdf}
          />
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

      {/* Main DRE Spreadsheet Table */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
                <th className="p-3 min-w-[160px] sticky left-0 bg-[#F9F7F2] z-10 border-r border-[#EAE6DF]">
                  INDICADOR / MÊS
                </th>
                {monthKeys.map((m) => (
                  <th key={m} className="p-2.5 text-center min-w-[100px] border-r border-[#EAE6DF] uppercase">
                    {m} <span className="text-[10px] text-[#8B7D6B] block font-normal">%</span>
                  </th>
                ))}
                <th className="p-3 text-right min-w-[120px] bg-[#F3F1ED] text-[#2D2A26] font-black border-r border-[#EAE6DF]">
                  TOTAL
                </th>
                <th className="p-3 text-right min-w-[110px] bg-[#F3F1ED] text-[#2D2A26] font-black">
                  MÉDIA
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {/* Row 1: Receita Bruta */}
              <tr className="hover:bg-[#FDFBF7] transition-colors font-bold">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-[#2D2A26] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#C19A6B]"></span>
                  Receita Bruta
                </td>
                {monthKeys.map((m) => {
                  const val = economicMonths[m]?.receitaBruta || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {val > 0 ? (
                        <div>
                          <p>{formatCurrency(val)}</p>
                          <p className="text-[10px] text-[#8B7D6B] font-normal">100,00%</p>
                        </div>
                      ) : (
                        <span className="text-[#8B7D6B]">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-black text-[#2D2A26] border-r border-[#EAE6DF] font-mono">
                  {formatCurrency(totalReceita)}
                  <span className="block text-[10px] font-normal text-[#8B7D6B]">100,00%</span>
                </td>
                <td className="p-3 text-right bg-[#F9F7F2] font-black text-[#2D2A26] font-mono">
                  {formatCurrency(avgReceita)}
                  <span className="block text-[10px] font-normal text-[#8B7D6B]">100,00%</span>
                </td>
              </tr>

              {/* Row 2: CMV */}
              <tr className="hover:bg-[#FDFBF7] transition-colors text-[#433E37]">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] font-semibold text-[#433E37] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#8B7D6B]"></span>
                  Cmv (Custos)
                </td>
                {monthKeys.map((m) => {
                  const val = economicMonths[m]?.cmv || 0;
                  const pct = economicMonths[m]?.cmvPercent || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {val > 0 ? (
                        <div>
                          <p className="text-[#433E37]">{formatCurrency(val)}</p>
                          <p className="text-[10px] text-[#8B7D6B]">{formatPercent(pct)}</p>
                        </div>
                      ) : (
                        <span className="text-[#8B7D6B]">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-bold text-[#433E37] border-r border-[#EAE6DF] font-mono">
                  {formatCurrency(totalCmv)}
                  <span className="block text-[10px] text-[#8B7D6B]">{formatPercent(totalCmvPercent)}</span>
                </td>
                <td className="p-3 text-right bg-[#F9F7F2] font-bold text-[#433E37] font-mono">
                  {formatCurrency(avgCmv)}
                  <span className="block text-[10px] text-[#8B7D6B]">{formatPercent(totalCmvPercent)}</span>
                </td>
              </tr>

              {/* Row 3: Margem */}
              <tr className="hover:bg-[#FDFBF7] transition-colors bg-[#F3F1ED]/50 font-bold">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-emerald-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  Margem Bruta
                </td>
                {monthKeys.map((m) => {
                  const val = economicMonths[m]?.margemBruta || 0;
                  const pct = economicMonths[m]?.margemPercent || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {val !== 0 ? (
                        <div>
                          <p className="text-emerald-700">{formatCurrency(val)}</p>
                          <p className="text-[10px] text-[#8B7D6B] font-normal">{formatPercent(pct)}</p>
                        </div>
                      ) : (
                        <span className="text-[#8B7D6B]">0,00</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-black text-emerald-700 border-r border-[#EAE6DF] font-mono">
                  {formatCurrency(totalMargem)}
                  <span className="block text-[10px] font-normal text-[#8B7D6B]">{formatPercent(totalMargemPercent)}</span>
                </td>
                <td className="p-3 text-right bg-[#F9F7F2] font-black text-emerald-700 font-mono">
                  {formatCurrency(avgMargem)}
                  <span className="block text-[10px] font-normal text-[#8B7D6B]">{formatPercent(totalMargemPercent)}</span>
                </td>
              </tr>

              {/* Row 4: Despesas Fixas */}
              <tr className="hover:bg-[#FDFBF7] transition-colors">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] font-semibold text-[#433E37] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                  Despesas Fixas
                </td>
                {monthKeys.map((m) => {
                  const val = economicMonths[m]?.despesasFixas || 0;
                  const pct = economicMonths[m]?.despesasPercent || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {val > 0 ? (
                        <div>
                          <p className="text-[#433E37]">{formatCurrency(val)}</p>
                          <p className="text-[10px] text-[#8B7D6B]">{formatPercent(pct)}</p>
                        </div>
                      ) : (
                        <span className="text-[#8B7D6B]">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] font-bold text-[#433E37] border-r border-[#EAE6DF] font-mono">
                  {formatCurrency(totalDespesas)}
                  <span className="block text-[10px] text-[#8B7D6B]">{formatPercent(totalDespesasPercent)}</span>
                </td>
                <td className="p-3 text-right bg-[#F9F7F2] font-bold text-[#433E37] font-mono">
                  {formatCurrency(avgDespesas)}
                  <span className="block text-[10px] text-[#8B7D6B]">{formatPercent(totalDespesasPercent)}</span>
                </td>
              </tr>

              {/* Row 5: Res Economico */}
              <tr className="bg-[#C19A6B]/15 hover:bg-[#C19A6B]/20 font-black border-t-2 border-[#C19A6B]">
                <td className="p-3 sticky left-0 bg-[#F9F7F2] z-10 border-r border-[#EAE6DF] text-[#2D2A26] flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#C19A6B]"></span>
                  Res Econômico
                </td>
                {monthKeys.map((m) => {
                  const val = economicMonths[m]?.resultadoEconomico || 0;
                  const pct = economicMonths[m]?.resultadoPercent || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono">
                      {val !== 0 ? (
                        <div>
                          <p className="text-[#2D2A26] font-bold">{formatCurrency(val)}</p>
                          <p className="text-[10px] text-[#8B7D6B]">
                            {formatPercent(pct)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[#8B7D6B]">0,00</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F3F1ED] font-black border-r border-[#EAE6DF] font-mono">
                  <p className="text-[#C19A6B] font-bold">{formatCurrency(totalResEco)}</p>
                  <p className="text-[10px] text-[#8B7D6B]">{formatPercent(totalResEcoPercent)}</p>
                </td>
                <td className="p-3 text-right bg-[#F3F1ED] font-black font-mono">
                  <p className="text-[#C19A6B] font-bold">{formatCurrency(avgResEco)}</p>
                  <p className="text-[10px] text-[#8B7D6B]">{formatPercent(totalResEcoPercent)}</p>
                </td>
              </tr>

              {/* Row 6: Ponto de Equilíbrio */}
              <tr className="hover:bg-[#FDFBF7] transition-colors font-semibold text-[#433E37]">
                <td className="p-3 sticky left-0 bg-white z-10 border-r border-[#EAE6DF] text-[#433E37] flex items-center gap-2">
                  <Calculator className="w-3.5 h-3.5 text-[#C19A6B]" />
                  Ponto de Equilíbrio
                </td>
                {monthKeys.map((m) => {
                  const val = economicMonths[m]?.pontoEquilibrio || 0;
                  return (
                    <td key={m} className="p-2.5 text-right border-r border-[#EAE6DF] font-mono text-[#2D2A26]">
                      {val > 0 ? formatCurrency(val) : <span className="text-[#8B7D6B]">-</span>}
                    </td>
                  );
                })}
                <td className="p-3 text-right bg-[#F9F7F2] text-[#8B7D6B] border-r border-[#EAE6DF] font-mono">-</td>
                <td className="p-3 text-right bg-[#F9F7F2] text-[#2D2A26] font-bold font-mono">
                  {formatCurrency(avgDespesas / (totalMargemPercent / 100 || 1))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

