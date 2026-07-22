/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Building2,
  Database,
  FileSpreadsheet,
  FileText,
  LogOut,
  PlusCircle,
  UserCheck,
} from 'lucide-react';
import { User, ViewTab } from '../types';

interface NavbarProps {
  currentUser: User;
  onLogout?: () => void;
  onOpenLaunchModal?: () => void;
  onOpenPostgresModal?: () => void;
  onOpenLoginModal?: () => void;
  selectedYear: number;
  onYearChange?: (year: number) => void;
  setSelectedYear?: (year: number) => void;
  dbConnected?: boolean;
  onExportPdfCurrent?: () => void;
  onExportExcelCurrent?: () => void;
  activeTab?: ViewTab;
  setActiveTab?: (tab: ViewTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  onLogout,
  onOpenLaunchModal,
  onOpenPostgresModal,
  onOpenLoginModal,
  selectedYear,
  onYearChange,
  setSelectedYear,
  dbConnected = true,
  onExportPdfCurrent,
  onExportExcelCurrent,
  setActiveTab,
}) => {
  const handleYearSelect = (y: number) => {
    if (onYearChange) onYearChange(y);
    if (setSelectedYear) setSelectedYear(y);
  };

  const handleOpenPostgres = () => {
    if (onOpenPostgresModal) onOpenPostgresModal();
    else if (setActiveTab) setActiveTab('postgres-settings');
  };

  const roleBadgeColor =
    currentUser.role === 'admin'
      ? 'bg-[#C19A6B]/15 text-[#C19A6B] border-[#C19A6B]/30'
      : currentUser.role === 'gestor'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-stone-100 text-stone-700 border-stone-200';

  const roleLabel =
    currentUser.role === 'admin' ? 'ADMINISTRADOR' : currentUser.role === 'gestor' ? 'GESTOR' : 'ANALISTA';

  return (
    <header className="bg-white border-b border-[#EAE6DF] text-[#433E37] sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-[#2D2A26] flex items-center justify-center shadow-xs border border-[#3F3B35]">
            <Building2 className="w-5 h-5 text-[#C19A6B]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-wider text-[#2D2A26] uppercase">
                PARIS DAKAR
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest bg-[#C19A6B] text-white shadow-xs">
                GERENCIAL
              </span>
            </div>
            <p className="text-[10px] text-[#8B7D6B] font-medium">Controle Financeiro & Econômico DRE</p>
          </div>
        </div>

        {/* Center Actions & Year Filter */}
        <div className="hidden md:flex items-center space-x-4">
          <div className="flex items-center bg-[#F3F1ED] p-1 rounded-lg border border-[#EAE6DF]">
            <span className="text-xs font-semibold text-[#8B7D6B] px-2 uppercase tracking-wider">Ano Base:</span>
            {[2024, 2025, 2026, 2027].map((y) => (
              <button
                key={y}
                onClick={() => handleYearSelect(y)}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  selectedYear === y
                    ? 'bg-[#C19A6B] text-white shadow-xs'
                    : 'text-[#433E37] hover:text-[#2D2A26] hover:bg-[#EAE6DF]'
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          {currentUser.role !== 'analista' && onOpenLaunchModal && (
            <button
              onClick={onOpenLaunchModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all active:scale-95"
            >
              <PlusCircle className="w-4 h-4 text-[#C19A6B]" />
              <span>Novo Lançamento</span>
            </button>
          )}

          {/* Quick Exports */}
          {(onExportPdfCurrent || onExportExcelCurrent) && (
            <div className="flex items-center space-x-1 border-l border-[#EAE6DF] pl-3">
              {onExportPdfCurrent && (
                <button
                  onClick={onExportPdfCurrent}
                  title="Exportar Visualização Atual em PDF"
                  className="p-1.5 rounded-lg text-[#8B7D6B] hover:text-red-700 hover:bg-[#F3F1ED] transition-colors"
                >
                  <FileText className="w-4 h-4" />
                </button>
              )}
              {onExportExcelCurrent && (
                <button
                  onClick={onExportExcelCurrent}
                  title="Exportar Visualização Atual em Excel (.xlsx)"
                  className="p-1.5 rounded-lg text-[#8B7D6B] hover:text-emerald-700 hover:bg-[#F3F1ED] transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Info & User Profile */}
        <div className="flex items-center space-x-3">
          {/* DB Indicator */}
          <button
            onClick={handleOpenPostgres}
            className={`hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              dbConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
            }`}
            title="Clique para configurar o Banco PostgreSQL (parisgerencial)"
          >
            <Database className="w-3.5 h-3.5" />
            <span>PG: parisgerencial</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dbConnected ? 'bg-emerald-600 animate-pulse' : 'bg-amber-600'
              }`}
            />
          </button>

          {/* User Badge & Logout */}
          <div className="flex items-center space-x-2 pl-2 border-l border-[#EAE6DF]">
            <div className="w-8 h-8 rounded-full bg-[#C19A6B] flex items-center justify-center text-white font-bold text-xs shadow-xs">
              {currentUser.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-8 h-8 rounded-full border border-[#EAE6DF] object-cover"
                />
              ) : (
                currentUser.name.substring(0, 2).toUpperCase()
              )}
            </div>
            <div className="hidden lg:block text-left">
              <p className="text-xs font-bold text-[#2D2A26] line-clamp-1">{currentUser.name}</p>
              <span className={`inline-block px-1.5 py-0.2 text-[9px] font-bold rounded border ${roleBadgeColor}`}>
                {roleLabel}
              </span>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sair do sistema"
                className="p-2 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
            {onOpenLoginModal && !onLogout && (
              <button
                onClick={onOpenLoginModal}
                title="Trocar usuário"
                className="p-2 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] rounded-lg transition-colors"
              >
                <UserCheck className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

