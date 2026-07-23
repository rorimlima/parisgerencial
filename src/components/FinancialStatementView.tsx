/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FinancialStatementView — "Extrato Financeiro"
 *
 * Página de conciliação bancária e de caixa. Importa e normaliza três formatos
 * distintos de extrato em um modelo único (FinancialStatementEntry):
 *   - Bradesco: arquivo XML (SpreadsheetML / "Excel XML"), frequentemente salvo com
 *     extensão .XMLS. Colunas: Data, Lançamento, Dcto., Crédito (R$), Débito (R$), Saldo (R$).
 *   - PagSeguro: planilha .xlsx em formato de relatório (cabeçalho com metadados nas
 *     primeiras linhas, depois Data/Tipo/Descrição/Entradas/Saidas/Saldo, com linhas
 *     "Saldo do dia" que são apenas marcações de saldo e não lançamentos reais).
 *   - Caixa / Tesouraria (RFN019): planilha .xlsx com colunas nomeadas
 *     Tesouraria_DataCaixa, Tesouraria_Valor, Tesouraria_TipoDocumentoDes,
 *     ClienteBeneficiario, Tesouraria_Codigo (chave única), Credito, Debito.
 *
 * Após a validação, os lançamentos são gravados (UPSERT, sem duplicidade em
 * reimportações) e usados para atualizar automaticamente os totais de
 * Entradas Bancos / Entradas Tesouraria do Resultado Financeiro do mês.
 */

import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  Landmark,
  RefreshCcw,
  Search,
  Trash2,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import { FinancialStatementEntry, StatementOrigin, StatementSource } from '../types';
import { exportReportToExcel, formatCurrency, parseNumberPtBr } from '../utils/exportUtils';

interface FinancialStatementViewProps {
  entries: FinancialStatementEntry[];
  selectedYear: number;
  onCommitEntries: (entries: Omit<FinancialStatementEntry, 'id'>[]) => void;
  onDeleteEntry?: (id: string) => void;
  onClearEntries?: (source?: StatementSource) => void;
  userRole: string;
}

// ─── Config de fontes suportadas ────────────────────────────────────────────

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const SOURCE_META: Record<StatementSource, { label: string; shortLabel: string; origin: StatementOrigin; accept: string; hint: string; icon: React.ElementType }> = {
  bradesco: {
    label: 'Bradesco — Extrato Bancário (XML)',
    shortLabel: 'Bradesco',
    origin: 'banco',
    accept: '.xml,.xmls,.XML,.XMLS',
    hint: 'Arquivo XML (SpreadsheetML) exportado do internet banking, geralmente com extensão .XMLS. Colunas: Data, Lançamento, Dcto., Crédito, Débito, Saldo.',
    icon: Landmark,
  },
  pagseguro: {
    label: 'PagSeguro — Extrato da Conta (XLSX)',
    shortLabel: 'PagSeguro',
    origin: 'banco',
    accept: '.xlsx,.xls',
    hint: 'Relatório .xlsx exportado do PagSeguro. Colunas: Data, Tipo, Descrição, Entradas, Saidas, Saldo. Linhas "Saldo do dia" são ignoradas automaticamente.',
    icon: Building2,
  },
  tesouraria: {
    label: 'Caixa / Tesouraria (RFN019)',
    shortLabel: 'Caixa/Tesouraria',
    origin: 'caixa',
    accept: '.xlsx,.xls',
    hint: 'Planilha RFN019 de movimentação de tesouraria. Lê Tesouraria_DataCaixa (data), Tesouraria_Valor (valor recebido em dinheiro), Tesouraria_TipoDocumentoDes (ex: DINHEIRO) e ClienteBeneficiario (cliente).',
    icon: Wallet,
  },
};

// ─── Helpers de parsing ──────────────────────────────────────────────────────

interface RawStatementRow {
  date: string;           // YYYY-MM-DD
  description: string;
  clientName: string;
  documentType: string;
  documentRef: string;
  entryAmount: number;
  exitAmount: number;
  balance?: number;
  notes: string;
}

const monthKeyFromIso = (dateStr: string): string => {
  if (!dateStr) return '';
  const mStr = dateStr.includes('-')
    ? dateStr.split('-')[1]
    : dateStr.includes('/')
    ? dateStr.split('/')[1]
    : '';
  const m = parseInt(mStr, 10);
  return MONTH_KEYS[m - 1] || '';
};

// Converte datas DD/MM/YYYY, YYYY-MM-DD, "YYYY-MM-DD HH:mm:ss" ou objetos Date para YYYY-MM-DD
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

// ── Parser Bradesco (XML / SpreadsheetML) ───────────────────────────────────
// Lê o XML linha a linha (namespace ss:), respeitando ss:Index (colunas puladas
// por células vazias/mescladas). Ignora cabeçalho, "SALDO ANTERIOR",
// "SALDO INVEST FÁCIL" (linhas de saldo sem crédito/débito) e a linha "Total".
const parseBradescoXml = (xmlText: string): RawStatementRow[] => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'text/xml');
  const nsErr = xml.getElementsByTagName('parsererror');
  if (nsErr.length > 0) {
    throw new Error('Arquivo XML do Bradesco inválido ou corrompido.');
  }

  const ns = 'urn:schemas-microsoft-com:office:spreadsheet';
  const rowEls = Array.from(xml.getElementsByTagNameNS(ns, 'Row'));
  const out: RawStatementRow[] = [];

  for (const rowEl of rowEls) {
    const cellEls = Array.from(rowEl.getElementsByTagNameNS(ns, 'Cell'));
    const vals: (string | null)[] = ['', '', '', '', '', ''];
    let idx = 0;
    for (const cellEl of cellEls) {
      const idxAttr = cellEl.getAttributeNS(ns, 'Index');
      if (idxAttr) idx = parseInt(idxAttr, 10) - 1;
      const dataEl = cellEl.getElementsByTagNameNS(ns, 'Data')[0];
      const text = dataEl ? (dataEl.textContent || '') : null;
      if (idx < vals.length) vals[idx] = text;
      idx++;
    }

    const [rawDate, rawDesc, rawDoc, rawCredito, rawDebito, rawSaldo] = vals;

    // Ignora cabeçalho, rodapé "Total" e linhas de saldo puro (sem crédito/débito)
    if (!rawDate || rawDate === 'Data' || rawDate === 'Total') continue;
    if (!rawCredito && !rawDebito) continue;

    const date = normalizeDate(rawDate);
    if (!date) continue;

    const entryAmount = rawCredito ? parseNumberPtBr(rawCredito) : 0;
    const exitAmount = rawDebito ? Math.abs(parseNumberPtBr(rawDebito)) : 0;

    out.push({
      date,
      description: (rawDesc || '').replace(/\s*\n\s*/g, ' ').trim(),
      clientName: (rawDesc || '').replace(/\s*\n\s*/g, ' ').trim(),
      documentType: entryAmount > 0 ? 'Crédito Bancário' : 'Débito Bancário',
      documentRef: (rawDoc || '').trim(),
      entryAmount,
      exitAmount,
      balance: rawSaldo ? parseNumberPtBr(rawSaldo) : undefined,
      notes: '',
    });
  }

  return out;
};

// ── Parser PagSeguro (relatório .xlsx) ──────────────────────────────────────
// Localiza dinamicamente a linha de cabeçalho (Data/Tipo/.../Entradas/Saidas)
// pois o arquivo traz ~5 linhas de metadados antes da tabela. Ignora linhas
// "Saldo do dia" (marcação de saldo acumulado, não é um lançamento).
const parsePagSeguroRows = (aoa: any[][]): RawStatementRow[] => {
  const headerIdx = aoa.findIndex(
    (r) => Array.isArray(r) && r[0]?.toString().trim() === 'Data' && r[2]?.toString().trim() === 'Tipo'
  );
  if (headerIdx === -1) {
    throw new Error('Não foi possível localizar o cabeçalho (Data/Tipo/Entradas/Saidas) no arquivo do PagSeguro.');
  }

  const out: RawStatementRow[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || !r[0]) continue;
    const tipo = (r[2] || '').toString().trim();
    if (!tipo || tipo === 'Tipo' || tipo === 'Saldo do dia') continue;

    const date = normalizeDate(r[0]);
    if (!date) continue;

    const entryAmount = r[5] !== undefined && r[5] !== '' ? parseNumberPtBr(r[5]) : 0;
    const exitAmount = r[6] !== undefined && r[6] !== '' ? Math.abs(parseNumberPtBr(r[6])) : 0;
    if (entryAmount === 0 && exitAmount === 0) continue;

    const descricao = (r[4] || '').toString().trim();

    out.push({
      date,
      description: descricao || tipo,
      clientName: descricao,
      documentType: tipo,
      documentRef: '',
      entryAmount,
      exitAmount,
      notes: '',
    });
  }

  return out;
};

// ── Parser Caixa/Tesouraria (RFN019 .xlsx) ──────────────────────────────────
// Lê pelas colunas nomeadas: Tesouraria_DataCaixa (data), Tesouraria_Valor
// (valor movimentado em dinheiro), Tesouraria_TipoDocumentoDes ("DINHEIRO"),
// ClienteBeneficiario (cliente/credor). Este mesmo parser cobre dois cenários:
//   1) Recebimentos de caixa (RFN019 padrão): Credito preenchido, Debito = 0.
//   2) Saídas de caixa / pagamentos em dinheiro (planilha futura de tesouraria
//      de saída): identificadas por Debito preenchido OU por
//      Tesouraria_Multiplicador = -1 (convenção do ERP para lançamentos a
//      débito, igual à usada em RFN006 de contas a pagar).
// Prioridade de decisão: Debito explícito > Credito explícito >
// Tesouraria_Multiplicador (-1 = saída) > default (entrada, valor recebido).
const parseTesourariaRows = (rows: any[]): RawStatementRow[] => {
  const out: RawStatementRow[] = [];
  for (const row of rows) {
    const rawDate = row['Tesouraria_DataCaixa'];
    const date = normalizeDate(rawDate);
    if (!date) continue;

    const valor = Math.abs(parseNumberPtBr(row['Tesouraria_Valor'] ?? 0));
    const hasCredito = row['Credito'] !== undefined && row['Credito'] !== '';
    const hasDebito = row['Debito'] !== undefined && row['Debito'] !== '';
    const multiplicador = row['Tesouraria_Multiplicador'];

    let credito = 0;
    let debito = 0;
    if (hasDebito && Math.abs(Number(row['Debito']) || 0) > 0) {
      debito = Math.abs(Number(row['Debito']) || 0);
    } else if (hasCredito && Math.abs(Number(row['Credito']) || 0) > 0) {
      credito = Math.abs(Number(row['Credito']) || 0);
    } else if (multiplicador !== undefined && multiplicador !== '') {
      if (Number(multiplicador) < 0) debito = valor;
      else credito = valor;
    } else {
      credito = valor;
    }
    if (credito === 0 && debito === 0) continue;

    const tipoDoc = (row['Tesouraria_TipoDocumentoDes'] || row['Tesouraria_TipoCDDes'] || 'DINHEIRO').toString().trim();
    const cliente = (row['ClienteBeneficiario'] || '').toString().trim();
    const docRef = (row['Tesouraria_Codigo'] || row['Tesouraria_NroDocumento'] || '').toString().trim();
    const obs = (row['Tesouraria_Observacao'] || '').toString().trim();

    out.push({
      date,
      description: `${tipoDoc}${cliente ? ' — ' + cliente : ''}`,
      clientName: cliente,
      documentType: tipoDoc,
      documentRef: docRef,
      entryAmount: credito,
      exitAmount: debito,
      notes: obs,
    });
  }
  return out;
};

// ─── Componente ──────────────────────────────────────────────────────────────

type PreviewRow = RawStatementRow & { rowNumber: number; valid: boolean; errors: string[] };

export const FinancialStatementView: React.FC<FinancialStatementViewProps> = ({
  entries,
  selectedYear,
  onCommitEntries,
  onDeleteEntry,
  onClearEntries,
  userRole,
}) => {
  const [sourceType, setSourceType] = useState<StatementSource>('bradesco');
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  // Filtros da tabela de lançamentos já importados
  const [sourceFilter, setSourceFilter] = useState<'all' | StatementSource>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailsEntry, setDetailsEntry] = useState<FinancialStatementEntry | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<'all' | StatementSource | null>(null);

  // Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Resetar página quando os filtros mudam
  useEffect(() => {
    setCurrentPage(1);
  }, [sourceFilter, monthFilter, searchQuery]);

  const canEdit = userRole !== 'analista';
  const meta = SOURCE_META[sourceType];

  // ── Processamento de arquivo ──────────────────────────────────────────────

  const buildPreview = (raw: RawStatementRow[]) => {
    const rows: PreviewRow[] = raw.map((r, idx) => {
      const errors: string[] = [];
      if (!r.date) errors.push('Data ausente ou inválida');
      if (r.entryAmount === 0 && r.exitAmount === 0) errors.push('Lançamento sem valor de entrada ou saída');
      return { ...r, rowNumber: idx + 1, valid: errors.length === 0, errors };
    });
    setPreviewRows(rows);
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    setIsProcessing(true);
    setImportSuccessMsg(null);
    setPreviewRows([]);

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (sourceType === 'bradesco') {
      if (ext !== 'xml' && ext !== 'xmls') {
        alert('Para o Bradesco, envie o arquivo de extrato no formato XML (extensão .xml ou .xmls).');
        setIsProcessing(false);
        setFileName(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const raw = parseBradescoXml(text);
          buildPreview(raw);
        } catch (err: any) {
          alert(`Erro ao processar extrato Bradesco: ${err.message}`);
        } finally {
          setIsProcessing(false);
        }
      };
      reader.onerror = () => {
        alert('Erro ao ler o arquivo.');
        setIsProcessing(false);
      };
      reader.readAsText(file, 'utf-8');
      return;
    }

    if (ext !== 'xlsx' && ext !== 'xls') {
      alert(`Para ${meta.shortLabel}, envie um arquivo .xlsx ou .xls.`);
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

        if (sourceType === 'pagseguro') {
          const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
          buildPreview(parsePagSeguroRows(aoa));
        } else {
          const jsonRows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
          buildPreview(parseTesourariaRows(jsonRows));
        }
      } catch (err: any) {
        alert(`Erro ao processar planilha: ${err.message}`);
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

  // ── Commit ────────────────────────────────────────────────────────────────

  const handleCommit = () => {
    const validRows = previewRows.filter((r) => r.valid);
    if (validRows.length === 0) {
      alert('Nenhum lançamento válido para importar.');
      return;
    }

    // Chave de deduplicação determinística; usa contador de ocorrências para
    // permitir lançamentos legitimamente idênticos (mesma data/valor/descrição)
    // sem colidir, mantendo estabilidade em reimportações do mesmo arquivo.
    const seenCount = new Map<string, number>();
    const toSave: Omit<FinancialStatementEntry, 'id'>[] = validRows.map((r) => {
      const baseKey = `${sourceType}|${r.documentRef}|${r.date}|${r.description}|${r.entryAmount}|${r.exitAmount}`.toLowerCase();
      const n = seenCount.get(baseKey) || 0;
      seenCount.set(baseKey, n + 1);
      const dedupeKey = `${baseKey}#${n}`;

      return {
        origin: meta.origin,
        source: sourceType,
        sourceLabel: meta.shortLabel,
        date: r.date,
        year: parseInt(r.date.slice(0, 4), 10),
        monthKey: monthKeyFromIso(r.date),
        description: r.description,
        clientName: r.clientName,
        documentType: r.documentType,
        documentRef: r.documentRef,
        entryAmount: r.entryAmount,
        exitAmount: r.exitAmount,
        balance: r.balance,
        notes: r.notes,
        dedupeKey,
      };
    });

    onCommitEntries(toSave);
    setImportSuccessMsg(
      `${toSave.length} lançamento(s) de ${meta.shortLabel} processado(s). Resultado Financeiro será recalculado automaticamente.`
    );
    setPreviewRows([]);
    setFileName(null);
  };

  // ── Sumários da prévia ────────────────────────────────────────────────────

  const validCount = previewRows.filter((r) => r.valid).length;
  const invalidCount = previewRows.filter((r) => !r.valid).length;
  const previewTotalEntrada = previewRows.filter((r) => r.valid).reduce((a, r) => a + r.entryAmount, 0);
  const previewTotalSaida = previewRows.filter((r) => r.valid).reduce((a, r) => a + r.exitAmount, 0);

  const filteredPreview = previewRows.filter((r) => {
    if (previewFilter === 'valid') return r.valid;
    if (previewFilter === 'invalid') return !r.valid;
    return true;
  });

  // ── Lançamentos já importados (persistidos) ──────────────────────────────

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const matchesSource = sourceFilter === 'all' || e.source === sourceFilter;
      const matchesMonth = monthFilter === 'all' || e.monthKey === monthFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        q === '' ||
        e.description.toLowerCase().includes(q) ||
        (e.clientName || '').toLowerCase().includes(q) ||
        (e.documentRef || '').toLowerCase().includes(q);
      return matchesSource && matchesMonth && matchesSearch;
    });
  }, [entries, sourceFilter, monthFilter, searchQuery]);

  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(start, start + itemsPerPage);
  }, [filteredEntries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);

  const totalEntradasPeriodo = filteredEntries.reduce((a, e) => a + e.entryAmount, 0);
  const totalSaidasPeriodo = filteredEntries.reduce((a, e) => a + e.exitAmount, 0);
  const saldoLiquidoPeriodo = totalEntradasPeriodo - totalSaidasPeriodo;

  const totalBancosAno = entries.filter((e) => e.origin === 'banco').reduce((a, e) => a + e.entryAmount, 0);
  const totalTesourariaAno = entries.filter((e) => e.origin === 'caixa').reduce((a, e) => a + e.entryAmount, 0);

  const handleExportExcel = () => {
    const data = filteredEntries.map((e) => ({
      Data: e.date,
      Origem: e.origin === 'banco' ? 'Banco' : 'Caixa/Tesouraria',
      Fonte: e.sourceLabel,
      Descrição: e.description,
      'Cliente/Beneficiário': e.clientName || '',
      'Tipo Documento': e.documentType || '',
      'Referência/Documento': e.documentRef || '',
      Entrada: e.entryAmount,
      Saída: e.exitAmount,
      Saldo: e.balance ?? '',
      Observações: e.notes || '',
    }));
    exportReportToExcel(data, `EXTRATO_${selectedYear}`, `Extrato_Financeiro_Paris_Dakar_${selectedYear}.xlsx`);
  };

  const handleConfirmClear = () => {
    if (onClearEntries) {
      onClearEntries(clearTarget === 'all' ? undefined : (clearTarget as StatementSource));
    }
    setClearTarget(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              CONCILIAÇÃO BANCÁRIA & CAIXA
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Extrato Financeiro</h2>
          <p className="text-xs text-[#8B7D6B]">
            Importação de extratos bancários (Bradesco, PagSeguro) e de caixa/tesouraria (RFN019), com atualização
            automática das Entradas de Bancos e Tesouraria do Resultado Financeiro.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-2 border border-[#EAE6DF]"
          >
            <Download className="w-4 h-4 text-[#8B7D6B]" />
            <span>Exportar Excel</span>
          </button>
          {canEdit && onClearEntries && (
            <button
              onClick={() => setClearTarget('all')}
              className="px-3.5 py-2.5 text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg shadow-xs transition-all flex items-center gap-1.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>Zerar Extrato</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Total Bancos ({selectedYear})
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(totalBancosAno)}</p>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Total Tesouraria/Caixa ({selectedYear})
          </span>
          <p className="text-lg font-black text-[#C19A6B] mt-1">{formatCurrency(totalTesourariaAno)}</p>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Lançamentos Importados
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{entries.length}</p>
        </div>
      </div>

      {/* Seletor de Fonte */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs space-y-3">
        <p className="text-xs font-bold text-[#2D2A26]">Selecione o tipo de extrato a importar:</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.keys(SOURCE_META) as StatementSource[]).map((key) => {
            const s = SOURCE_META[key];
            const Icon = s.icon;
            const active = sourceType === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setSourceType(key);
                  setPreviewRows([]);
                  setFileName(null);
                  setImportSuccessMsg(null);
                }}
                className={`text-left p-3 rounded-lg border transition-all flex items-start gap-2.5 ${
                  active
                    ? 'bg-[#2D2A26] border-[#2D2A26] text-white shadow-xs'
                    : 'bg-[#F9F7F2] border-[#EAE6DF] text-[#433E37] hover:border-[#C19A6B]'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${active ? 'text-[#C19A6B]' : 'text-[#8B7D6B]'}`} />
                <div>
                  <p className="text-xs font-bold">{s.shortLabel}</p>
                  <p className={`text-[10px] mt-0.5 ${active ? 'text-white/70' : 'text-[#8B7D6B]'}`}>
                    {s.origin === 'banco' ? 'Origem: Banco' : 'Origem: Caixa/Tesouraria'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <FileCode2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-800">{meta.hint}</p>
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
            <p className="text-sm font-bold text-[#2D2A26]">Arraste o extrato de {meta.shortLabel} aqui</p>
            <p className="text-xs text-[#8B7D6B] mt-0.5">Formatos aceitos: {meta.accept.split(',').join(', ')}</p>
          </div>
          <div>
            <label className="px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg cursor-pointer shadow-xs inline-block transition-all">
              <span>Selecionar Arquivo do Computador</span>
              <input type="file" accept={meta.accept} onChange={handleFileInput} className="hidden" />
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
              <p className="text-[10px] font-bold text-amber-700 uppercase">Entradas / Saídas</p>
              <p className="text-xs font-black text-emerald-700">{formatCurrency(previewTotalEntrada)}</p>
              <p className="text-xs font-black text-rose-700">{formatCurrency(previewTotalSaida)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#C19A6B]" />
              Validação dos Lançamentos — {meta.shortLabel}
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
                  <th className="p-2.5">Data</th>
                  <th className="p-2.5">Descrição / Cliente</th>
                  <th className="p-2.5">Tipo</th>
                  <th className="p-2.5 text-right">Entrada</th>
                  <th className="p-2.5 text-right">Saída</th>
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
                    <td className="p-2.5 font-mono">{row.date || '-'}</td>
                    <td className="p-2.5 max-w-xs truncate" title={row.description}>{row.description || '-'}</td>
                    <td className="p-2.5 text-[10px]">{row.documentType || '-'}</td>
                    <td className="p-2.5 text-right font-mono text-emerald-700">
                      {row.entryAmount > 0 ? formatCurrency(row.entryAmount) : '-'}
                    </td>
                    <td className="p-2.5 text-right font-mono text-rose-700">
                      {row.exitAmount > 0 ? formatCurrency(row.exitAmount) : '-'}
                    </td>
                    <td className="p-2.5 text-rose-700 text-[11px]">{row.errors.length > 0 ? row.errors.join(' | ') : '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[#8B7D6B]">
              <span>Serão importados </span>
              <strong className="text-emerald-700 font-bold">{validCount} lançamento(s)</strong>
              <span> — entradas de </span>
              <strong className="text-emerald-700">{formatCurrency(previewTotalEntrada)}</strong>
              <span> e saídas de </span>
              <strong className="text-rose-700">{formatCurrency(previewTotalSaida)}</strong>
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

      {/* ── Lançamentos Importados ───────────────────────────────────────── */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-[#EAE6DF] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
            <Banknote className="w-4 h-4 text-[#C19A6B]" />
            Lançamentos do Extrato ({filteredEntries.length})
          </h3>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar descrição, cliente, doc..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:border-[#C19A6B]"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2 font-medium focus:outline-none focus:border-[#C19A6B]"
            >
              <option value="all">Todas as Fontes</option>
              <option value="bradesco">Bradesco</option>
              <option value="pagseguro">PagSeguro</option>
              <option value="tesouraria">Caixa/Tesouraria</option>
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

        {/* Sumário do período filtrado */}
        <div className="grid grid-cols-3 gap-3 p-4 border-b border-[#EAE6DF] bg-[#F9F7F2]">
          <div>
            <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Entradas (filtro)</p>
            <p className="text-sm font-black text-emerald-700">{formatCurrency(totalEntradasPeriodo)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Saídas (filtro)</p>
            <p className="text-sm font-black text-rose-700">{formatCurrency(totalSaidasPeriodo)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Saldo Líquido (filtro)</p>
            <p className={`text-sm font-black ${saldoLiquidoPeriodo >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatCurrency(saldoLiquidoPeriodo)}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
              <tr>
                <th className="p-3 whitespace-nowrap">Data</th>
                <th className="p-3 whitespace-nowrap">Fonte</th>
                <th className="p-3 whitespace-nowrap">Descrição</th>
                <th className="p-3 whitespace-nowrap">Cliente/Beneficiário</th>
                <th className="p-3 whitespace-nowrap">Tipo</th>
                <th className="p-3 text-right whitespace-nowrap">Entrada</th>
                <th className="p-3 text-right whitespace-nowrap">Saída</th>
                <th className="p-3 text-center whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {paginatedEntries.map((e) => (
                <tr key={e.id} className="hover:bg-[#FDFBF7] transition-colors">
                  <td className="p-3 font-mono whitespace-nowrap">{e.date}</td>
                  <td className="p-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
                      {e.sourceLabel}
                    </span>
                  </td>
                  <td className="p-3 max-w-xs truncate" title={e.description}>{e.description}</td>
                  <td className="p-3 whitespace-nowrap">{e.clientName || '-'}</td>
                  <td className="p-3 text-[10px] whitespace-nowrap">{e.documentType || '-'}</td>
                  <td className="p-3 text-right font-mono text-emerald-700 whitespace-nowrap">
                    {e.entryAmount > 0 ? formatCurrency(e.entryAmount) : '-'}
                  </td>
                  <td className="p-3 text-right font-mono text-rose-700 whitespace-nowrap">
                    {e.exitAmount > 0 ? formatCurrency(e.exitAmount) : '-'}
                  </td>
                  <td className="p-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center space-x-1.5">
                      <button
                        onClick={() => setDetailsEntry(e)}
                        title="Ver Detalhes"
                        className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#2D2A26] text-[#433E37] hover:text-white transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && onDeleteEntry && (
                        <button
                          onClick={() => setDeleteConfirmId(e.id)}
                          title="Excluir Lançamento"
                          className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-[#8B7D6B]">
                    Nenhum lançamento importado ainda para este filtro.
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
              Mostrando {Math.min(filteredEntries.length, (currentPage - 1) * itemsPerPage + 1)} a{' '}
              {Math.min(filteredEntries.length, currentPage * itemsPerPage)} de {filteredEntries.length} lançamentos
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

      {/* Modal: Detalhes do Lançamento */}
      {detailsEntry && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-xl shadow-xl flex flex-col text-[#2D2A26]" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b border-[#EAE6DF] flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#C19A6B]" /> Detalhes do Lançamento
              </h3>
              <button onClick={() => setDetailsEntry(null)} className="text-[#8B7D6B] hover:text-[#2D2A26]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
                  <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Entrada</p>
                  <p className="text-sm font-black text-emerald-700">{formatCurrency(detailsEntry.entryAmount)}</p>
                </div>
                <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
                  <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Saída</p>
                  <p className="text-sm font-black text-rose-700">{formatCurrency(detailsEntry.exitAmount)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  ['Data', detailsEntry.date],
                  ['Fonte', detailsEntry.sourceLabel],
                  ['Origem', detailsEntry.origin === 'banco' ? 'Banco' : 'Caixa/Tesouraria'],
                  ['Tipo de Documento', detailsEntry.documentType],
                  ['Referência/Documento', detailsEntry.documentRef],
                  ['Cliente/Beneficiário', detailsEntry.clientName],
                  ['Saldo Após Lançamento', detailsEntry.balance !== undefined ? formatCurrency(detailsEntry.balance) : ''],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex flex-col border-b border-dashed border-[#EAE6DF] pb-1">
                    <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">{label}</span>
                    <span className="text-[#2D2A26] font-medium">{(value as string) || '—'}</span>
                  </div>
                ))}
              </div>
              <div>
                <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Descrição</span>
                <p className="text-xs text-[#433E37] bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3 mt-1">{detailsEntry.description}</p>
              </div>
              {detailsEntry.notes && (
                <div>
                  <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Observações</span>
                  <p className="text-xs text-[#433E37] bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3 mt-1">{detailsEntry.notes}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-[#EAE6DF] flex items-center justify-end bg-[#F9F7F2] rounded-b-xl">
              <button onClick={() => setDetailsEntry(null)} className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmação de Exclusão */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Excluir Lançamento?</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                O lançamento será removido do extrato e o Resultado Financeiro será recalculado automaticamente.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (onDeleteEntry) onDeleteEntry(deleteConfirmId);
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

      {/* Modal: Confirmação de Zerar Extrato */}
      {clearTarget !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <RefreshCcw className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Zerar Extrato Financeiro</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                Escolha o que deseja limpar para o exercício {selectedYear}. Esta ação recalcula o Resultado Financeiro.
              </p>
            </div>
            <select
              value={clearTarget}
              onChange={(e) => setClearTarget(e.target.value as any)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg p-2.5 font-bold focus:outline-none focus:border-[#C19A6B]"
            >
              <option value="all">Todas as Fontes (Bancos + Tesouraria)</option>
              <option value="bradesco">Somente Bradesco</option>
              <option value="pagseguro">Somente PagSeguro</option>
              <option value="tesouraria">Somente Caixa/Tesouraria</option>
            </select>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button onClick={() => setClearTarget(null)} className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={handleConfirmClear} className="px-4 py-2 text-xs font-bold bg-rose-700 text-white rounded-lg hover:bg-rose-800">
                Sim, Zerar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
