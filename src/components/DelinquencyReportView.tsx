/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
} from 'lucide-react';
import { Customer, DelinquentTitle } from '../types';
import { exportReportToExcel, exportReportToPdf, formatCurrency } from '../utils/exportUtils';

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
}) => {
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

    const payload: Omit<DelinquentTitle, 'id'> = {
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

  const totalDelinquent = titles.reduce((acc, t) => acc + t.updatedAmount, 0);
  const uniqueCustomersCount = new Set(titles.map((t) => t.customerCode)).size;
  const averageTicket = titles.length > 0 ? totalDelinquent / titles.length : 0;

  // Lista de vendedores únicos presentes nos títulos
  const uniqueSellers = Array.from(
    new Set(titles.map((t) => t.sellerName).filter(Boolean))
  );

  const agingBuckets = {
    '1-30': titles.filter((t) => t.agingBucket === '1-30').reduce((a, b) => a + b.updatedAmount, 0),
    '31-60': titles.filter((t) => t.agingBucket === '31-60').reduce((a, b) => a + b.updatedAmount, 0),
    '61-90': titles.filter((t) => t.agingBucket === '61-90').reduce((a, b) => a + b.updatedAmount, 0),
    '>90': titles.filter((t) => t.agingBucket === '>90').reduce((a, b) => a + b.updatedAmount, 0),
  };

  const filteredTitles = titles.filter((t) => {
    const matchesStatus = statusFilter === 'all' || t.collectionStatus === statusFilter;
    const matchesAging = agingFilter === 'all' || t.agingBucket === agingFilter;
    const matchesSeller = sellerFilter === 'all' || t.sellerName === sellerFilter;
    const matchesSearch =
      searchQuery === '' ||
      (t.customerCode && t.customerCode.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.customerName && t.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.sellerName && t.sellerName.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesAging && matchesSeller && matchesSearch;
  });

  const handleExportPdf = () => {
    const headers = [
      'Código Cliente',
      'Nº Título',
      'Cliente',
      'CNPJ / CPF',
      'Vencimento',
      'Dias Atraso',
      'Valor Original',
      'Valor Atualizado',
      'Status Cobrança',
    ];

    const rows = filteredTitles.map((t) => [
      t.customerCode || '',
      t.titleNumber,
      t.customerName,
      t.cnpjCpf,
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
      'Código Cliente': t.customerCode,
      'Nº Título': t.titleNumber,
      Cliente: t.customerName,
      CNPJ: t.cnpjCpf,
      Emissão: t.issueDate,
      Vencimento: t.dueDate,
      'Dias em Atraso': t.daysOverdue,
      'Faixa Aging': t.agingBucket,
      'Valor Original': t.originalAmount,
      'Valor Atualizado': t.updatedAmount,
      'Status Cobrança': t.collectionStatus,
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
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Relatório Detalhado de Inadimplência e Cobrança</h2>
          <p className="text-xs text-[#8B7D6B]">
            Monitoramento de títulos vencidos, categorização por idade do débito (aging list) e histórico de ações de cobrança.
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

      {/* Delinquent Titles Table */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
              <tr>
                <th className="p-3">Código Cliente</th>
                <th className="p-3">Nº Título</th>
                <th className="p-3">Cliente / CNPJ</th>
                <th className="p-3">Vendedor Responsável</th>
                <th className="p-3">Emissão / Vencimento</th>
                <th className="p-3 text-center">Dias Atraso</th>
                <th className="p-3 text-right">Valor Original</th>
                <th className="p-3 text-right">Valor Atualizado (Juros/Multa)</th>
                <th className="p-3 text-center">Status Cobrança</th>
                <th className="p-3">Observações de Campo</th>
                <th className="p-3 text-center whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {filteredTitles.map((t) => (
                <tr key={t.id} className="hover:bg-[#FDFBF7] transition-colors">
                  <td className="p-3 font-mono font-bold text-[#C19A6B]">{t.customerCode}</td>
                  <td className="p-3 font-mono font-bold text-[#2D2A26]">{t.titleNumber}</td>
                  <td className="p-3">
                    <p className="font-bold text-[#2D2A26]">{t.customerName}</p>
                    <p className="text-[10px] text-[#8B7D6B] font-mono">{t.cnpjCpf}</p>
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
                  <td className="p-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center space-x-1.5">
                      <button
                        onClick={() => setDetailsTitle(t)}
                        title="Ver Detalhes do Título"
                        className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#2D2A26] text-[#433E37] hover:text-white transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
                  cod_cliente: {detailsTitle.customerCode || '—'} • Título {detailsTitle.titleNumber}
                  {detailsTitle.parcela ? `/${detailsTitle.parcela}` : ''}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  ['CNPJ / CPF', detailsTitle.cnpjCpf],
                  ['Vendedor', detailsTitle.sellerName],
                  ['Emissão', detailsTitle.issueDate],
                  ['Vencimento', detailsTitle.dueDate],
                  ['Faixa Aging', detailsTitle.agingBucket],
                  ['Status Cobrança', detailsTitle.collectionStatus],
                  ['Juros', detailsTitle.juros ? formatCurrency(detailsTitle.juros) : '—'],
                  ['Multa', detailsTitle.multa ? formatCurrency(detailsTitle.multa) : '—'],
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
