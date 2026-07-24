/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, FileText, Globe } from 'lucide-react';
import { MONTH_KEYS_LIST, MONTH_NAMES_FULL } from '../utils/exportUtils';

interface PdfExportMenuProps {
  selectedYear: number;
  currentMonthKey?: string;
  onExportGeral: () => void;
  onExportMensal: (monthKey: string) => void;
}

export const PdfExportMenu: React.FC<PdfExportMenuProps> = ({
  selectedYear,
  currentMonthKey = 'jan',
  onExportGeral,
  onExportMensal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showMonthGrid, setShowMonthGrid] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeMonthLabel = MONTH_NAMES_FULL[currentMonthKey] || currentMonthKey.toUpperCase();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowMonthGrid(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setShowMonthGrid(false);
        }}
        className="px-3.5 py-2 text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg transition-all flex items-center gap-1.5 shadow-xs"
      >
        <FileText className="w-4 h-4 text-red-600" />
        <span>Exportar PDF</span>
        <ChevronDown className={`w-3.5 h-3.5 text-red-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-72 rounded-xl shadow-lg bg-white border border-[#EAE6DF] ring-1 ring-black/5 z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-2 border-b border-[#EAE6DF]">
            <p className="text-[10px] font-black tracking-wider text-[#8B7D6B] uppercase">OPÇÕES DE RELATÓRIO PDF</p>
            <p className="text-xs font-bold text-[#2D2A26]">Exercício {selectedYear}</p>
          </div>

          {/* Opção 1: PDF Geral Anual */}
          <button
            onClick={() => {
              setIsOpen(false);
              onExportGeral();
            }}
            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-red-50/80 transition-colors flex items-start gap-2.5 group"
          >
            <div className="p-1.5 rounded-md bg-red-100 text-red-700 group-hover:bg-red-600 group-hover:text-white transition-colors">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#2D2A26] group-hover:text-red-700">PDF Geral (Ano Completo)</p>
              <p className="text-[10px] text-[#8B7D6B]">Consolidado dos 12 meses de {selectedYear}</p>
            </div>
          </button>

          {/* Opção 2: PDF do Mês Selecionado */}
          <button
            onClick={() => {
              setIsOpen(false);
              onExportMensal(currentMonthKey);
            }}
            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-red-50/80 transition-colors flex items-start gap-2.5 group border-t border-[#EAE6DF]/60"
          >
            <div className="p-1.5 rounded-md bg-amber-100 text-amber-800 group-hover:bg-[#C19A6B] group-hover:text-white transition-colors">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#2D2A26] group-hover:text-red-700">
                PDF Mensal ({activeMonthLabel})
              </p>
              <p className="text-[10px] text-[#8B7D6B]">Detalhamento completo do mês selecionado</p>
            </div>
          </button>

          {/* Opção 3: Selecionar Outro Mês */}
          {!showMonthGrid ? (
            <button
              onClick={() => setShowMonthGrid(true)}
              className="w-full text-left px-3 py-2 text-[11px] font-bold text-[#C19A6B] hover:bg-[#F9F7F2] rounded-lg transition-colors flex items-center justify-between border-t border-[#EAE6DF]"
            >
              <span>Escolher outro mês...</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="pt-2 border-t border-[#EAE6DF]">
              <p className="text-[10px] font-bold text-[#8B7D6B] px-3 mb-1.5">SELECIONE O MÊS:</p>
              <div className="grid grid-cols-3 gap-1 px-1">
                {MONTH_KEYS_LIST.map((mKey) => (
                  <button
                    key={mKey}
                    onClick={() => {
                      setIsOpen(false);
                      setShowMonthGrid(false);
                      onExportMensal(mKey);
                    }}
                    className={`py-1.5 px-2 text-[11px] font-bold rounded text-center transition-colors ${
                      mKey === currentMonthKey
                        ? 'bg-[#C19A6B] text-white'
                        : 'bg-[#F9F7F2] text-[#433E37] hover:bg-red-100 hover:text-red-800'
                    }`}
                  >
                    {mKey.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
