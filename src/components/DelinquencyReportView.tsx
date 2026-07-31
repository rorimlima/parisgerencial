/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  ShieldAlert,
  Search,
  Plus,
  Eye,
  Edit2,
  Trash2,
  X,
  Check,
  Calculator,
  RotateCcw,
  Handshake,
  ListChecks,
} from 'lucide-react';
import { Customer, DebtAgreement, DelinquentTitle } from '../types';
import { exportReportToExcel, exportReportToPdf, formatCurrency } from '../utils/exportUtils';
import { formatPhoneBr, toWhatsAppNumber } from '../utils/sheetParsers';
import { WhatsAppLink } from './WhatsAppLink';
import { NegotiationModal } from './NegotiationModal';
import { AgreementsPanel } from './AgreementsPanel';
import { recomputeAgreement } from '../utils/negotiation';

interface DelinquencyReportViewProps {
  titles: DelinquentTitle[];
  customers?: Customer[];
  selectedYear: number;
  onNavigateToImport?: () => void;
  onClearDelinquency?: () => void;
  onAddTitle?: (title: Omit<DelinquentTitle, 'id'>) => void;
  onUpdateTitle?: (id: string, title: Partial<DelinquentTitle>) => void;
  onDeleteTitle?: (id: string) => void;
  userRole?: string;
  // ─── Negociação ───────────────────────────────────────────────────────────
  agreements?: DebtAgreement[];
  onSaveAgreement?: (agreement: DebtAgreement) => void | Promise<void>;
  onDeleteAgreement?: (agreement: DebtAgreement) => void | Promise<void>;
  currentUserName?: string;
}

const STATUS_OPTIONS: DelinquentTitle['collectionStatus'][] = [
  'Aguardando', 'Em Cobrança', 'Acordo em Andamento', 'Negativado', 'Judicial',
];

const agingFromDays = (days: number): DelinquentTitle['agingBucket'] =>
  days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '>90';

const daysFromDue = (dueDate: string): number => {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24)));
};

const emptyForm = {
  titleNumber: '', parcela: '', customerCode: '', customerName: '', cnpjCpf: '',
  sellerName: '', issueDate: '', dueDate: '', originalAmount: '', updatedAmount: '',
  collectionStatus: 'Aguardando' as DelinquentTitle['collectionStatus'], notes: '',
  lancamento: '', customerPhone: '',
};

export const DelinquencyReportView: React.FC<DelinquencyReportViewProps> = ({
  titles,
  customers = [],
  selectedYear,
  onNavigateToImport,
  onClearDelinquency,
  onAddTitle,
  onUpdateTitle,
  onDeleteTitle,
  userRole,
  agreements = [],
  onSaveAgreement,
  onDeleteAgreement,
  currentUserName = '',
}) => {
  const [activeSection, setActiveSection] = useState<'titulos' | 'acordos'>('titulos');
  const [negotiationTitles, setNegotiationTitles] = useState<DelinquentTitle[] | null>(null);
  const [editingAgreement, setEditingAgreement] = useState<DebtAgreement | null>(null);
  const [selectedForNegotiation, setSelectedForNegotiation] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [agingFilter, setAgingFilter] = useState<string>('all');
  const [sellerFilter, setSellerFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  // CRUD state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState<DelinquentTitle | null>(null);
  const [detailsTitle, setDetailsTitle] = useState<DelinquentTitle | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const canEdit = userRole !== 'analista' && !!(onAddTitle || onUpdateTitle);

  // ─── Simulação Financeira de Juros e Multa ─────────────────────────────────
  // Convenção padrão de mercado para títulos vencidos (boletos/duplicatas):
  // multa fixa de 2% sobre o valor original + juros de mora de 1% ao mês,
  // aplicados pro-rata die (juros simples, não compostos) sobre os dias em
  // atraso. Os percentuais ficam editáveis para o financeiro poder ajustar
  // conforme a política de cobrança da empresa, e o cálculo é refeito ao vivo.
  const DEFAULT_MULTA_PERCENT = 2;
  const DEFAULT_JUROS_MENSAL_PERCENT = 1;

  const [multaPercent, setMultaPercent] = useState<number>(() => {
    const saved = Number(localStorage.getItem('pdg_multa_percent'));
    return saved > 0 ? saved : DEFAULT_MULTA_PERCENT;
  });
  const [jurosMensalPercent, setJurosMensalPercent] = useState<number>(() => {
    const saved = Number(localStorage.getItem('pdg_juros_mensal_percent'));
    return saved > 0 ? saved : DEFAULT_JUROS_MENSAL_PERCENT;
  });

  useEffect(() => {
    localStorage.setItem('pdg_multa_percent', String(multaPercent));
  }, [multaPercent]);
  useEffect(() => {
    localStorage.setItem('pdg_juros_mensal_percent', String(jurosMensalPercent));
  }, [jurosMensalPercent]);

  const jurosDiarioPercent = jurosMensalPercent / 30;

  // Valor Atualizado = Original + (Original × Multa%) + (Original × Juros dia% × Dias em Atraso)
  const simulateTitle = (t: DelinquentTitle) => {
    const dias = Math.max(0, t.daysOverdue || 0);
    const multaValor = t.originalAmount * (multaPercent / 100);
    const jurosValor = t.originalAmount * (jurosDiarioPercent / 100) * dias;
    return {
      multaValor,
      jurosValor,
      updatedAmount: t.originalAmount + multaValor + jurosValor,
    };
  };

  // Lista dos títulos com Juros/Multa/Valor Atualizado recalculados ao vivo
  // conforme os parâmetros acima — usada em todo o restante da tela (KPIs,
  // aging list, tabela e exportações) para que tudo fique consistente.
  const simulatedTitles = useMemo<DelinquentTitle[]>(
    () =>
      titles.map((t) => {
        const { multaValor, jurosValor, updatedAmount } = simulateTitle(t);
        return { ...t, multa: multaValor, juros: jurosValor, updatedAmount };
      }),
    [titles, multaPercent, jurosMensalPercent]
  );

  // ─── Negociação ────────────────────────────────────────────────────────────
  const canNegotiate = userRole !== 'analista' && !!onSaveAgreement;

  /**
   * Contagem de acordos quebrados, recalculada na leitura. Vira um badge na aba:
   * é a informação que precisa aparecer sem ninguém ir procurar, porque acordo
   * quebrado é dívida que voltou a envelhecer sem alarme.
   */
  const brokenAgreementsCount = useMemo(
    () => agreements.filter((a) => recomputeAgreement(a).status === 'Quebrado').length,
    [agreements]
  );

  /** Títulos do mesmo cliente ainda sem acordo — oferecidos para juntar na negociação. */
  const siblingTitlesOf = (anchor: DelinquentTitle) =>
    simulatedTitles.filter(
      (t) =>
        t.id !== anchor.id &&
        !t.agreementId &&
        ((anchor.cnpjCpf && t.cnpjCpf === anchor.cnpjCpf) ||
          (anchor.customerCode && t.customerCode === anchor.customerCode))
    );

  const openNegotiation = (anchor: DelinquentTitle) => {
    // Se o operador marcou vários títulos, negocia todos de uma vez — mas só os
    // do mesmo devedor: acordo que mistura CNPJ diferente não tem como ser assinado.
    const marked = simulatedTitles.filter(
      (t) => selectedForNegotiation.includes(t.id) && t.cnpjCpf === anchor.cnpjCpf
    );
    const base = marked.length > 1 ? marked : [anchor];
    setEditingAgreement(null);
    setNegotiationTitles(base);
  };

  const openAgreementEdit = (agreement: DebtAgreement) => {
    const linked = simulatedTitles.filter((t) => agreement.titleIds.includes(t.id));
    setEditingAgreement(agreement);
    setNegotiationTitles(linked.length ? linked : simulatedTitles.slice(0, 1));
  };

  const closeNegotiation = () => {
    setNegotiationTitles(null);
    setEditingAgreement(null);
    setSelectedForNegotiation([]);
  };

  const openAddForm = () => {
    setEditingTitle(null);
    setForm({ ...emptyForm });
    setIsFormOpen(true);
  };

  const openEditForm = (t: DelinquentTitle) => {
    setEditingTitle(t);
    setForm({
      titleNumber: t.titleNumber || '',
      parcela: t.parcela || '',
      customerCode: t.customerCode || '',
      customerName: t.customerName || '',
      cnpjCpf: t.cnpjCpf || '',
      sellerName: t.sellerName || '',
      issueDate: t.issueDate || '',
      dueDate: t.dueDate || '',
      originalAmount: String(t.originalAmount ?? ''),
      updatedAmount: String(t.updatedAmount ?? ''),
      collectionStatus: t.collectionStatus || 'Aguardando',
      notes: t.notes || '',
      lancamento: t.lancamento || '',
      customerPhone: t.customerPhone || '',
    });
    setIsFormOpen(true);
  };

  // Autopreenche nome/CNPJ ao digitar um cod_cliente existente
  const handleCodeBlur = () => {
    const match = customers.find((c) => c.code.toLowerCase() === form.customerCode.trim().toLowerCase());
    if (match) {
      setForm((f) => ({
        ...f,
        customerName: f.customerName || match.name,
        cnpjCpf: f.cnpjCpf || match.cnpjCpf,
      }));
    }
  };

  const handleSubmitTitle = (e: React.FormEvent) => {
    e.preventDefault();
    const originalAmount = parseFloat(form.originalAmount.replace(/\./g, '').replace(',', '.')) || 0;
    const updatedAmount = form.updatedAmount
      ? parseFloat(form.updatedAmount.replace(/\./g, '').replace(',', '.')) || originalAmount
      : originalAmount;
    const daysOverdue = daysFromDue(form.dueDate);

    // Editar um título importado não pode apagar o que veio do RFN029 (agente
    // cobrador, chassi, histórico...). Por isso o payload parte do título atual
    // e só sobrescreve o que o formulário realmente edita.
    const payload: Omit<DelinquentTitle, 'id'> = {
      ...(editingTitle ? (({ id, ...rest }) => rest)(editingTitle) : {}),
      titleNumber: form.titleNumber.trim() || `MAN-${Date.now()}`,
      parcela: form.parcela.trim(),
      customerId: editingTitle?.customerId || '',
      customerCode: form.customerCode.trim(),
      customerName: form.customerName.trim(),
      cnpjCpf: form.cnpjCpf.trim(),
      sellerName: form.sellerName.trim(),
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      originalAmount,
      updatedAmount,
      daysOverdue,
      agingBucket: agingFromDays(daysOverdue),
      collectionStatus: form.collectionStatus,
      notes: form.notes.trim(),
      lancamento: form.lancamento.trim(),
      customerPhone: form.customerPhone.trim(),
    };

    if (editingTitle && onUpdateTitle) {
      onUpdateTitle(editingTitle.id, payload);
    } else if (onAddTitle) {
      onAddTitle(payload);
    }
    setIsFormOpen(false);
  };

  const confirmDelete = (id: string) => {
    if (onDeleteTitle) onDeleteTitle(id);
    setDeleteConfirmId(null);
  };

  const totalDelinquent = simulatedTitles.reduce((acc, t) => acc + t.updatedAmount, 0);
  const uniqueCustomersCount = new Set(simulatedTitles.map((t) => t.customerCode)).size;
  const averageTicket = simulatedTitles.length > 0 ? totalDelinquent / simulatedTitles.length : 0;

  // Lista de vendedores únicos presentes nos títulos
  const uniqueSellers = Array.from(
    new Set(simulatedTitles.map((t) => t.sellerName).filter(Boolean))
  );

  const agingBuckets = {
    '1-30': simulatedTitles.filter((t) => t.agingBucket === '1-30').reduce((a, b) => a + b.updatedAmount, 0),
    '31-60': simulatedTitles.filter((t) => t.agingBucket === '31-60').reduce((a, b) => a + b.updatedAmount, 0),
    '61-90': simulatedTitles.filter((t) => t.agingBucket === '61-90').reduce((a, b) => a + b.updatedAmount, 0),
    '>90': simulatedTitles.filter((t) => t.agingBucket === '>90').reduce((a, b) => a + b.updatedAmount, 0),
  };

  const filteredTitles = simulatedTitles.filter((t) => {
    const matchesStatus = statusFilter === 'all' || t.collectionStatus === statusFilter;
    const matchesAging = agingFilter === 'all' || t.agingBucket === agingFilter;
    const matchesSeller = sellerFilter === 'all' || t.sellerName === sellerFilter;
    const matchesSearch =
      searchQuery === '' ||
      (t.customerCode && t.customerCode.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.customerName && t.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.sellerName && t.sellerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.titleNumber && t.titleNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.lancamento && t.lancamento.includes(searchQuery.trim())) ||
      // busca por telefone ignorando máscara: "88765430" acha "(85) 98876-5430"
      (t.customerPhone &&
        searchQuery.replace(/\D/g, '') !== '' &&
        t.customerPhone.replace(/\D/g, '').includes(searchQuery.replace(/\D/g, '')));
    return matchesStatus && matchesAging && matchesSeller && matchesSearch;
  });

  const handleExportPdf = () => {
    const headers = [
      'Lançamento',
      'Código Cliente',
      'Nº Título',
      'Cliente',
      'Telefone',
      'Vencimento',
      'Dias Atraso',
      'Valor Original',
      'Valor Atualizado',
      'Status Cobrança',
    ];

    const rows = filteredTitles.map((t) => [
      t.lancamento || '',
      t.customerCode || '',
      t.titleNumber,
      t.customerName,
      formatPhoneBr(t.customerPhone || ''),
      t.dueDate,
      `${t.daysOverdue} dias`,
      formatCurrency(t.originalAmount),
      formatCurrency(t.updatedAmount),
      t.collectionStatus,
    ]);

    exportReportToPdf({
      title: `RELATÓRIO DE INADIMPLÊNCIA E COBRANÇA - ${selectedYear}`,
      subtitle: `Detalhamento de Títulos Vencidos, Aging List e Ações de Cobrança — Paris Dakar Gerencial`,
      summaryCards: [
        { label: 'Inadimplência Total', value: formatCurrency(totalDelinquent) },
        { label: 'Aging 1-30 dias', value: formatCurrency(agingBuckets['1-30']) },
        { label: 'Aging 31-60 dias', value: formatCurrency(agingBuckets['31-60']) },
        { label: 'Aging >90 dias (Crítico)', value: formatCurrency(agingBuckets['>90']) },
      ],
      headers,
      rows,
      filename: `Relatorio_Inadimplencia_Paris_Dakar_${selectedYear}.pdf`,
    });
  };

  const handleExportExcel = () => {
    const excelData = filteredTitles.map((t) => ({
      Lançamento: t.lancamento || '',
      'Código Cliente': t.customerCode,
      'Nº Título': t.titleNumber,
      Parcela: t.parcela || '',
      Cliente: t.customerName,
      CNPJ: t.cnpjCpf,
      Telefone: formatPhoneBr(t.customerPhone || ''),
      WhatsApp: t.customerPhone ? `https://wa.me/${toWhatsAppNumber(t.customerPhone)}` : '',
      Empresa: t.companyName || '',
      Vendedor: t.sellerName || '',
      Emissão: t.issueDate,
      Vencimento: t.dueDate,
      'Dias em Atraso': t.daysOverdue,
      'Faixa Aging': t.agingBucket,
      'Valor Original': t.originalAmount,
      Juros: t.juros || 0,
      Multa: t.multa || 0,
      'Valor Atualizado': t.updatedAmount,
      'Agente Cobrador': t.collectionAgent || '',
      'Forma de Cobrança': t.paymentType || '',
      Departamento: t.department || '',
      'Nº Pedido': t.orderNumber || '',
      Chassi: t.chassi || '',
      'Status Cobrança': t.collectionStatus,
      'Última Ocorrência': t.occurrence || '',
      Observações: t.notes || '',
    }));

    exportReportToExcel(
      excelData,
      `INADIMPLENCIA_${selectedYear}`,
      `Relatorio_Inadimplencia_Paris_Dakar_${selectedYear}.xlsx`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-800 border border-rose-200">
              GESTAO DE RISCO
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Inadimplência, Cobrança e Negociação</h2>
          <p className="text-xs text-[#8B7D6B]">
            Monitoramento de títulos vencidos, categorização por idade do débito (aging list), acordos de
            renegociação e acompanhamento do cumprimento das parcelas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && onAddTitle && (
            <button
              onClick={openAddForm}
              className="px-3.5 py-2 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-[#C19A6B]" />
              <span>Novo Título</span>
            </button>
          )}

          {onClearDelinquency && (
            <button
              onClick={() => setIsClearConfirmOpen(true)}
              className="px-3.5 py-2 text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>Zerar Inadimplência</span>
            </button>
          )}

          {onNavigateToImport && (
            <button
              onClick={onNavigateToImport}
              className="px-3.5 py-2 text-xs font-bold bg-rose-700 hover:bg-rose-800 text-white rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4 text-white" />
              <span>Importar Inadimplência (Excel/CSV)</span>
            </button>
          )}

          <button
            onClick={handleExportPdf}
            className="px-3.5 py-2 text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg transition-all flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4 text-red-600" />
            <span>Exportar PDF</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="px-3.5 py-2 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Exportar Excel</span>
          </button>
        </div>
      </div>

      {/* Abas: Títulos vencidos × Acordos de negociação */}
      <div className="flex items-center gap-2 border-b border-[#EAE6DF]">
        <button
          onClick={() => setActiveSection('titulos')}
          className={`px-4 py-2.5 text-xs font-black flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
            activeSection === 'titulos'
              ? 'border-[#C19A6B] text-[#2D2A26]'
              : 'border-transparent text-[#8B7D6B] hover:text-[#2D2A26]'
          }`}
        >
          <ListChecks className="w-4 h-4" />
          Títulos Vencidos
          <span className="px-1.5 py-0.5 rounded bg-[#F3F1ED] text-[10px] font-mono">{titles.length}</span>
        </button>
        <button
          onClick={() => setActiveSection('acordos')}
          className={`px-4 py-2.5 text-xs font-black flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
            activeSection === 'acordos'
              ? 'border-[#C19A6B] text-[#2D2A26]'
              : 'border-transparent text-[#8B7D6B] hover:text-[#2D2A26]'
          }`}
        >
          <Handshake className="w-4 h-4" />
          Acordos de Negociação
          <span className="px-1.5 py-0.5 rounded bg-[#F3F1ED] text-[10px] font-mono">{agreements.length}</span>
          {brokenAgreementsCount > 0 && (
            <span
              title={`${brokenAgreementsCount} acordo(s) quebrado(s)`}
              className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-black border border-rose-200"
            >
              {brokenAgreementsCount} quebrado{brokenAgreementsCount > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </div>

      {activeSection === 'acordos' ? (
        <AgreementsPanel
          agreements={agreements}
          canEdit={canNegotiate}
          canDelete={userRole === 'admin' || userRole === 'gestor'}
          onUpdate={async (a) => { if (onSaveAgreement) await onSaveAgreement(a); }}
          onEdit={openAgreementEdit}
          onDelete={async (a) => { if (onDeleteAgreement) await onDeleteAgreement(a); }}
        />
      ) : (
      <>

      {/* Simulação Financeira de Juros e Multa */}
      <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-center gap-2 lg:w-64 shrink-0">
            <Calculator className="w-4 h-4 text-[#C19A6B]" />
            <div>
              <p className="text-xs font-black text-[#2D2A26]">Simulação de Juros e Multa</p>
              <p className="text-[10px] text-[#8B7D6B]">Recalcula o Valor Atualizado com base nos dias em atraso</p>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap items-end gap-4">
            <div>
              <label className="block text-[10px] font-bold text-[#8B7D6B] mb-1 uppercase">Multa (%)</label>
              <input
                type="number" min={0} step="0.1"
                value={multaPercent}
                onChange={(e) => setMultaPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-28 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono font-bold focus:outline-none focus:border-[#C19A6B]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#8B7D6B] mb-1 uppercase">Juros de Mora (% ao mês)</label>
              <input
                type="number" min={0} step="0.1"
                value={jurosMensalPercent}
                onChange={(e) => setJurosMensalPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-28 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono font-bold focus:outline-none focus:border-[#C19A6B]"
              />
            </div>
            <div className="text-[10px] text-[#8B7D6B] font-mono bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 flex-1 min-w-[260px]">
              Pro-rata dia: <strong className="text-[#2D2A26]">{jurosDiarioPercent.toFixed(4)}% / dia</strong>
              {' • '}Fórmula: Original + (Original × Multa%) + (Original × Juros dia% × Dias Atraso)
            </div>
            <button
              type="button"
              onClick={() => {
                setMultaPercent(DEFAULT_MULTA_PERCENT);
                setJurosMensalPercent(DEFAULT_JUROS_MENSAL_PERCENT);
              }}
              title="Restaurar padrão de mercado (Multa 2% + Juros 1% a.m.)"
              className="px-3 py-2 text-xs font-bold bg-[#F3F1ED] hover:bg-[#2D2A26] text-[#433E37] hover:text-white rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Padrão</span>
            </button>
          </div>
        </div>
      </div>

      {/* Aging List KPI Boxes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[#C19A6B] uppercase">1 a 30 Dias Vencidos</span>
            <Clock className="w-4 h-4 text-[#C19A6B]" />
          </div>
          <p className="text-lg font-black text-[#2D2A26]">{formatCurrency(agingBuckets['1-30'])}</p>
          <span className="text-[10px] text-[#8B7D6B]">Notificação amigável e cobrança preventiva</span>
        </div>

        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-[#C19A6B] uppercase">31 a 60 Dias Vencidos</span>
            <Clock className="w-4 h-4 text-[#C19A6B]" />
          </div>
          <p className="text-lg font-black text-[#2D2A26]">{formatCurrency(agingBuckets['31-60'])}</p>
          <span className="text-[10px] text-[#8B7D6B]">Negociação de acordo e suspensão de crédito</span>
        </div>

        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-rose-700 uppercase">61 a 90 Dias Vencidos</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-lg font-black text-rose-700">{formatCurrency(agingBuckets['61-90'])}</p>
          <span className="text-[10px] text-[#8B7D6B]">Encaminhamento ao cartório e órgãos de proteção</span>
        </div>

        <div className="bg-rose-50/40 border border-rose-200 p-4 rounded-xl shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-rose-800 uppercase">Mais de 90 Dias (Crítico)</span>
            <ShieldAlert className="w-4 h-4 text-rose-700" />
          </div>
          <p className="text-lg font-black text-rose-800">{formatCurrency(agingBuckets['>90'])}</p>
          <span className="text-[10px] text-rose-700">Ação judicial de execução e protesto efetuado</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs flex flex-col justify-center">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase mb-1">Total de Títulos</span>
          <p className="text-lg font-black text-[#2D2A26]">{titles.length}</p>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs flex flex-col justify-center">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase mb-1">Clientes Inadimplentes</span>
          <p className="text-lg font-black text-[#2D2A26]">{uniqueCustomersCount}</p>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs flex flex-col justify-center">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase mb-1">Ticket Médio de Atraso</span>
          <p className="text-lg font-black text-[#2D2A26]">{formatCurrency(averageTicket)}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
        {/* Search */}
        <div className="relative w-full md:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="w-4 h-4 text-[#8B7D6B]" />
          </div>
          <input
            type="text"
            placeholder="Buscar por cliente, vendedor ou código..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg pl-9 pr-3 py-2.5 font-medium focus:outline-none focus:border-[#C19A6B]"
          />
        </div>

        {/* Status, Aging and Seller Filters */}
        <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4 w-full md:w-auto">
          {uniqueSellers.length > 0 && (
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <span className="text-xs font-bold text-[#2D2A26] whitespace-nowrap">Vendedor:</span>
              <select
                value={sellerFilter}
                onChange={(e) => setSellerFilter(e.target.value)}
                className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2 font-medium focus:outline-none focus:border-[#C19A6B] w-full sm:w-auto"
              >
                <option value="all">Todos os Vendedores</option>
                {uniqueSellers.map((seller) => (
                  <option key={seller} value={seller}>
                    {seller}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-[#C19A6B] hidden sm:block" />
            <span className="text-xs font-bold text-[#2D2A26] whitespace-nowrap">Faixa de Atraso:</span>
            <select
              value={agingFilter}
              onChange={(e) => setAgingFilter(e.target.value)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2 font-medium focus:outline-none focus:border-[#C19A6B] w-full sm:w-auto"
            >
              <option value="all">Todas as Faixas</option>
              <option value="1-30">1 a 30 Dias</option>
              <option value="31-60">31 a 60 Dias</option>
              <option value="61-90">61 a 90 Dias</option>
              <option value=">90">Mais de 90 Dias</option>
            </select>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <span className="text-xs font-bold text-[#2D2A26] whitespace-nowrap">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2 font-medium focus:outline-none focus:border-[#C19A6B] w-full sm:w-auto"
            >
              <option value="all">Todos os Status</option>
              <option value="Em Cobrança">Em Cobrança</option>
              <option value="Acordo em Andamento">Acordo em Andamento</option>
              <option value="Negativado">Negativado</option>
              <option value="Aguardando">Aguardando</option>
            </select>
          </div>
        </div>
      </div>

      {/* Barra de ação em bloco — negociar vários títulos do mesmo devedor */}
      {canNegotiate && selectedForNegotiation.length > 0 && (() => {
        const marked = simulatedTitles.filter((t) => selectedForNegotiation.includes(t.id));
        const devedores = new Set(marked.map((t) => t.cnpjCpf || t.customerCode));
        const total = marked.reduce((acc, t) => acc + (t.updatedAmount || 0), 0);
        const mesmoDevedor = devedores.size === 1;
        return (
          <div className="bg-[#2D2A26] text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <span className="font-black">{marked.length} título(s) marcado(s)</span>
              <span className="text-[#C19A6B] font-mono ml-2">{formatCurrency(total)}</span>
              {!mesmoDevedor && (
                <span className="block text-[10px] text-rose-300 mt-0.5">
                  Os títulos marcados pertencem a devedores diferentes. Um acordo cobre um único
                  devedor — desmarque os demais para prosseguir.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedForNegotiation([])}
                className="px-3 py-2 text-xs font-bold text-[#C4BCB0] hover:text-white"
              >
                Limpar seleção
              </button>
              <button
                onClick={() => openNegotiation(marked[0])}
                disabled={!mesmoDevedor}
                className="px-4 py-2 text-xs font-black bg-[#C19A6B] hover:bg-[#A8814F] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-1.5"
              >
                <Handshake className="w-4 h-4" /> Negociar em bloco
              </button>
            </div>
          </div>
        );
      })()}

      {/* Delinquent Titles Table */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
              <tr>
                {canNegotiate && <th className="p-3 w-8"></th>}
                <th className="p-3 text-center whitespace-nowrap">Ações</th>
                <th className="p-3">Lançamento</th>
                <th className="p-3">Cliente / CNPJ</th>
                <th className="p-3">Contato (WhatsApp)</th>
                <th className="p-3">Vendedor Responsável</th>
                <th className="p-3">Emissão / Vencimento</th>
                <th className="p-3 text-center">Dias Atraso</th>
                <th className="p-3 text-right">Valor Original</th>
                <th className="p-3 text-right">Valor Atualizado (Juros/Multa)</th>
                <th className="p-3 text-center">Status Cobrança</th>
                <th className="p-3">Observações de Campo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {filteredTitles.map((t) => (
                <tr
                  key={t.id}
                  className={`transition-colors ${
                    t.agreementId ? 'bg-[#C19A6B]/5 hover:bg-[#C19A6B]/10' : 'hover:bg-[#FDFBF7]'
                  }`}
                >
                  {canNegotiate && (
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedForNegotiation.includes(t.id)}
                        disabled={!!t.agreementId}
                        title={t.agreementId ? 'Título já vinculado a um acordo' : 'Marcar para negociar em bloco'}
                        onChange={() =>
                          setSelectedForNegotiation((prev) =>
                            prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                          )
                        }
                        className="accent-[#C19A6B] disabled:opacity-30"
                      />
                    </td>
                  )}
                  <td className="p-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center space-x-1.5">
                      <button
                        onClick={() => setDetailsTitle(t)}
                        title="Ver Detalhes do Título"
                        className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#2D2A26] text-[#433E37] hover:text-white transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {canNegotiate && !t.agreementId && (
                        <button
                          onClick={() => openNegotiation(t)}
                          title="Negociar dívida (acordo com parcelas)"
                          className="p-1.5 rounded-lg bg-[#C19A6B]/15 hover:bg-[#C19A6B] text-[#8B6B3D] hover:text-white transition-colors"
                        >
                          <Handshake className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {t.agreementId && (
                        <button
                          onClick={() => setActiveSection('acordos')}
                          title="Título já negociado — ver acordo"
                          className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white transition-colors"
                        >
                          <Handshake className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canEdit && onUpdateTitle && (
                        <button
                          onClick={() => openEditForm(t)}
                          title="Editar Título"
                          className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#C19A6B] text-[#433E37] hover:text-white transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {userRole !== 'analista' && onDeleteTitle && (
                        <button
                          onClick={() => setDeleteConfirmId(t.id)}
                          title="Excluir Título"
                          className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="p-3 font-mono text-[11px] text-[#8B7D6B]">
                    {t.lancamento || t.titleNumber || '-'}
                    {t.parcela && <span className="block text-[10px]">parc. {t.parcela}</span>}
                  </td>
                  <td className="p-3">
                    <p className="font-bold text-[#2D2A26]">{t.customerName}</p>
                    <p className="text-[10px] text-[#8B7D6B] font-mono">{t.cnpjCpf}</p>
                  </td>
                  <td className="p-3">
                    <WhatsAppLink phone={t.customerPhone} />
                  </td>
                  <td className="p-3 font-semibold text-[#2D2A26]">
                    {t.sellerName || <span className="text-[#8B7D6B] font-normal">-</span>}
                  </td>
                  <td className="p-3 font-mono">
                    <p className="text-[#433E37]">Venc: {t.dueDate}</p>
                    <p className="text-[10px] text-[#8B7D6B]">Emis: {t.issueDate}</p>
                  </td>
                  <td className="p-3 text-center font-mono">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                      {t.daysOverdue} dias
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-[#433E37]">{formatCurrency(t.originalAmount)}</td>
                  <td className="p-3 text-right font-mono font-bold text-rose-700">
                    {formatCurrency(t.updatedAmount)}
                  </td>
                  <td className="p-3 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
                      {t.collectionStatus}
                    </span>
                  </td>
                  <td className="p-3 text-[#8B7D6B] text-[11px] max-w-xs line-clamp-2">
                    {t.notes || 'Sem observações registradas'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </>
      )}

      {/* Modal: Negociação de Dívida */}
      {negotiationTitles && negotiationTitles.length > 0 && onSaveAgreement && (
        <NegotiationModal
          titles={negotiationTitles}
          siblingTitles={siblingTitlesOf(negotiationTitles[0])}
          customers={customers}
          penaltyPercent={multaPercent}
          monthlyInterestPercent={jurosMensalPercent}
          existingAgreements={agreements}
          currentUser={currentUserName}
          editing={editingAgreement}
          onClose={closeNegotiation}
          onSave={onSaveAgreement}
        />
      )}

      {/* Modal: Novo / Editar Título */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-2xl shadow-xl flex flex-col text-[#2D2A26]" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b border-[#EAE6DF] flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-600" />
                {editingTitle ? 'Editar Título Inadimplente' : 'Novo Título Inadimplente'}
              </h3>
              <button onClick={() => setIsFormOpen(false)} className="text-[#8B7D6B] hover:text-[#2D2A26]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <form id="title-form" onSubmit={handleSubmitTitle} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Cód. Cliente *</label>
                    <input
                      type="text" required list="cust-codes"
                      value={form.customerCode}
                      onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))}
                      onBlur={handleCodeBlur}
                      placeholder="cod_cliente"
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                    <datalist id="cust-codes">
                      {customers.slice(0, 500).map((c) => (
                        <option key={c.id} value={c.code}>{c.name}</option>
                      ))}
                    </datalist>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Cliente / Devedor *</label>
                    <input
                      type="text" required
                      value={form.customerName}
                      onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Nº Título</label>
                    <input
                      type="text"
                      value={form.titleNumber}
                      onChange={(e) => setForm((f) => ({ ...f, titleNumber: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Parcela</label>
                    <input
                      type="text"
                      value={form.parcela}
                      onChange={(e) => setForm((f) => ({ ...f, parcela: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">CNPJ / CPF</label>
                    <input
                      type="text"
                      value={form.cnpjCpf}
                      onChange={(e) => setForm((f) => ({ ...f, cnpjCpf: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Emissão</label>
                    <input
                      type="date"
                      value={form.issueDate}
                      onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Vencimento *</label>
                    <input
                      type="date" required
                      value={form.dueDate}
                      onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Vendedor</label>
                    <input
                      type="text"
                      value={form.sellerName}
                      onChange={(e) => setForm((f) => ({ ...f, sellerName: e.target.value }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Lançamento (ERP)</label>
                    <input
                      type="text"
                      value={form.lancamento}
                      onChange={(e) => setForm((f) => ({ ...f, lancamento: e.target.value }))}
                      placeholder="nº do lançamento"
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Telefone (WhatsApp)</label>
                    <input
                      type="text"
                      value={form.customerPhone}
                      onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                      placeholder="85 988765430"
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <WhatsAppLink phone={form.customerPhone} variant="button" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-rose-700 mb-1">Valor Original (R$) *</label>
                    <input
                      type="text" required
                      value={form.originalAmount}
                      onChange={(e) => setForm((f) => ({ ...f, originalAmount: e.target.value }))}
                      placeholder="0,00"
                      className="w-full bg-white border-2 border-rose-200 rounded-lg p-2.5 text-xs font-mono font-bold focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Valor Atualizado (R$)</label>
                    <input
                      type="text"
                      value={form.updatedAmount}
                      onChange={(e) => setForm((f) => ({ ...f, updatedAmount: e.target.value }))}
                      placeholder="Se vazio = valor original"
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Status Cobrança</label>
                    <select
                      value={form.collectionStatus}
                      onChange={(e) => setForm((f) => ({ ...f, collectionStatus: e.target.value as DelinquentTitle['collectionStatus'] }))}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-bold focus:outline-none focus:border-[#C19A6B]"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Observações</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
                  />
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-[#EAE6DF] flex items-center justify-end space-x-3 bg-[#F9F7F2] rounded-b-xl">
              <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]">
                Cancelar
              </button>
              <button type="submit" form="title-form" className="flex items-center space-x-1.5 px-5 py-2 text-xs font-bold bg-rose-700 hover:bg-rose-800 text-white rounded-lg shadow-xs transition-colors">
                <Check className="w-4 h-4" />
                <span>{editingTitle ? 'Salvar Alterações' : 'Adicionar Título'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detalhes do Título */}
      {detailsTitle && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-xl shadow-xl flex flex-col text-[#2D2A26]" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b border-[#EAE6DF] flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#C19A6B]" /> Detalhes do Título
              </h3>
              <button onClick={() => setDetailsTitle(null)} className="text-[#8B7D6B] hover:text-[#2D2A26]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <p className="text-lg font-black text-[#2D2A26]">{detailsTitle.customerName}</p>
                <p className="text-[11px] font-mono text-[#C19A6B]">
                  Cód. Cliente: {detailsTitle.customerCode || '—'} • Título {detailsTitle.titleNumber}
                  {detailsTitle.parcela ? `/${detailsTitle.parcela}` : ''}
                  {detailsTitle.lancamento ? ` • Lançamento ${detailsTitle.lancamento}` : ''}
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
                  <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Valor Original</p>
                  <p className="text-sm font-black text-[#2D2A26]">{formatCurrency(detailsTitle.originalAmount)}</p>
                </div>
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
                  <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Valor Atualizado</p>
                  <p className="text-sm font-black text-rose-700">{formatCurrency(detailsTitle.updatedAmount)}</p>
                </div>
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
                  <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Dias em Atraso</p>
                  <p className="text-sm font-black text-[#2D2A26]">{detailsTitle.daysOverdue} dias</p>
                </div>
              </div>
              {/* Contato de cobrança em destaque — é a primeira ação de quem abre o título */}
              <div className="flex flex-wrap items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <span className="text-[10px] font-bold text-emerald-800 uppercase">Contato do Devedor</span>
                <WhatsAppLink phone={detailsTitle.customerPhone} variant="button" />
                {detailsTitle.sellerPhone && (
                  <span className="text-[11px] text-emerald-900">
                    Vendedor {detailsTitle.sellerName}: <WhatsAppLink phone={detailsTitle.sellerPhone} />
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  ['Lançamento (ERP)', detailsTitle.lancamento],
                  ['Empresa', detailsTitle.companyName],
                  ['CNPJ / CPF', detailsTitle.cnpjCpf],
                  ['Vendedor', detailsTitle.sellerName],
                  ['Emissão', detailsTitle.issueDate],
                  ['Vencimento', detailsTitle.dueDate],
                  ['Faixa Aging', detailsTitle.agingBucket],
                  ['Status Cobrança', detailsTitle.collectionStatus],
                  ['Juros', detailsTitle.juros ? formatCurrency(detailsTitle.juros) : '—'],
                  ['Multa', detailsTitle.multa ? formatCurrency(detailsTitle.multa) : '—'],
                  ['Agente Cobrador', detailsTitle.collectionAgent],
                  ['Forma de Cobrança', detailsTitle.paymentType],
                  ['Tipo de Cobrança', detailsTitle.collectionTypeDescription],
                  ['Departamento', detailsTitle.department],
                  ['Nº Pedido', detailsTitle.orderNumber],
                  ['Chassi', detailsTitle.chassi],
                  ['Nota Fiscal', detailsTitle.invoiceNumber],
                  ['Endosso', detailsTitle.endossoName],
                  ['Última Movimentação', detailsTitle.occurrence],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex flex-col border-b border-dashed border-[#EAE6DF] pb-1">
                    <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">{label}</span>
                    <span className="text-[#2D2A26] font-medium">{(value as string) || '—'}</span>
                  </div>
                ))}
              </div>
              {detailsTitle.notes && (
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3 text-xs text-[#433E37]">
                  {detailsTitle.notes}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-[#EAE6DF] flex items-center justify-end gap-3 bg-[#F9F7F2] rounded-b-xl">
              {canEdit && onUpdateTitle && (
                <button
                  onClick={() => { const t = detailsTitle; setDetailsTitle(null); openEditForm(t); }}
                  className="px-4 py-2 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg flex items-center gap-1.5"
                >
                  <Edit2 className="w-4 h-4 text-[#C19A6B]" /> Editar
                </button>
              )}
              <button onClick={() => setDetailsTitle(null)} className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmação de Exclusão de Título */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Excluir Título?</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                O título será removido do banco e a dívida do cliente será recalculada automaticamente.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={() => confirmDelete(deleteConfirmId)} className="px-4 py-2 text-xs font-bold bg-rose-700 text-white rounded-lg hover:bg-rose-800">
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Zerar Inadimplência */}
      {isClearConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Zerar Inadimplência?</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                Esta ação limpará todos os títulos de inadimplência cadastrados para que você possa importar uma nova lista zerada.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={() => setIsClearConfirmOpen(false)}
                className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (onClearDelinquency) onClearDelinquency();
                  setIsClearConfirmOpen(false);
                }}
                className="px-4 py-2 text-xs font-bold bg-rose-700 text-white rounded-lg hover:bg-rose-800"
              >
                Sim, Zerar Dados
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
