/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Calculator, CheckCircle2, DollarSign, X } from 'lucide-react';
import { MONTH_NAMES } from '../data/initialData';
import { formatCurrency, parseNumberPtBr } from '../utils/exportUtils';

interface LaunchModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedYear: number;
  onSaveLaunch: (data: {
    targetModule: 'economic' | 'financial';
    year: number;
    monthKey: string;
    fieldValues: Record<string, number>;
  }) => void;
}

export const LaunchModal: React.FC<LaunchModalProps> = ({
  isOpen,
  onClose,
  selectedYear,
  onSaveLaunch,
}) => {
  if (!isOpen) return null;

  const [targetModule, setTargetModule] = useState<'economic' | 'financial'>('economic');
  const [year, setYear] = useState<number>(selectedYear || 2026);
  const [monthKey, setMonthKey] = useState<string>('jul');

  // Economic Fields
  const [receitaBruta, setReceitaBruta] = useState<string>('');
  const [cmv, setCmv] = useState<string>('');
  const [despesasFixas, setDespesasFixas] = useState<string>('');

  // Financial Fields
  const [entradasBancos, setEntradasBancos] = useState<string>('');
  const [entradasTesouraria, setEntradasTesouraria] = useState<string>('');
  const [totalSaidas, setTotalSaidas] = useState<string>('');
  const [estoque, setEstoque] = useState<string>('');
  const [inadimplenciaMensal, setInadimplenciaMensal] = useState<string>('');

  // Computed previews
  const recVal = parseNumberPtBr(receitaBruta);
  const cmvVal = parseNumberPtBr(cmv);
  const despesaVal = parseNumberPtBr(despesasFixas);

  const margemVal = recVal - cmvVal;
  const margemPct = recVal > 0 ? (margemVal / recVal) * 100 : 0;
  const resEcoVal = margemVal - despesaVal;
  const pontoEquilibrioVal = margemPct > 0 ? despesaVal / (margemPct / 100) : 0;

  const bancosVal = parseNumberPtBr(entradasBancos);
  const tesourariaVal = parseNumberPtBr(entradasTesouraria);
  const entradasTotalVal = bancosVal + tesourariaVal;
  const saidasVal = parseNumberPtBr(totalSaidas);
  const resFinVal = entradasTotalVal - saidasVal;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetModule === 'economic') {
      onSaveLaunch({
        targetModule: 'economic',
        year,
        monthKey,
        fieldValues: {
          receitaBruta: recVal,
          cmv: cmvVal,
          despesasFixas: despesaVal,
        },
      });
    } else {
      onSaveLaunch({
        targetModule: 'financial',
        year,
        monthKey,
        fieldValues: {
          entradasBancos: bancosVal,
          entradasTesouraria: tesourariaVal,
          totalSaidas: saidasVal,
          estoque: parseNumberPtBr(estoque),
          inadimplenciaMensal: parseNumberPtBr(inadimplenciaMensal),
        },
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D2A26]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-2xl shadow-lg text-[#2D2A26] overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-[#F9F7F2] border-b border-[#EAE6DF] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#2D2A26]">Novo Lançamento Manual de Resultados</h3>
              <p className="text-xs text-[#8B7D6B]">Atualização em tempo real dos relatórios DRE e Caixa</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#EAE6DF]/50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Module Selector */}
          <div className="grid grid-cols-2 gap-3 p-1 bg-[#F9F7F2] rounded-lg border border-[#EAE6DF]">
            <button
              type="button"
              onClick={() => setTargetModule('economic')}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                targetModule === 'economic'
                  ? 'bg-[#2D2A26] text-white shadow-xs'
                  : 'text-[#8B7D6B] hover:text-[#2D2A26]'
              }`}
            >
              Lançamento Econômico (DRE)
            </button>
            <button
              type="button"
              onClick={() => setTargetModule('financial')}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                targetModule === 'financial'
                  ? 'bg-[#2D2A26] text-white shadow-xs'
                  : 'text-[#8B7D6B] hover:text-[#2D2A26]'
              }`}
            >
              Lançamento Financeiro (Caixa)
            </button>
          </div>

          {/* Date Selector */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Ano Base</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Mês de Referência</label>
              <select
                value={monthKey}
                onChange={(e) => setMonthKey(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
              >
                {Object.entries(MONTH_NAMES).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Module Fields */}
          {targetModule === 'economic' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Receita Bruta (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 500.000,00"
                    value={receitaBruta}
                    onChange={(e) => setReceitaBruta(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">CMV - Custos (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 350.000,00"
                    value={cmv}
                    onChange={(e) => setCmv(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Despesas Fixas (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 120.000,00"
                    value={despesasFixas}
                    onChange={(e) => setDespesasFixas(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
              </div>

              {/* Automatic Calculation Preview Box */}
              <div className="p-4 rounded-lg bg-[#F9F7F2] border border-[#EAE6DF] text-xs space-y-2">
                <p className="font-bold text-[#C19A6B] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <Calculator className="w-4 h-4" />
                  Cálculo Automático DRE (Pré-visualização)
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#EAE6DF] font-mono text-[11px]">
                  <div>
                    <span className="text-[#8B7D6B] block text-[10px]">Margem Bruta:</span>
                    <span className="font-bold text-emerald-700">{formatCurrency(margemVal)}</span>
                  </div>
                  <div>
                    <span className="text-[#8B7D6B] block text-[10px]">Resultado Econômico:</span>
                    <span className={resEcoVal >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                      {formatCurrency(resEcoVal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#8B7D6B] block text-[10px]">Ponto de Equilíbrio:</span>
                    <span className="font-bold text-[#C19A6B]">{formatCurrency(pontoEquilibrioVal)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Entradas Bancos (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 400.000,00"
                    value={entradasBancos}
                    onChange={(e) => setEntradasBancos(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Entradas Tesouraria (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 50.000,00"
                    value={entradasTesouraria}
                    onChange={(e) => setEntradasTesouraria(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Total Saídas (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 420.000,00"
                    value={totalSaidas}
                    onChange={(e) => setTotalSaidas(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Nível de Estoque (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 3.100.000,00"
                    value={estoque}
                    onChange={(e) => setEstoque(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Inadimplência Mês (R$)</label>
                  <input
                    type="text"
                    placeholder="Ex: 50.000,00"
                    value={inadimplenciaMensal}
                    onChange={(e) => setInadimplenciaMensal(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
              </div>

              {/* Automatic Cashflow Calculation Box */}
              <div className="p-4 rounded-lg bg-[#F9F7F2] border border-[#EAE6DF] text-xs space-y-2">
                <p className="font-bold text-[#C19A6B] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <Calculator className="w-4 h-4" />
                  Cálculo Automático Caixa (Pré-visualização)
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#EAE6DF] font-mono text-[11px]">
                  <div>
                    <span className="text-[#8B7D6B] block text-[10px]">Total Entradas:</span>
                    <span className="font-bold text-emerald-700">{formatCurrency(entradasTotalVal)}</span>
                  </div>
                  <div>
                    <span className="text-[#8B7D6B] block text-[10px]">Resultado Financeiro Líquido:</span>
                    <span className={resFinVal >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                      {formatCurrency(resFinVal)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-[#EAE6DF]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#8B7D6B] hover:text-[#2D2A26]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4 text-[#C19A6B]" />
              <span>Confirmar Lançamento</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
