/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sidebar — navegação lateral fixa e compacta.
 *
 * O que mudou e por quê:
 *  • FIXA: a lateral não rola junto com o conteúdo (`sticky` + altura própria
 *    com rolagem interna). Antes, ao descer numa tabela longa, o menu sumia e
 *    era preciso voltar ao topo para trocar de módulo.
 *  • COMPACTA: cada item ocupa uma linha só. A descrição saiu da lista e virou
 *    `title` (tooltip nativo) — eram duas linhas por item, 12 itens, e o menu
 *    não cabia na tela sem rolagem.
 *  • AGRUPADA: quatro seções (Gerencial, Operacional, Cadastros, Sistema) para
 *    dar hierarquia a uma lista que já passou de dez módulos.
 *  • COLAPSÁVEL: botão recolhe para uma faixa de 64px só com ícones; o estado
 *    fica no localStorage, então o sistema abre do jeito que a pessoa deixou.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Boxes,
  Briefcase,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileSpreadsheet,
  Flame,
  Handshake,
  Landmark,
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
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

interface MenuItem {
  id: ViewTab;
  label: string;
  icon: React.ElementType;
  description: string;
  badge?: string;
  hideForAnalyst?: boolean;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const COLLAPSE_STORAGE_KEY = 'pdg.sidebar.collapsed';

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Gerencial',
    items: [
      { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard, description: 'Painel executivo e KPIs em tempo real' },
      { id: 'economic', label: 'Resultado Econômico', icon: BarChart3, description: 'DRE: receita, CMV, margem e ponto de equilíbrio' },
      { id: 'financial', label: 'Resultado Financeiro', icon: DollarSign, description: 'Entradas, saídas, estoque e inadimplência' },
      { id: 'cashflow', label: 'Fluxo de Caixa', icon: TrendingUp, description: 'Planejamento semanal previsto x realizado' },
      { id: 'daily', label: 'Movimento Diário', icon: Wallet, description: 'Caixa realizado dia a dia: recebimentos e pagamentos BAIXADOS, com data início/fim' },
    ],
  },
  {
    title: 'Operacional',
    items: [
      { id: 'tasks', label: 'Tarefas & Rotinas', icon: CheckSquare, description: 'Gerenciador de tarefas diárias, confirmações e ingestão de planilhas', badge: 'Novo' },
      { id: 'billing', label: 'Faturamento', icon: Receipt, description: 'Notas fiscais (RPR014) e risco por cliente' },
      { id: 'sales', label: 'CRM & Vendas de Produtos', icon: Flame, description: 'CRM comercial com Curva ABC, melhores produtos para venda, margem e auditoria', badge: 'CRM' },
      { id: 'stock', label: 'Estoque', icon: Boxes, description: 'Lista de preço (RPR053), capital parado e margem' },
      { id: 'statement', label: 'Extrato Financeiro', icon: Landmark, description: 'Conciliação bancária e caixa/tesouraria (Bradesco, PagBank e Caixa/Tesouraria)' },
      { id: 'receivables', label: 'Contas a Receber', icon: ArrowDownCircle, description: 'Títulos de entrada (RFN046): recebimento, aging de cobrança e baixa automática' },
      // Inadimplência ficou fora do menu até 07/2026 — o módulo existia e era
      // alcançável só por navegação interna, então na prática ninguém usava.
      { id: 'delinquency', label: 'Inadimplência & Negociação', icon: Handshake, description: 'Aging de títulos vencidos, régua de cobrança e acordos de renegociação com parcelamento' },
      { id: 'payables', label: 'Contas a Pagar', icon: ArrowUpCircle, description: 'Títulos de saída (RFN046): desembolso, previsão e baixa automática' },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { id: 'customers', label: 'Clientes', icon: Users, description: 'Carteira, limites de crédito e classificação' },
      { id: 'sellers', label: 'Vendedores', icon: Briefcase, description: 'Equipe comercial e vínculo de cobrança' },
      { id: 'users', label: 'Usuários & Acessos', icon: UserCheck, description: 'Cadastro de e-mails (Gmail) autorizados e perfis de acesso' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { id: 'import', label: 'Importação', icon: FileSpreadsheet, description: 'Validação e carga de planilhas Excel/CSV', hideForAnalyst: true },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  setActiveTab,
  isOpen = true,
  setIsOpen,
  userRole,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, isCollapsed ? '1' : '0');
    }
  }, [isCollapsed]);

  const handleSelect = useCallback(
    (tab: ViewTab) => {
      onTabChange?.(tab);
      setActiveTab?.(tab);
      // No celular a lateral é um overlay: escolher um módulo tem que fechá-la,
      // senão o conteúdo fica coberto.
      if (setIsOpen && typeof window !== 'undefined' && window.innerWidth < 768) {
        setIsOpen(false);
      }
    },
    [onTabChange, setActiveTab, setIsOpen]
  );

  const width = isCollapsed ? 'md:w-16' : 'md:w-60';

  return (
    <>
      {/* Fundo escurecido no celular */}
      {isOpen && setIsOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity" onClick={() => setIsOpen(false)} />
      )}

      <aside
        className={`bg-[#2D2A26] text-[#EAE6DF] border-r border-[#3F3B35] flex-shrink-0 flex flex-col z-40
          transition-[width,transform] duration-200 ease-out
          ${isOpen ? 'translate-x-0 w-60' : '-translate-x-full w-0 border-r-0 md:translate-x-0'}
          ${isOpen ? width : 'md:w-16'}
          fixed inset-y-0 left-0
          md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:translate-x-0
        `}
      >
        {/* Cabeçalho da lateral + botão de recolher (só no desktop) */}
        <div className="hidden md:flex items-center justify-between px-3 h-10 shrink-0 border-b border-[#3F3B35]/60">
          {!isCollapsed && (
            <span className="text-[9px] font-bold text-[#C19A6B] uppercase tracking-[0.18em]">Módulos</span>
          )}
          <button
            onClick={() => setIsCollapsed((v) => !v)}
            title={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`p-1 rounded text-[#EAE6DF]/50 hover:text-white hover:bg-[#3F3B35] transition-colors ${isCollapsed ? 'mx-auto' : ''}`}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Navegação — a rolagem acontece AQUI dentro, não na página */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2 space-y-3">
          {MENU_GROUPS.map((group) => {
            const items = group.items.filter((item) => !(item.hideForAnalyst && userRole === 'analista'));
            if (!items.length) return null;
            return (
              <div key={group.title}>
                {!isCollapsed ? (
                  <p className="px-2 text-[9px] font-bold text-[#EAE6DF]/35 uppercase tracking-[0.16em] mb-1">
                    {group.title}
                  </p>
                ) : (
                  <div className="mx-2 mb-1.5 border-t border-[#3F3B35]" />
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item.id)}
                        title={isCollapsed ? `${item.label} — ${item.description}` : item.description}
                        className={`w-full text-left rounded-md text-[11px] font-semibold flex items-center transition-colors relative group
                          ${isCollapsed ? 'justify-center px-0 py-2' : 'px-2.5 py-1.5 gap-2.5'}
                          ${isActive
                            ? 'bg-[#C19A6B] text-white font-bold'
                            : 'text-[#EAE6DF]/70 hover:text-white hover:bg-[#3F3B35]/70'}
                        `}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#C19A6B]'}`} />
                        {!isCollapsed && <span className="truncate flex-1">{item.label}</span>}
                        {item.badge && !isCollapsed && (
                          <span className={`px-1.5 py-px text-[9px] font-extrabold rounded ${
                            isActive ? 'bg-white/20 text-white' : 'bg-red-500/20 text-red-300 border border-red-500/30'
                          }`}>
                            {item.badge}
                          </span>
                        )}
                        {item.badge && isCollapsed && (
                          <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-red-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Rodapé */}
        <div className="shrink-0 px-2 py-2 border-t border-[#3F3B35] text-[9px] text-[#EAE6DF]/40 text-center">
          {isCollapsed ? (
            <p className="font-bold text-[#C19A6B]">v2.6</p>
          ) : (
            <>
              <p className="font-semibold text-[#EAE6DF]/60">Paris Dakar Gerencial v2.6</p>
              <p>Sistema Corporativo Multi-função</p>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
