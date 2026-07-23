/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PayablesView — "Contas a Pagar"
 *
 * Importa o relatório RFN006 (Totais Pagos por Credor) do ERP de origem: cada
 * linha é um pagamento já lançado (TituloMovCodigo é a chave única do
 * movimento). O credor (TituloPessoaCod) é vinculado ao cadastro de clientes
 * pelo cod_cliente — como ambos vêm do mesmo sistema de origem, os códigos
 * coincidem na maioria dos casos; quando não há correspondência, o vínculo
 * fica pendente e pode ser feito manualmente aqui.
 *
 * Conciliação (baixa): após importar, o sistema tenta casar automaticamente
 * cada título com um lançamento de saída já importado no Extrato Financeiro
 * (banco ou caixa/tesouraria) por valor exato + janela de data. O que não for
 * casado permanece "Em Aberto" para baixa manual pelo gestor.
 */

import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Link2,
  RefreshCcw,
  Search,
  Trash2,
  Undo2,
  UploadCloud,
  X,
} from 'lucide-react';
import { Customer, FinancialStatementEntry, PayableStatus, PayableTitle } from '../types';
import { exportReportToExcel, formatCurrency, parseNumberPtBr } from '../utils/exportUtils';

interface PayablesViewProps {
  payables: PayableTitle[];
  statementEntries: FinancialStatementEntry[];
  customers: Customer[];
  selectedYear: number;
  onImportPayables: (rows: RawPayableRow[]) => void;
  onReconcileNow: () => void;
  onManualBaixa: (id: string, notes?: string, statementEntryId?: string, statementSource?: string) => void;
  onRevertBaixa: (id: string) => void;
  onLinkSupplier: (payableId: string, customerId: string, customerCode: string) => void;
  onDeletePayable?: (id: string) => void;
  onClearPayables?: () => void;
  userRole: string;
}

export interface RawPayableRow {
  movCode: string;
  companyName: string;
  supplierCode: string;
  supplierName: string;
  titleCode: string;
  parcela: string;
  dueDate: string;
  paymentDate: string;
  description: string;
  payingAgent: string;
  department: string;
  amount: number;
}

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const normalizeDate = (raw: any): string => {
  if (!raw && raw !== 0) return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = raw.toString().trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return '';
};

// ── Parser RFN006 (Totais Pagos por Credor) ─────────────────────────────────
const parsePayablesRows = (rows: any[]): (RawPayableRow & { rowNumber: number; valid: boolean; errors: string[] })[] => {
  return rows.map((row, idx) => {
    const errors: string[] = [];

    const movCode = (row['TituloMovCodigo'] ?? '').toString().trim();
    const companyName = (row['TituloEmpresaNome'] ?? '').toString().trim();
    const supplierCode = (row['TituloPessoaCod'] ?? '').toString().trim();
    const supplierName = (row['TituloPessoaNome'] ?? '').toString().trim();
    const titleCode = (row['TituloCodigo'] ?? '').toString().trim();
    const parcela = (row['TituloNumeroParcela'] ?? '').toString().trim();
    const dueDate = normalizeDate(row['TituloDataVencto']);
    const paymentDate = normalizeDate(row['TitMovDataCaixa'] || row['TitDataMov']);
    const description = (row['TituloHistorico'] ?? '').toString().trim();
    const payingAgent = (row['TituloAgentePagadorDescr'] ?? '').toString().trim();
    const department = (row['Departamento_Descricao'] ?? '').toString().trim();
    const amount = Math.abs(parseNumberPtBr(row['TituloValor'] ?? 0));

    if (!movCode) errors.push('TituloMovCodigo (chave única) ausente');
    if (!supplierCode) errors.push('TituloPessoaCod (credor) ausente');
    if (!paymentDate) errors.push('Data de pagamento (TitMovDataCaixa) ausente ou inválida');
    if (amount <= 0) errors.push('Valor pago ausente ou inválido');

    return {
      rowNumber: idx + 1,
      movCode, companyName, supplierCode, supplierName, titleCode, parcela,
      dueDate, paymentDate, description, payingAgent, department, amount,
      valid: errors.length === 0,
      errors,
    };
  });
};

type PreviewRow = ReturnType<typeof parsePayablesRows>[number];

// ─── Componente ──────────────────────────────────────────────────────────────

export const PayablesView: React.FC<PayablesViewProps> = ({
  payables,
  statementEntries,
  customers,
  selectedYear,
  onImportPayables,
  onReconcileNow,
  onManualBaixa,
  onRevertBaixa,
  onLinkSupplier,
  onDeletePayable,
  onClearPayables,
  userRole,
}) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | PayableStatus>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Resetar página quando os filtros mudam
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, monthFilter, searchQuery]);

  const [detailsPayable, setDetailsPayable] = useState<PayableTitle | null>(null);
  const [baixaTarget, setBaixaTarget] = useState<PayableTitle | null>(null);
  const [baixaNotes, setBaixaNotes] = useState('');
  const [linkTarget, setLinkTarget] = useState<PayableTitle | null>(null);
  const [linkCode, setLinkCode] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isBaixaLoading, setIsBaixaLoading] = useState(false);

  // Estado do modal "Encontrar no Extrato"
  const [extratoSearchTarget, setExtratoSearchTarget] = useState<PayableTitle | null>(null);
  const [extratoSearchResults, setExtratoSearchResults] = useState<FinancialStatementEntry[]>([]);
  const [extratoSearchLoading, setExtratoSearchLoading] = useState(false);

  const canEdit = userRole !== 'analista';

  // ── Função: Encontrar no Extrato (±2 dias, valor exato na saída) ────────
  const searchExtratoForPayable = (target: PayableTitle) => {
    setExtratoSearchTarget(target);
    setExtratoSearchLoading(true);
    try {
      const payDate = new Date(target.paymentDate + 'T00:00:00');
      if (isNaN(payDate.getTime())) {
        setExtratoSearchResults([]);
        setExtratoSearchLoading(false);
        return;
      }
      // Janela: 2 dias antes até o dia presente (ou dia do pagamento, o que for maior)
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const startWindow = new Date(payDate);
      startWindow.setDate(startWindow.getDate() - 2);
      startWindow.setHours(0, 0, 0, 0);
      const endWindow = today > payDate ? today : payDate;

      const targetAmount = Math.round(target.amount * 100); // centavos para comparação exata

      const matches = statementEntries.filter((e) => {
        // Só entradas de saída (exit > 0)
        if (e.exitAmount <= 0) return false;
        // Comparar valor exato em centavos
        if (Math.round(e.exitAmount * 100) !== targetAmount) return false;
        // Verificar janela de data
        const entryDate = new Date(e.date + 'T00:00:00');
        if (isNaN(entryDate.getTime())) return false;
        return entryDate >= startWindow && entryDate <= endWindow;
      });

      // Ordena por proximidade de data ao pagamento
      matches.sort((a, b) => {
        const da = Math.abs(new Date(a.date).getTime() - payDate.getTime());
        const db = Math.abs(new Date(b.date).getTime() - payDate.getTime());
        return da - db;
      });

      setExtratoSearchResults(matches);
    } catch {
      setExtratoSearchResults([]);
    } finally {
      setExtratoSearchLoading(false);
    }
  };

  // ── Upload / Parse ────────────────────────────────────────────────────────

  const processFile = (file: File) => {
    setFileName(file.name);
    setIsProcessing(true);
    setImportSuccessMsg(null);
    setPreviewRows([]);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      alert('Envie a planilha RFN006 em formato .xlsx ou .xls.');
      setIsProcessing(false);
      setFileName(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
        setPreviewRows(parsePayablesRows(jsonRows));
      } catch (err: any) {
        alert(`Erro ao processar planilha de contas a pagar: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
      alert('Erro ao ler o arquivo.');
      setIsProcessing(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  };

  const validCount = previewRows.filter((r) => r.valid).length;
  const invalidCount = previewRows.filter((r) => !r.valid).length;
  const previewTotal = previewRows.filter((r) => r.valid).reduce((a, r) => a + r.amount, 0);
  const filteredPreview = previewRows.filter((r) => {
    if (previewFilter === 'valid') return r.valid;
    if (previewFilter === 'invalid') return !r.valid;
    return true;
  });

  const handleCommit = () => {
    const validRows = previewRows.filter((r) => r.valid);
    if (validRows.length === 0) {
      alert('Nenhum título válido para importar.');
      return;
    }
    onImportPayables(validRows);
    setImportSuccessMsg(
      `${validRows.length} título(s) de contas a pagar processado(s). Executando conciliação automática contra o Extrato Financeiro...`
    );
    setPreviewRows([]);
    setFileName(null);
  };

  // ── Filtros da tabela persistida ──────────────────────────────────────────

  const filteredPayables = useMemo(() => {
    return payables.filter((p) => {
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchesMonth = monthFilter === 'all' || p.monthKey === monthFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        p.supplierName.toLowerCase().includes(q) ||
        p.supplierCode.toLowerCase().includes(q) ||
        (p.movCode || '').toLowerCase().includes(q) ||
        (p.parcela || '').toLowerCase().includes(q);
      return matchesStatus && matchesMonth && matchesSearch;
    });
  }, [payables, statusFilter, monthFilter, searchQuery]);

  const paginatedPayables = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredPayables.slice(start, start + itemsPerPage);
  }, [filteredPayables, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredPayables.length / itemsPerPage);

  const totalPago = payables.reduce((a, p) => a + p.amount, 0);
  const emAberto = payables.filter((p) => p.status === 'Em Aberto');
  const baixadoAuto = payables.filter((p) => p.status === 'Baixado Automático');
  const baixadoManual = payables.filter((p) => p.status === 'Baixado Manual');

  const handleExportExcel = () => {
    const data = filteredPayables.map((p) => ({
      'Mov. Código': p.movCode,
      Credor: p.supplierName,
      'Cód. Credor': p.supplierCode,
      'Vinculado a Cliente': p.supplierCustomerId ? 'Sim' : 'Não',
      Parcela: p.parcela || '',
      Vencimento: p.dueDate,
      'Data Pagamento': p.paymentDate,
      Valor: p.amount,
      'Agente Pagador': p.payingAgent || '',
      Departamento: p.department || '',
      Status: p.status,
      'Fonte da Baixa': p.reconciledSource || '',
      Histórico: p.description || '',
    }));
    exportReportToExcel(data, `CONTAS_A_PAGAR_${selectedYear}`, `Contas_a_Pagar_Paris_Dakar_${selectedYear}.xlsx`);
  };

  const statusBadge = (status: PayableStatus) => {
    if (status === 'Em Aberto')
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">Em Aberto</span>;
    if (status === 'Baixado Automático')
      return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">Baixado Automático</span>;
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">Baixado Manual</span>;
  };

  const reconciledEntry = (p: PayableTitle | null) =>
    p?.reconciledStatementId ? statementEntries.find((e) => e.id === p.reconciledStatementId) : undefined;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              CONTAS A PAGAR
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Contas a Pagar & Conciliação de Baixas</h2>
          <p className="text-xs text-[#8B7D6B]">
            Importação do RFN006 (Totais Pagos por Credor), vínculo do credor (TituloPessoaCod) ao cadastro de
            clientes por cod_cliente, e baixa automática contra o Extrato Financeiro (banco e caixa/tesouraria).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onReconcileNow}
            className="px-3.5 py-2.5 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-1.5"
          >
            <RefreshCcw className="w-4 h-4 text-[#C19A6B]" />
            <span>Conciliar Automaticamente</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-2 border border-[#EAE6DF]"
          >
            <Download className="w-4 h-4 text-[#8B7D6B]" />
            <span>Exportar Excel</span>
          </button>
          {canEdit && onClearPayables && (
            <button
              onClick={() => setIsClearConfirmOpen(true)}
              className="px-3.5 py-2.5 text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>Zerar Base</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">Total Pago ({selectedYear})</span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(totalPago)}</p>
          <span className="text-[10px] text-[#8B7D6B]">{payables.length} título(s)</span>
        </div>
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Em Aberto</span>
          <p className="text-lg font-black text-amber-800 mt-1">{formatCurrency(emAberto.reduce((a, p) => a + p.amount, 0))}</p>
          <span className="text-[10px] text-amber-700">{emAberto.length} título(s) pendente(s) de baixa</span>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Baixado Automático</span>
          <p className="text-lg font-black text-emerald-800 mt-1">{formatCurrency(baixadoAuto.reduce((a, p) => a + p.amount, 0))}</p>
          <span className="text-[10px] text-emerald-700">{baixadoAuto.length} conciliado(s) com extrato</span>
        </div>
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Baixado Manual</span>
          <p className="text-lg font-black text-blue-800 mt-1">{formatCurrency(baixadoManual.reduce((a, p) => a + p.amount, 0))}</p>
          <span className="text-[10px] text-blue-700">{baixadoManual.length} confirmado(s) pelo gestor</span>
        </div>
      </div>

      {importSuccessMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-bold">{importSuccessMsg}</p>
        </div>
      )}

      {/* Upload Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="border-2 border-dashed border-[#EAE6DF] bg-white hover:border-[#C19A6B] rounded-xl p-8 text-center transition-all"
      >
        <div className="max-w-md mx-auto space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#C19A6B]/15 text-[#C19A6B] flex items-center justify-center mx-auto border border-[#C19A6B]/30">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#2D2A26]">Arraste a planilha RFN006 (Totais Pagos por Credor) aqui</p>
            <p className="text-xs text-[#8B7D6B] mt-0.5">Formatos aceitos: .xlsx, .xls</p>
          </div>
          <div>
            <label className="px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg cursor-pointer shadow-xs inline-block transition-all">
              <span>Selecionar Arquivo do Computador</span>
              <input type="file" accept=".xlsx,.xls" onChange={handleFileInput} className="hidden" />
            </label>
          </div>
          {fileName && (
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#F3F1ED] text-xs text-[#C19A6B] font-mono border border-[#EAE6DF]">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{fileName}</span>
            </div>
          )}
          {isProcessing && <p className="text-xs text-[#8B7D6B] animate-pulse">Processando arquivo...</p>}
        </div>
      </div>

      {/* ── Prévia de Validação ──────────────────────────────────────────── */}
      {previewRows.length > 0 && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl p-6 shadow-xs space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-[#EAE6DF]">
            <div className="bg-[#F9F7F2] rounded-lg p-3 border border-[#EAE6DF]">
              <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Total de Linhas</p>
              <p className="text-lg font-black text-[#2D2A26]">{previewRows.length}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
              <p className="text-[10px] font-bold text-emerald-700 uppercase">Válidos</p>
              <p className="text-lg font-black text-emerald-800">{validCount}</p>
            </div>
            <div className="bg-rose-50 rounded-lg p-3 border border-rose-200">
              <p className="text-[10px] font-bold text-rose-700 uppercase">Com Erro</p>
              <p className="text-lg font-black text-rose-800">{invalidCount}</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-[10px] font-bold text-amber-700 uppercase">Total Pago (Válidos)</p>
              <p className="text-sm font-black text-amber-800">{formatCurrency(previewTotal)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#C19A6B]" />
              Validação dos Títulos Pagos
            </h3>
            <div className="flex items-center space-x-2">
              {(['all', 'valid', 'invalid'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setPreviewFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                    previewFilter === f
                      ? f === 'valid'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : f === 'invalid'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-[#2D2A26] text-white border-[#2D2A26]'
                      : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF]'
                  }`}
                >
                  {f === 'all' ? `Todos (${previewRows.length})` : f === 'valid' ? `Válidos (${validCount})` : `Erros (${invalidCount})`}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-96 border border-[#EAE6DF] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] sticky top-0">
                <tr className="border-b border-[#EAE6DF] font-bold">
                  <th className="p-2.5 w-10 text-center">#</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Mov.</th>
                  <th className="p-2.5">Credor</th>
                  <th className="p-2.5">Parcela</th>
                  <th className="p-2.5">Data Pagamento</th>
                  <th className="p-2.5 text-right">Valor</th>
                  <th className="p-2.5">Erros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
                {filteredPreview.map((row) => (
                  <tr key={row.rowNumber} className={`hover:bg-[#FDFBF7] ${!row.valid ? 'bg-rose-50/40' : ''}`}>
                    <td className="p-2.5 text-center text-[#8B7D6B] font-mono">{row.rowNumber}</td>
                    <td className="p-2.5">
                      {row.valid ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">VÁLIDO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">ERRO</span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono">{row.movCode || '-'}</td>
                    <td className="p-2.5 max-w-xs truncate" title={row.supplierName}>{row.supplierName || '-'}</td>
                    <td className="p-2.5 font-mono">{row.parcela || '-'}</td>
                    <td className="p-2.5 font-mono">{row.paymentDate || '-'}</td>
                    <td className="p-2.5 text-right font-mono">{row.amount > 0 ? formatCurrency(row.amount) : '-'}</td>
                    <td className="p-2.5 text-rose-700 text-[11px]">{row.errors.length > 0 ? row.errors.join(' | ') : '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[#8B7D6B]">
              <span>Serão importados </span>
              <strong className="text-emerald-700 font-bold">{validCount} título(s)</strong>
              <span> totalizando </span>
              <strong className="text-emerald-700">{formatCurrency(previewTotal)}</strong>
            </div>
            <button
              onClick={handleCommit}
              disabled={validCount === 0}
              className="px-6 py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#C19A6B]" />
              <span>Confirmar e Importar ({validCount})</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Tabela de Contas a Pagar ─────────────────────────────────────── */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-[#EAE6DF] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
            <Banknote className="w-4 h-4 text-[#C19A6B]" />
            Títulos Pagos ({filteredPayables.length})
          </h3>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar credor, mov., parcela..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:border-[#C19A6B]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2 font-medium focus:outline-none focus:border-[#C19A6B]"
            >
              <option value="all">Todos os Status</option>
              <option value="Em Aberto">Em Aberto</option>
              <option value="Baixado Automático">Baixado Automático</option>
              <option value="Baixado Manual">Baixado Manual</option>
            </select>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2 font-medium focus:outline-none focus:border-[#C19A6B]"
            >
              <option value="all">Todos os Meses</option>
              {MONTH_KEYS.map((m) => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
              <tr>
                <th className="p-3 whitespace-nowrap">Mov.</th>
                <th className="p-3 whitespace-nowrap">Credor</th>
                <th className="p-3 whitespace-nowrap">Parcela</th>
                <th className="p-3 whitespace-nowrap">Data Pagamento</th>
                <th className="p-3 text-right whitespace-nowrap">Valor</th>
                <th className="p-3 text-center whitespace-nowrap">Status</th>
                <th className="p-3 text-center whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {paginatedPayables.map((p) => (
                <tr key={p.id} className="hover:bg-[#FDFBF7] transition-colors">
                  <td className="p-3 font-mono whitespace-nowrap">{p.movCode}</td>
                  <td className="p-3 max-w-xs truncate" title={p.supplierName}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{p.supplierName}</span>
                      {!p.supplierCustomerId && (
                        <button
                          onClick={() => { setLinkTarget(p); setLinkCode(p.supplierCode); }}
                          title="Credor não vinculado a um cliente — clique para vincular"
                          className="p-0.5 rounded text-amber-600 hover:text-amber-800 flex-shrink-0"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-[#8B7D6B] font-mono">cód: {p.supplierCode}</p>
                  </td>
                  <td className="p-3 font-mono whitespace-nowrap">{p.parcela || '-'}</td>
                  <td className="p-3 font-mono whitespace-nowrap">{p.paymentDate}</td>
                  <td className="p-3 text-right font-mono font-bold text-[#2D2A26] whitespace-nowrap">{formatCurrency(p.amount)}</td>
                  <td className="p-3 text-center whitespace-nowrap">
                    <div className="flex flex-col items-center gap-0.5">
                      {statusBadge(p.status)}
                      {p.baixaCode && (
                        <span className="text-[9px] font-mono text-blue-600">{p.baixaCode}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center space-x-1.5">
                      <button
                        onClick={() => setDetailsPayable(p)}
                        title="Ver Detalhes"
                        className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#2D2A26] text-[#433E37] hover:text-white transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && p.status === 'Em Aberto' && (
                        <>
                          <button
                            onClick={() => { setBaixaTarget(p); setBaixaNotes(''); }}
                            title="Dar Baixa Manual"
                            className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { setBaixaTarget(p); setBaixaNotes(''); searchExtratoForPayable(p); }}
                            title="Encontrar no Extrato (±2 dias)"
                            className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white transition-colors"
                          >
                            <Search className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {canEdit && p.status !== 'Em Aberto' && (
                        <button
                          onClick={() => onRevertBaixa(p.id)}
                          title="Estornar Baixa (voltar para Em Aberto)"
                          className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-600 text-amber-700 hover:text-white transition-colors"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {userRole === 'admin' && onDeletePayable && (
                        <button
                          onClick={() => setDeleteConfirmId(p.id)}
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
              {filteredPayables.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-[#8B7D6B]">
                    Nenhum título encontrado para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Controles de Paginação */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-[#EAE6DF] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F9F7F2]">
            <span className="text-xs font-semibold text-[#8B7D6B]">
              Mostrando {Math.min(filteredPayables.length, (currentPage - 1) * itemsPerPage + 1)} a{' '}
              {Math.min(filteredPayables.length, currentPage * itemsPerPage)} de {filteredPayables.length} títulos
            </span>
            <div className="flex items-center space-x-1.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Anterior
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pNum = currentPage - 2 + i;
                if (currentPage <= 2) pNum = i + 1;
                else if (currentPage >= totalPages - 1) pNum = totalPages - 4 + i;

                if (pNum < 1 || pNum > totalPages) return null;
                return (
                  <button
                    key={pNum}
                    onClick={() => setCurrentPage(pNum)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                      currentPage === pNum
                        ? 'bg-[#C19A6B] text-white'
                        : 'border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED]'
                    }`}
                  >
                    {pNum}
                  </button>
                );
              })}
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Próximo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Detalhes do Título */}
      {detailsPayable && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-xl shadow-xl flex flex-col text-[#2D2A26]" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b border-[#EAE6DF] flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#C19A6B]" /> Detalhes do Título Pago
              </h3>
              <button onClick={() => setDetailsPayable(null)} className="text-[#8B7D6B] hover:text-[#2D2A26]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-black">{detailsPayable.supplierName}</p>
                  <p className="text-[11px] font-mono text-[#C19A6B]">
                    cod credor: {detailsPayable.supplierCode}
                    {detailsPayable.supplierCustomerId ? ' • vinculado ao cadastro de clientes' : ' • NÃO vinculado a cliente'}
                  </p>
                </div>
                {statusBadge(detailsPayable.status)}
              </div>
              <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
                <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Valor Pago</p>
                <p className="text-lg font-black text-[#2D2A26]">{formatCurrency(detailsPayable.amount)}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  ['Mov. Código', detailsPayable.movCode],
                  ['Título/Parcela', `${detailsPayable.titleCode || ''} / ${detailsPayable.parcela || ''}`],
                  ['Vencimento', detailsPayable.dueDate],
                  ['Data Pagamento', detailsPayable.paymentDate],
                  ['Agente Pagador', detailsPayable.payingAgent],
                  ['Departamento', detailsPayable.department],
                  ['Empresa', detailsPayable.companyName],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex flex-col border-b border-dashed border-[#EAE6DF] pb-1">
                    <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">{label}</span>
                    <span className="text-[#2D2A26] font-medium">{(value as string) || '—'}</span>
                  </div>
                ))}
              </div>
              {detailsPayable.description && (
                <div>
                  <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Histórico</span>
                  <p className="text-xs text-[#433E37] bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3 mt-1">{detailsPayable.description}</p>
                </div>
              )}
              {reconciledEntry(detailsPayable) && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase mb-1">Lançamento de Extrato Conciliado</p>
                  <p className="text-xs text-emerald-900">
                    {reconciledEntry(detailsPayable)!.date} — {reconciledEntry(detailsPayable)!.sourceLabel} —{' '}
                    {formatCurrency(reconciledEntry(detailsPayable)!.exitAmount)} — {reconciledEntry(detailsPayable)!.description}
                  </p>
                </div>
              )}
              {detailsPayable.notes && (
                <div>
                  <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Observações</span>
                  <p className="text-xs text-[#433E37] bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3 mt-1">{detailsPayable.notes}</p>
                </div>
              )}
              {detailsPayable.baixaCode && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-blue-700 uppercase mb-1">Código de Baixa</p>
                  <p className="text-sm font-mono font-black text-blue-900">{detailsPayable.baixaCode}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-[#EAE6DF] flex items-center justify-end bg-[#F9F7F2] rounded-b-xl">
              <button onClick={() => setDetailsPayable(null)} className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Baixa Manual */}
      {baixaTarget && !extratoSearchTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-blue-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-100">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h4 className="text-base font-black text-[#2D2A26] mt-2">Confirmar Baixa Manual</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                {baixaTarget.supplierName} — {formatCurrency(baixaTarget.amount)}
              </p>
              <p className="text-[10px] font-mono text-[#C19A6B] mt-0.5">
                Mov: {baixaTarget.movCode} • Pagto: {baixaTarget.paymentDate}
              </p>
            </div>
            <textarea
              value={baixaNotes}
              onChange={(e) => setBaixaNotes(e.target.value)}
              placeholder="Observação da baixa (opcional): ex. pago em dinheiro, comprovante nº..."
              rows={2}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#C19A6B]"
              disabled={isBaixaLoading}
            />
            {/* Botão: Encontrar no Extrato */}
            <button
              onClick={() => searchExtratoForPayable(baixaTarget)}
              disabled={isBaixaLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
              Encontrar no Extrato (±2 dias)
            </button>
            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => { setBaixaTarget(null); setIsBaixaLoading(false); }}
                disabled={isBaixaLoading}
                className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                disabled={isBaixaLoading}
                onClick={async () => {
                  setIsBaixaLoading(true);
                  try {
                    await onManualBaixa(baixaTarget.id, baixaNotes.trim() || undefined);
                    setBaixaTarget(null);
                  } catch {
                    // Erro tratado no handler
                  } finally {
                    setIsBaixaLoading(false);
                  }
                }}
                className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isBaixaLoading && (
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                  </svg>
                )}
                Confirmar Baixa Manual
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Encontrar no Extrato — resultados */}
      {extratoSearchTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-emerald-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-[#EAE6DF]">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-base font-black text-[#2D2A26] flex items-center gap-2">
                    <Search className="w-5 h-5 text-emerald-600" /> Encontrar no Extrato
                  </h4>
                  <p className="text-xs text-[#8B7D6B] mt-1">
                    Buscando saída de <span className="font-bold text-[#2D2A26]">{formatCurrency(extratoSearchTarget.amount)}</span>{' '}
                    para <span className="font-bold">{extratoSearchTarget.supplierName}</span>
                  </p>
                  <p className="text-[10px] font-mono text-[#C19A6B] mt-0.5">
                    Janela: 2 dias antes de {extratoSearchTarget.paymentDate} até hoje
                  </p>
                </div>
                <button
                  onClick={() => { setExtratoSearchTarget(null); setExtratoSearchResults([]); }}
                  className="p-1 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-4 h-4 text-[#8B7D6B]" />
                </button>
              </div>
            </div>

            {/* Resultados */}
            <div className="p-5 overflow-y-auto flex-1">
              {extratoSearchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                  </svg>
                  <span className="ml-2 text-sm text-[#8B7D6B]">Buscando...</span>
                </div>
              ) : extratoSearchResults.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-[#2D2A26]">Nenhum lançamento encontrado</p>
                  <p className="text-xs text-[#8B7D6B] mt-1">
                    Não foi encontrada nenhuma saída de {formatCurrency(extratoSearchTarget.amount)} no extrato
                    dentro da janela de ±2 dias.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-emerald-700 mb-3">
                    {extratoSearchResults.length} lançamento(s) encontrado(s) — clique para confirmar a baixa:
                  </p>
                  {extratoSearchResults.map((entry) => (
                    <div
                      key={entry.id}
                      className="border border-[#EAE6DF] rounded-xl p-4 hover:border-emerald-400 hover:bg-emerald-50/40 transition-all cursor-pointer group"
                      onClick={async () => {
                        if (isBaixaLoading) return;
                        setIsBaixaLoading(true);
                        const justificativa = [
                          baixaNotes.trim(),
                          `Conciliado c/ extrato ${entry.sourceLabel} em ${entry.date}`,
                          extratoSearchTarget.description?.includes('Borderô')
                            ? extratoSearchTarget.description
                            : '',
                        ].filter(Boolean).join(' | ');
                        try {
                          await onManualBaixa(
                            extratoSearchTarget.id,
                            justificativa,
                            entry.id,
                            entry.source
                          );
                          setExtratoSearchTarget(null);
                          setExtratoSearchResults([]);
                          setBaixaTarget(null);
                        } catch {
                          // Erro tratado no handler
                        } finally {
                          setIsBaixaLoading(false);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              {entry.sourceLabel}
                            </span>
                            <span className="text-xs font-mono text-[#8B7D6B]">{entry.date}</span>
                          </div>
                          <p className="text-xs text-[#433E37] mt-1 truncate">{entry.description}</p>
                          {entry.clientName && (
                            <p className="text-[10px] text-[#8B7D6B] mt-0.5">Cliente: {entry.clientName}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0 ml-4">
                          <p className="text-sm font-black text-rose-600">{formatCurrency(entry.exitAmount)}</p>
                          <p className="text-[10px] text-[#8B7D6B]">Saída</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Confirmar Baixa com este lançamento
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[#EAE6DF] flex items-center justify-between bg-[#F9F7F2] rounded-b-2xl">
              <button
                onClick={() => { setExtratoSearchTarget(null); setExtratoSearchResults([]); }}
                className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]"
              >
                ← Voltar para Baixa Manual
              </button>
              {isBaixaLoading && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                  </svg>
                  Processando baixa...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Vincular Credor a Cliente */}
      {linkTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div>
              <h4 className="text-base font-black text-[#2D2A26] flex items-center gap-2">
                <Link2 className="w-5 h-5 text-[#C19A6B]" /> Vincular Credor a Cliente
              </h4>
              <p className="text-xs text-[#8B7D6B] mt-1">{linkTarget.supplierName} (código credor: {linkTarget.supplierCode})</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Código do Cliente (cod_cliente)</label>
              <input
                type="text"
                list="payables-customer-codes"
                value={linkCode}
                onChange={(e) => setLinkCode(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
              />
              <datalist id="payables-customer-codes">
                {customers.slice(0, 500).map((c) => (
                  <option key={c.id} value={c.code}>{c.name}</option>
                ))}
              </datalist>
            </div>
            <div className="flex items-center justify-end space-x-3">
              <button onClick={() => setLinkTarget(null)} className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button
                onClick={() => {
                  const match = customers.find((c) => c.code.toLowerCase() === linkCode.trim().toLowerCase());
                  if (!match) {
                    alert('Nenhum cliente encontrado com esse código.');
                    return;
                  }
                  onLinkSupplier(linkTarget.id, match.id, match.code);
                  setLinkTarget(null);
                }}
                className="px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white rounded-lg hover:bg-[#3F3B35]"
              >
                Vincular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Excluir Título */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Excluir Título?</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">O título será removido da base de contas a pagar.</p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (onDeletePayable) onDeletePayable(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
                className="px-4 py-2 text-xs font-bold bg-rose-700 text-white rounded-lg hover:bg-rose-800"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Zerar Base */}
      {isClearConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Zerar Contas a Pagar?</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                Remove todos os títulos importados para {selectedYear}, incluindo baixas já aplicadas.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button onClick={() => setIsClearConfirmOpen(false)} className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (onClearPayables) onClearPayables();
                  setIsClearConfirmOpen(false);
                }}
                className="px-4 py-2 text-xs font-bold bg-rose-700 text-white rounded-lg hover:bg-rose-800"
              >
                Sim, Zerar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
