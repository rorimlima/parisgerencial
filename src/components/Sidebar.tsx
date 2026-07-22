/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  BarChart3,
  Code2,
  Database,
  DollarSign,
  FileSpreadsheet,
  LayoutDashboard,
  PlusCircle,
  Users,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import { ViewTab } from '../types';

export type ActiveTab = ViewTab | 'launch';

interface SidebarProps {
  activeTab: ViewTab;
  onTabChange?: (tab: ViewTab) => void;
  setActiveTab?: (tab: ViewTab) => void;
  isOpen?: boolean;
  setIsOpen?: (open: boolean) => void;
  userRole: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  setActiveTab,
  userRole,
}) => {
  const handleSelect = (tab: ViewTab) => {
    if (onTabChange) onTabChange(tab);
    if (setActiveTab) setActiveTab(tab);
  };

  const menuItems = [
    {
      id: 'dashboard' as ViewTab,
      label: 'Visão Geral & KPIs',
      icon: LayoutDashboard,
      description: 'Painel executivo em tempo real',
    },
    {
      id: 'economic' as ViewTab,
      label: 'Resultado Econômico (DRE)',
      icon: BarChart3,
      description: 'Receita, CMV, Margem e Ponto de Equilíbrio',
    },
    {
      id: 'financial' as ViewTab,
      label: 'Resultado Financeiro',
      icon: DollarSign,
      description: 'Fluxo de caixa, entradas, saídas e estoque',
    },
    {
      id: 'import' as ViewTab,
      label: 'Importação Excel / CSV',
      icon: FileSpreadsheet,
      description: 'Validação e carga de planilhas',
      hideForAnalyst: true,
    },
    {
      id: 'customers' as ViewTab,
      label: 'Cadastro de Clientes',
      icon: Users,
      description: 'Gestão de carteira e limites de crédito',
    },
    {
      id: 'delinquency' as ViewTab,
      label: 'Relatório de Inadimplência',
      icon: AlertTriangle,
      description: 'Títulos vencidos, aging list e cobrança',
      badge: 'Crítico',
    },
    {
      id: 'api-docs' as ViewTab,
      label: 'Integração API Contábil',
      icon: Code2,
      description: 'Tokens e endpoints para sistemas externos',
    },
    {
      id: 'postgres-settings' as ViewTab,
      label: 'PostgreSQL (parisgerencial)',
      icon: Database,
      description: 'Conexão e scripts DDL do banco',
    },
  ];

  return (
    <aside className="w-full md:w-64 bg-[#2D2A26] text-[#EAE6DF] border-r border-[#3F3B35] flex-shrink-0 min-h-screen p-4 flex flex-col justify-between shadow-xs">
      <div className="space-y-6">
        <div>
          <p className="px-3 text-[10px] font-bold text-[#C19A6B] uppercase tracking-[0.2em] mb-3">
            Módulos Gerenciais
          </p>
          <nav className="space-y-1.5">
            {menuItems
              .filter((item) => !(item.hideForAnalyst && userRole === 'analista'))
              .map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
                      isActive
                        ? 'bg-[#C19A6B] text-white shadow-xs font-bold'
                        : 'text-[#EAE6DF]/70 hover:text-white hover:bg-[#3F3B35]/70'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Icon
                        className={`w-4 h-4 ${
                          isActive ? 'text-white' : 'text-[#C19A6B]'
                        }`}
                      />
                      <div>
                        <p className="font-bold leading-tight">{item.label}</p>
                        <p
                          className={`text-[10px] font-normal line-clamp-1 ${
                            isActive ? 'text-white/80' : 'text-[#EAE6DF]/50'
                          }`}
                        >
                          {item.description}
                        </p>
                      </div>
                    </div>
                    {item.badge && (
                      <span
                        className={`px-1.5 py-0.5 text-[9px] font-extrabold rounded ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-red-500/20 text-red-300 border border-red-500/30'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
          </nav>
        </div>

        {/* Database Box */}
        <div className="p-3.5 rounded-xl bg-[#3F3B35]/50 border border-[#3F3B35] text-[#EAE6DF]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-[#C19A6B] flex items-center gap-1">
              <Database className="w-3.5 h-3.5" />
              Base PostgreSQL
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#C19A6B]/20 text-[#C19A6B] font-mono">
              parisgerencial
            </span>
          </div>
          <p className="text-[10px] text-[#EAE6DF]/60 leading-relaxed mb-2">
            Estrutura DRE, fluxo de caixa, títulos e clientes sincronizados.
          </p>
          <button
            onClick={() => handleSelect('postgres-settings')}
            className="w-full text-center text-[10px] font-semibold text-[#C19A6B] hover:underline flex items-center justify-center gap-1"
          >
            <span>Ver Parâmetros & DDL</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* System Footer Note */}
      <div className="pt-4 border-t border-[#3F3B35] text-[10px] text-[#EAE6DF]/50 text-center">
        <p className="font-semibold text-[#EAE6DF]/70">Paris Dakar Gerencial v2.5</p>
        <p>Sistema Corporativo Multi-função</p>
      </div>
    </aside>
  );
};

