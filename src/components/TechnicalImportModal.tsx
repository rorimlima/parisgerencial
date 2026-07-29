/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modal de Ingestão Técnica de Dados & Especificação DBA.
 * Exibe detalhes do arquivo, coleções impactadas no banco e fornece botão direto para importação.
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Database,
  FileSpreadsheet,
  HelpCircle,
  Info,
  Layers,
  Upload,
  X,
} from 'lucide-react';
import { TechnicalSpreadsheetSpec } from '../types';

interface TechnicalImportModalProps {
  spec: TechnicalSpreadsheetSpec | null;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToImport: (targetModule: 'economic' | 'financial' | 'customers' | 'delinquency' | 'sales') => void;
  onNavigateToModule: (targetTab: string) => void;
}

export const TechnicalImportModal: React.FC<TechnicalImportModalProps> = ({
  spec,
  isOpen,
  onClose,
  onNavigateToImport,
  onNavigateToModule,
}) => {
  if (!isOpen || !spec) return null;

  const handleOpenImportScreen = () => {
    onClose();
    // Mapeia o tipo de importação técnica para os módulos suportados pelo ImportDataView
    let mod: 'economic' | 'financial' | 'customers' | 'delinquency' | 'sales' = 'financial';
    if (spec.importActionType === 'sales') mod = 'sales';
    else if (spec.importActionType === 'economic') mod = 'economic';
    else if (spec.importActionType === 'delinquency') mod = 'delinquency';
    else if (spec.importActionType === 'titulos_pay' || spec.importActionType === 'titulos_rec' || spec.importActionType === 'statement') mod = 'financial';

    onNavigateToImport(mod);
  };

  const handleGoToModule = () => {
    onClose();
    onNavigateToModule(spec.targetModule);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#2D2A26] border border-[#3F3B35] text-[#EAE6DF] rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top bar */}
        <div className="px-6 py-4 border-b border-[#3F3B35] flex items-center justify-between bg-[#23201D]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#C19A6B]/20 text-[#C19A6B] rounded-lg">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#C19A6B] text-white rounded">
                  {spec.code}
                </span>
                <h3 className="text-base font-bold text-white">{spec.name}</h3>
              </div>
              <p className="text-xs text-[#EAE6DF]/60 mt-0.5">Especificação Técnica de Engenharia & Ingestão de Dados</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#EAE6DF]/50 hover:text-white hover:bg-[#3F3B35] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Descrição */}
          <div>
            <h4 className="text-xs font-bold text-[#C19A6B] uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-[#C19A6B]" />
              Descrição do Arquivo
            </h4>
            <p className="text-[#EAE6DF]/90 bg-[#23201D] p-3 rounded-lg border border-[#3F3B35]">
              {spec.description}
            </p>
          </div>

          {/* Impacto no Banco de Dados / Função DBA */}
          <div>
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-emerald-400" />
              Função Técnica & Coleção Impactada (DBA)
            </h4>
            <div className="bg-[#23201D] p-3 rounded-lg border border-[#3F3B35] space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#EAE6DF]/70">Coleção / Tabela Firestore:</span>
                <code className="bg-[#181614] text-amber-300 px-2 py-0.5 rounded font-mono text-[11px] border border-amber-500/20">
                  {spec.targetCollection}
                </code>
              </div>
              <p className="text-[#EAE6DF]/80 leading-relaxed">{spec.dbImpact}</p>
            </div>
          </div>

          {/* Colunas Esperadas */}
          <div>
            <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-sky-400" />
              Estrutura de Colunas Esperadas na Planilha
            </h4>
            <div className="grid grid-cols-2 gap-2 bg-[#23201D] p-3 rounded-lg border border-[#3F3B35]">
              {spec.expectedColumns.map((col, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[#EAE6DF]/80 font-mono text-[11px]">
                  <span className="w-4 h-4 rounded-full bg-[#3F3B35] text-white flex items-center justify-center text-[9px] font-bold">
                    {idx + 1}
                  </span>
                  <span>{col}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Exemplo de Nome de Arquivo */}
          <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span className="text-[11px] font-bold text-amber-300 block">Formato Recomendado do Arquivo:</span>
                <code className="text-[11px] text-amber-200 font-mono">{spec.sampleFilename}</code>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-[#3F3B35] bg-[#23201D] flex items-center justify-between gap-3">
          <button
            onClick={handleGoToModule}
            className="px-4 py-2 bg-[#3F3B35] hover:bg-[#4F4B45] text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
          >
            <span>Ir para Módulo {spec.code}</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[#3F3B35] hover:bg-[#3F3B35] text-[#EAE6DF]/80 rounded-lg text-xs font-semibold transition-colors"
            >
              Fechar
            </button>
            <button
              onClick={handleOpenImportScreen}
              className="px-4 py-2 bg-[#C19A6B] hover:bg-[#b0895a] text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shadow-lg"
            >
              <Upload className="w-4 h-4" />
              <span>Abrir Central de Importação</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
