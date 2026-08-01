/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EditEconomicModal — edição e exclusão de um mês do Resultado Econômico (DRE)
 */

import React, { useState, useEffect } from 'react';
import { Calculator, CheckCircle2, Trash2, X, AlertTriangle } from 'lucide-react';
import { EconomicMonthData } from '../types';
import { MONTH_NAMES } from '../data/initialData';
import { formatCurrency, parseNumberPtBr } from '../utils/exportUtils';

interface EditEconomicModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthKey: string;
  selectedYear: number;
  currentData: EconomicMonthData | null;
  onSave: (monthKey: string, year: number, fieldValues: Record<string, number>) => void;
  onDelete: (monthKey: string, year: number) => void;
}

export const EditEconomicModal: React.FC<EditEconomicModalProps> = ({
  isOpen,
  onClose,
  monthKey,
  selectedYear,
  currentData,
  onSave,
  onDelete,
}) => {
  if (!isOpen || !currentData) return null;

  const monthLabel = MONTH_NAMES[monthKey] || monthKey.toUpperCase();

  const fmt = (val: number | undefined) =>
    val ? val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

  const [receitaBruta, setReceitaBruta] = useState(fmt(currentData.receitaBruta));
  const [cmv, setCmv] = useState(fmt(currentData.cmv));
  const [despesasFixas, setDespesasFixas] = useState(fmt(currentData.despesasFixas));
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setReceitaBruta(fmt(currentData.receitaBruta));
    setCmv(fmt(currentData.cmv));
    setDespesasFixas(fmt(currentData.despesasFixas));
    setConfirmDelete(false);
  }, [monthKey, currentData]);

  // Pré-visualização dos cálculos DRE
  const recVal = parseNumberPtBr(receitaBruta);
  const cmvVal = parseNumberPtBr(cmv);
  const despesaVal = parseNumberPtBr(despesasFixas);

  const margemVal = recVal - cmvVal;
  const margemPct = recVal > 0 ? (margemVal / recVal) * 100 : 0;
  const resEcoVal = margemVal - despesaVal;
  const resEcoPct = recVal > 0 ? (resEcoVal / recVal) * 100 : 0;
  const pontoEquilibrioVal = margemPct > 0 ? despesaVal / (margemPct / 100) : 0;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(monthKey, selectedYear, {
      receitaBruta: recVal,
      cmv: cmvVal,
      despesasFixas: despesaVal,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete(monthKey, selectedYear);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D2A26]/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-2xl shadow-xl text-[#2D2A26] overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-[#F9F7F2] border-b border-[#EAE6DF] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#2D2A26]">
              Editar Resultado Econômico — {monthLabel} / {selectedYear}
            </h3>
            <p className="text-xs text-[#8B7D6B] mt-0.5">
              Altere os valores de Receita, CMV e Despesas. Os totais e DRE são recalculados automaticamente.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#EAE6DF]/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Campos principais */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Receita Bruta (R$)</label>
              <input
                type="text"
                value={receitaBruta}
                onChange={(e) => setReceitaBruta(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                placeholder="Ex: 500.000,00"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">CMV - Custos (R$)</label>
              <input
                type="text"
                value={cmv}
                onChange={(e) => setCmv(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                placeholder="Ex: 350.000,00"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Despesas Fixas (R$)</label>
              <input
                type="text"
                value={despesasFixas}
                onChange={(e) => setDespesasFixas(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                placeholder="Ex: 120.000,00"
              />
            </div>
          </div>

          {/* Pré-visualização calculada DRE */}
          <div className="p-4 rounded-lg bg-[#F9F7F2] border border-[#EAE6DF] text-xs space-y-2">
            <p className="font-bold text-[#C19A6B] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Calculator className="w-4 h-4" />
              Cálculo Automático DRE (Pré-visualização)
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#EAE6DF] font-mono text-[11px]">
              <div>
                <span className="text-[#8B7D6B] block text-[10px]">Margem Bruta:</span>
                <span className="font-bold text-emerald-700">
                  {formatCurrency(margemVal)} ({margemPct.toFixed(2).replace('.', ',')}%)
                </span>
              </div>
              <div>
                <span className="text-[#8B7D6B] block text-[10px]">Resultado Econômico:</span>
                <span className={resEcoVal >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                  {formatCurrency(resEcoVal)} ({resEcoPct.toFixed(2).replace('.', ',')}%)
                </span>
              </div>
              <div>
                <span className="text-[#8B7D6B] block text-[10px]">Ponto de Equilíbrio:</span>
                <span className="font-bold text-[#C19A6B]">{formatCurrency(pontoEquilibrioVal)}</span>
              </div>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-between pt-2 border-t border-[#EAE6DF]">
            <button
              type="button"
              onClick={handleDelete}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                confirmDelete
                  ? 'bg-rose-600 text-white hover:bg-rose-700 animate-pulse'
                  : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              {confirmDelete ? 'Confirmar Exclusão?' : 'Excluir Mês'}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onClose();
                }}
                className="px-4 py-2 text-xs font-semibold text-[#8B7D6B] hover:text-[#2D2A26] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-sm transition-all flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4 text-[#C19A6B]" />
                Salvar Alterações
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
