/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EditFinancialModal — edição e exclusão de um mês do Resultado Financeiro
 */

import React, { useState, useEffect } from 'react';
import { Calculator, CheckCircle2, Trash2, X, AlertTriangle } from 'lucide-react';
import { FinancialMonthData } from '../types';
import { MONTH_NAMES } from '../data/initialData';
import { formatCurrency, parseNumberPtBr } from '../utils/exportUtils';

interface EditFinancialModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthKey: string;
  selectedYear: number;
  currentData: FinancialMonthData | null;
  onSave: (monthKey: string, year: number, fieldValues: Record<string, number>) => void;
  onDelete: (monthKey: string, year: number) => void;
}

export const EditFinancialModal: React.FC<EditFinancialModalProps> = ({
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

  // Formata número como string com vírgula para o input
  const fmt = (val: number | undefined) =>
    val ? val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

  const [entradasBancos, setEntradasBancos] = useState(fmt(currentData.entradasBancos));
  const [entradasTesouraria, setEntradasTesouraria] = useState(fmt(currentData.entradasTesouraria));
  const [totalSaidas, setTotalSaidas] = useState(fmt(currentData.totalSaidas));
  const [estoque, setEstoque] = useState(fmt(currentData.estoque));
  const [inadimplenciaMensal, setInadimplenciaMensal] = useState(fmt(currentData.inadimplenciaMensal));
  const [inadimplenciaGeral, setInadimplenciaGeral] = useState(fmt(currentData.inadimplenciaGeral ?? 0));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sincroniza quando muda de mês
  useEffect(() => {
    setEntradasBancos(fmt(currentData.entradasBancos));
    setEntradasTesouraria(fmt(currentData.entradasTesouraria));
    setTotalSaidas(fmt(currentData.totalSaidas));
    setEstoque(fmt(currentData.estoque));
    setInadimplenciaMensal(fmt(currentData.inadimplenciaMensal));
    setInadimplenciaGeral(fmt(currentData.inadimplenciaGeral ?? 0));
    setConfirmDelete(false);
  }, [monthKey, currentData]);

  // Pré-visualização calculada
  const bancosVal = parseNumberPtBr(entradasBancos);
  const tesourariaVal = parseNumberPtBr(entradasTesouraria);
  const entradasTotalVal = bancosVal + tesourariaVal;
  const saidasVal = parseNumberPtBr(totalSaidas);
  const resFinVal = entradasTotalVal - saidasVal;
  const resFinPct = entradasTotalVal > 0 ? (resFinVal / entradasTotalVal) * 100 : 0;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(monthKey, selectedYear, {
      entradasBancos: bancosVal,
      entradasTesouraria: tesourariaVal,
      totalSaidas: saidasVal,
      estoque: parseNumberPtBr(estoque),
      inadimplenciaMensal: parseNumberPtBr(inadimplenciaMensal),
      inadimplenciaGeral: parseNumberPtBr(inadimplenciaGeral),
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
              Editar Lançamento — {monthLabel} / {selectedYear}
            </h3>
            <p className="text-xs text-[#8B7D6B] mt-0.5">
              Altere os campos e confirme. Os totais são recalculados automaticamente.
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

          {/* Entradas */}
          <div>
            <p className="text-[11px] font-extrabold text-emerald-700 uppercase tracking-wider mb-2">Entradas</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Entradas Bancos (R$)</label>
                <input
                  type="text"
                  value={entradasBancos}
                  onChange={(e) => setEntradasBancos(e.target.value)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-emerald-400 font-mono"
                  placeholder="Ex: 400.000,00"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Entradas Tesouraria (R$)</label>
                <input
                  type="text"
                  value={entradasTesouraria}
                  onChange={(e) => setEntradasTesouraria(e.target.value)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-emerald-400 font-mono"
                  placeholder="Ex: 50.000,00"
                />
              </div>
            </div>
          </div>

          {/* Saídas + Estoque + Inadimplências */}
          <div>
            <p className="text-[11px] font-extrabold text-rose-700 uppercase tracking-wider mb-2">Saídas & Indicadores</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Total Saídas (R$)</label>
                <input
                  type="text"
                  value={totalSaidas}
                  onChange={(e) => setTotalSaidas(e.target.value)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-rose-400 font-mono"
                  placeholder="Ex: 420.000,00"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Nível de Estoque (R$)</label>
                <input
                  type="text"
                  value={estoque}
                  onChange={(e) => setEstoque(e.target.value)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] font-mono"
                  placeholder="Ex: 3.100.000,00"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8B7D6B] mb-1">Inadimplência Mês (R$)</label>
                <input
                  type="text"
                  value={inadimplenciaMensal}
                  onChange={(e) => setInadimplenciaMensal(e.target.value)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-rose-300 font-mono"
                  placeholder="Ex: 50.000,00"
                />
              </div>
            </div>
          </div>

          {/* Inadimplência Geral */}
          <div>
            <label className="block text-[11px] font-semibold text-rose-700 mb-1">
              Inadimplência Geral (R$) — Saldo Total da Carteira
            </label>
            <input
              type="text"
              value={inadimplenciaGeral}
              onChange={(e) => setInadimplenciaGeral(e.target.value)}
              className="w-full bg-rose-50 border border-rose-200 rounded-lg p-2.5 text-xs text-rose-900 focus:outline-none focus:border-rose-400 font-mono"
              placeholder="Ex: 250.000,00"
            />
          </div>

          {/* Pré-visualização */}
          <div className="p-4 rounded-lg bg-[#F9F7F2] border border-[#EAE6DF] text-xs space-y-2">
            <p className="font-bold text-[#C19A6B] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Calculator className="w-4 h-4" />
              Pré-visualização Automática
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#EAE6DF] font-mono text-[11px]">
              <div>
                <span className="text-[#8B7D6B] block text-[10px]">Total Entradas:</span>
                <span className="font-bold text-emerald-700">{formatCurrency(entradasTotalVal)}</span>
              </div>
              <div>
                <span className="text-[#8B7D6B] block text-[10px]">Resultado Financeiro:</span>
                <span className={resFinVal >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                  {formatCurrency(resFinVal)}
                </span>
              </div>
              <div>
                <span className="text-[#8B7D6B] block text-[10px]">% Resultado:</span>
                <span className={resFinPct >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                  {resFinPct.toFixed(2).replace('.', ',')}%
                </span>
              </div>
            </div>
          </div>

          {/* Botões */}
          <div className="flex items-center justify-between pt-2 border-t border-[#EAE6DF]">
            {/* Excluir */}
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
