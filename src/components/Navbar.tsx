/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  FileText,
  LogOut,
  PlusCircle,
  UserCheck,
  Menu,
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
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /**
   * Anos que efetivamente têm dados carregados. Vira atalho de um clique no
   * seletor. Sem isso o usuário precisa adivinhar em que ano estão os números
   * — foi exatamente o que aconteceu ao importar 2020–2026 com a tela parada
   * em 2024 e mostrando zero.
   */
  yearsWithData?: number[];
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
  activeTab,
  setActiveTab,
  isSidebarOpen,
  onToggleSidebar,
  yearsWithData = [],
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
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] transition-colors focus:outline-none"
              title={isSidebarOpen ? 'Recolher Menu' : 'Expandir Menu'}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
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
          <YearPicker
            selectedYear={selectedYear}
            onSelect={handleYearSelect}
            yearsWithData={yearsWithData}
          />

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
          {/* Seletor Rápido de Abas para Celular/Tablet */}
          {setActiveTab && (
            <div className="md:hidden">
              <select
                value={activeTab || 'dashboard'}
                onChange={(e) => setActiveTab(e.target.value as ViewTab)}
                className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-1.5 font-bold focus:outline-none focus:border-[#C19A6B]"
              >
                <optgroup label="Gerencial">
                  <option value="dashboard">Visão Geral &amp; KPIs</option>
                  <option value="economic">Resultado Econômico (DRE)</option>
                  <option value="financial">Resultado Financeiro</option>
                  <option value="cashflow">Fluxo de Caixa</option>
                </optgroup>
                <optgroup label="Operacional">
                  <option value="billing">Faturamento (RPR014)</option>
                  <option value="sales">Vendas de Produtos (RPR001)</option>
                  <option value="stock">Estoque / Lista de Preço</option>
                  <option value="statement">Extrato Financeiro (Bancos)</option>
                  <option value="payables">Contas a Pagar (RFN006)</option>
                  <option value="delinquency">Inadimplência</option>
                </optgroup>
                <optgroup label="Cadastros">
                  <option value="customers">Cadastro de Clientes</option>
                  <option value="sellers">Gestão de Vendedores</option>
                  <option value="users">Cadastro de Usuários &amp; Acessos</option>
                </optgroup>
                <optgroup label="Sistema">
                  <option value="import">Importação Excel / CSV</option>
                </optgroup>
              </select>
            </div>
          )}

          {/* Ano base no celular — mesmo controle, versão compacta */}
          <div className="md:hidden">
            <YearPicker
              selectedYear={selectedYear}
              onSelect={handleYearSelect}
              yearsWithData={yearsWithData}
              compact
            />
          </div>

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


/**
 * YearPicker — seletor do ano base.
 *
 * Substitui a régua fixa de quatro botões (2024–2027), que tinha dois defeitos
 * concretos: não alcançava o histórico real da empresa, que começa em 2020, e
 * não dava nenhuma pista de onde estavam os dados — o usuário importava seis
 * anos e continuava olhando um ano vazio sem saber por quê.
 *
 * O que este controle faz de diferente:
 *  • ACEITA DIGITAÇÃO. Quatro dígitos e Enter, sem procurar botão.
 *  • Setas ↑/↓ e os botões laterais andam de ano em ano, para quem prefere
 *    navegar do que digitar.
 *  • Lista os anos QUE TÊM DADOS como atalho, marcando-os com um ponto. É a
 *    resposta visual para "onde foi parar o que eu importei".
 *  • Valida na saída do campo, não a cada tecla: validar durante a digitação
 *    faria "2" virar 1900 antes de a pessoa terminar de escrever "2025".
 */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

const YearPicker: React.FC<{
  selectedYear: number;
  onSelect: (year: number) => void;
  yearsWithData?: number[];
  compact?: boolean;
}> = ({ selectedYear, onSelect, yearsWithData = [], compact = false }) => {
  const [draft, setDraft] = useState(String(selectedYear));
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // O campo é controlado por fora também: se outro módulo trocar o ano (a
  // importação leva a tela para o ano mais recente com movimento, por exemplo),
  // o texto tem que acompanhar.
  useEffect(() => { setDraft(String(selectedYear)); }, [selectedYear]);

  // Fecha a lista ao clicar fora — um dropdown que só fecha no próprio botão
  // fica pendurado sobre o conteúdo e atrapalha.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < YEAR_MIN || n > YEAR_MAX) {
      setDraft(String(selectedYear)); // entrada inválida: volta ao que era
      return;
    }
    if (n !== selectedYear) onSelect(n);
    setDraft(String(n));
  };

  const step = (delta: number) => {
    const n = Math.min(YEAR_MAX, Math.max(YEAR_MIN, selectedYear + delta));
    if (n !== selectedYear) onSelect(n);
  };

  // Sugestões: os anos com dados, mais uma janela em torno do ano atual, para
  // que o seletor continue útil antes da primeira importação.
  const suggestions = useMemo(() => {
    const now = new Date().getFullYear();
    const base = new Set<number>([...yearsWithData, now - 1, now, now + 1, selectedYear]);
    return [...base].filter((y) => y >= YEAR_MIN && y <= YEAR_MAX).sort((a, b) => b - a);
  }, [yearsWithData, selectedYear]);

  const hasData = (y: number) => yearsWithData.includes(y);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center bg-[#F3F1ED] p-1 rounded-lg border border-[#EAE6DF]">
        {!compact && (
          <span className="text-xs font-semibold text-[#8B7D6B] px-2 uppercase tracking-wider select-none">
            Ano Base:
          </span>
        )}
        <div className="flex items-center bg-white rounded-md border border-[#EAE6DF] overflow-hidden">
          <input
            type="text"
            inputMode="numeric"
            value={draft}
            maxLength={4}
            aria-label="Ano base"
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commit(draft); (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { setDraft(String(selectedYear)); (e.target as HTMLInputElement).blur(); }
              if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
              if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
            }}
            onFocus={(e) => e.target.select()}
            className="w-[4.2rem] px-2 py-1 text-xs font-extrabold text-center text-[#2D2A26] tabular-nums bg-transparent focus:outline-none focus:bg-[#C19A6B]/10"
          />
          <div className="flex flex-col border-l border-[#EAE6DF]">
            <button
              onClick={() => step(1)}
              title="Ano seguinte"
              className="px-1 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] leading-none"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              onClick={() => step(-1)}
              title="Ano anterior"
              className="px-1 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] leading-none border-t border-[#EAE6DF]"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        </div>
        <button
          onClick={() => setIsOpen((v) => !v)}
          title="Anos disponíveis"
          className={`ml-1 px-1.5 py-1 rounded-md transition-colors ${
            isOpen ? 'bg-[#C19A6B] text-white' : 'text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#EAE6DF]'
          }`}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute right-0 mt-1 z-50 w-52 rounded-lg border border-[#EAE6DF] bg-white shadow-lg p-1.5">
          <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#8B7D6B]">
            Ir para o ano
          </p>
          <div className="grid grid-cols-3 gap-1">
            {suggestions.map((y) => (
              <button
                key={y}
                onClick={() => { onSelect(y); setIsOpen(false); }}
                title={hasData(y) ? 'Tem dados importados' : 'Sem dados importados'}
                className={`relative px-2 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  y === selectedYear
                    ? 'bg-[#C19A6B] text-white'
                    : hasData(y)
                    ? 'text-[#2D2A26] hover:bg-[#F3F1ED]'
                    : 'text-[#8B7D6B]/60 hover:bg-[#F3F1ED]'
                }`}
              >
                {y}
                {hasData(y) && (
                  <span
                    className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
                      y === selectedYear ? 'bg-white' : 'bg-emerald-500'
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
          <p className="px-2 pt-2 pb-1 text-[9px] text-[#8B7D6B] leading-snug border-t border-[#F3F1ED] mt-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 align-middle" />
            ano com dados importados. Você também pode digitar o ano no campo e pressionar Enter.
          </p>
        </div>
      )}
    </div>
  );
};
