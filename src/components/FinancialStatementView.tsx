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
import { parseRfn019Rows } from '../utils/rfn019Parser';
import {
  DEFAULT_TESOURARIA_ACCOUNT,
  TESOURARIA_ACCOUNTS,
  buildBankDedupeKey,
  extractCashAccountFromText,
} from '../utils/statementKeys';

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
    hint: 'Planilha RFN019 de movimentação de caixa/tesouraria. Lê Tesouraria_DataCaixa (data), Tesouraria_Observacao (descrição), Credito (entrada) e Debito (valor pago/saída), Tesouraria_TipoDocumentoDes (DINHEIRO) e ClienteBeneficiario (cliente/beneficiário). Tesouraria_Codigo é usado como chave: reimportar a mesma planilha atualiza os lançamentos, nunca duplica.',
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
  // Preenchidos só pelo RFN019 (caixa/tesouraria)
  dedupeKey?: string;          // chave já pronta, vinda do Tesouraria_Codigo
  accountCode?: string;
  accountLabel?: string;
  managementAccount?: string;
  isInternalTransfer?: boolean;
  counterAccountCode?: string;
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
// A leitura em si mora em utils/rfn019Parser.ts, compartilhada com o seeder
// (scripts/seedTesouraria.mjs) para que os dois gerem exatamente as mesmas
// chaves — é o que garante que rodar o script e depois reimportar pela tela não
// duplique nada. Aqui só adaptamos o resultado ao formato da prévia.
const parseTesourariaRows = (rows: any[], accountCode: string): RawStatementRow[] =>
  parseRfn019Rows(rows, accountCode).map((r) => ({
    date: r.date,
    description: r.description,
    clientName: r.clientName,
    documentType: r.documentType,
    documentRef: r.documentRef,
    entryAmount: r.entryAmount,
    exitAmount: r.exitAmount,
    notes: r.notes,
    dedupeKey: r.dedupeKey,
    accountCode: r.accountCode,
    accountLabel: r.accountLabel,
    managementAccount: r.managementAccount,
    isInternalTransfer: r.isInternalTransfer,
    counterAccountCode: r.counterAccountCode,
  }));

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
  // Conta do RFN019. Obrigatória porque o relatório não diz de qual conta é —
  // ver comentário em utils/statementKeys.ts.
  const [tesourariaAccount, setTesourariaAccount] = useState<string>(DEFAULT_TESOURARIA_ACCOUNT);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  // Filtros da tabela de lançamentos já importados
  // 'all' | fonte | 'conta:30108' | 'conta:30101' | 'transferencias'
  const [sourceFilter, setSourceFilter] = useState<string>('all');
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
          buildPreview(parseTesourariaRows(jsonRows, tesourariaAccount));
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

    // CHAVE DE DEDUPLICAÇÃO — regra única, centralizada em utils/statementKeys.ts
    // (o seeder usa a mesma). O RFN019 já chega com a chave pronta, derivada do
    // Tesouraria_Codigo, que é o ID do movimento no ERP. Os extratos bancários,
    // que não têm identificador, usam a chave composta com contador de
    // ocorrência para permitir duas linhas legitimamente idênticas no mesmo dia.
    const seenCount = new Map<string, number>();
    const toSave: Omit<FinancialStatementEntry, 'id'>[] = validRows.map((r) => {
      let dedupeKey = r.dedupeKey || '';
      if (!dedupeKey) {
        const probe = buildBankDedupeKey({
          source: sourceType,
          date: r.date,
          documentRef: r.documentRef,
          description: r.description,
          entryAmount: r.entryAmount,
          exitAmount: r.exitAmount,
          occurrence: 0,
        });
        const base = probe.slice(0, probe.lastIndexOf('#'));
        const n = seenCount.get(base) || 0;
        seenCount.set(base, n + 1);
        dedupeKey = `${base}#${n}`;
      }

      const isTesouraria = sourceType === 'tesouraria';
      return {
        origin: meta.origin,
        source: sourceType,
        // No caixa, o rótulo mostra a conta (Caixa 30108 / Tesouraria 30101):
        // sem isso as duas contas ficam indistinguíveis na tela e no export.
        sourceLabel: isTesouraria ? r.accountLabel || meta.shortLabel : meta.shortLabel,
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
        ...(isTesouraria
          ? {
              accountCode: r.accountCode,
              accountLabel: r.accountLabel,
              managementAccount: r.managementAccount,
              isInternalTransfer: !!r.isInternalTransfer,
              counterAccountCode: r.counterAccountCode || '',
            }
          : {}),
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
  const previewTransfers = previewRows.filter((r) => r.valid && r.isInternalTransfer);
  const previewTransferCount = previewTransfers.length;
  const previewTransferValue = previewTransfers.reduce((a, r) => a + r.entryAmount + r.exitAmount, 0);

  // Quebra da prévia por conta de contrapartida — mostra, ANTES de gravar, que
  // as entradas do extrato 30101 vêm dos caixas 301.07/301.10.
  const previewTransferByAccount = useMemo(() => {
    const map = new Map<string, { code: string; label: string; count: number; entrada: number; saida: number }>();
    previewTransfers.forEach((r) => {
      const code = r.counterAccountCode || extractCashAccountFromText(r.managementAccount) || 'outros';
      const cur = map.get(code) || {
        code,
        label:
          TESOURARIA_ACCOUNTS[code]?.label ||
          (code === 'outros' ? 'Conta não identificada' : `Conta ${code}`),
        count: 0,
        entrada: 0,
        saida: 0,
      };
      cur.count += 1;
      cur.entrada += r.entryAmount;
      cur.saida += r.exitAmount;
      map.set(code, cur);
    });
    return [...map.values()].sort((a, b) => b.entrada + b.saida - (a.entrada + a.saida));
  }, [previewRows]);

  // Repasses digitados em duplicidade no ERP: mesmo dia, mesmo valor, mesma
  // conta, códigos de movimento diferentes. A chave por Tesouraria_Codigo não
  // pega esses — para o ERP são dois movimentos —, então o alerta é aqui, na
  // prévia, enquanto ainda dá para conferir antes de gravar.
  const previewDuplicates = useMemo(() => {
    const map = new Map<string, { date: string; amount: number; code: string; refs: string[] }>();
    previewRows
      .filter((r) => r.valid)
      .forEach((r) => {
        const amount = r.entryAmount || r.exitAmount;
        if (amount <= 0) return;
        const code = r.counterAccountCode || extractCashAccountFromText(r.managementAccount) || '';
        const key = `${r.date}|${amount.toFixed(2)}|${code}|${r.entryAmount > 0 ? 'E' : 'S'}`;
        const cur = map.get(key);
        if (cur) cur.refs.push(r.documentRef);
        else map.set(key, { date: r.date, amount, code, refs: [r.documentRef] });
      });
    return [...map.values()]
      .filter((g) => g.refs.length > 1)
      .sort((a, b) => b.amount * (b.refs.length - 1) - a.amount * (a.refs.length - 1));
  }, [previewRows]);

  const previewDuplicateExtra = previewDuplicates.reduce((a, g) => a + (g.refs.length - 1), 0);
  const previewDuplicateValue = previewDuplicates.reduce((a, g) => a + g.amount * (g.refs.length - 1), 0);

  const filteredPreview = previewRows.filter((r) => {
    if (previewFilter === 'valid') return r.valid;
    if (previewFilter === 'invalid') return !r.valid;
    return true;
  });

  // ── Lançamentos já importados (persistidos) ──────────────────────────────

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      // O filtro de fonte também atende às contas de caixa (conta:30108 /
      // conta:30101) e ao recorte de transferências internas.
      const matchesSource =
        sourceFilter === 'all'
          ? true
          : sourceFilter === 'transferencias'
          ? !!e.isInternalTransfer
          : sourceFilter.startsWith('conta:')
          ? e.accountCode === sourceFilter.slice(6)
          : e.source === sourceFilter;
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

  // TRANSFERÊNCIA INTERNA NÃO ENTRA NO TOTAL DE ENTRADAS.
  //
  // Este card mostrava a soma bruta de todo crédito com origin='caixa',
  // inclusive o remanejo entre as contas da casa — no extrato da tesouraria
  // 30101, as entradas vêm dos caixas 301.07 e 301.10, dinheiro que já foi
  // contado quando saiu de lá. Somar os dois lados conta o mesmo real duas
  // vezes e o card diverge do Resultado Financeiro, que sempre excluiu essas
  // linhas (App.tsx → recomputeFinancialFromStatement). Agora os dois números
  // usam a mesma régra; o valor transferido continua visível, num card próprio.
  const realEntries = entries.filter((e) => !e.isInternalTransfer);
  const totalBancosAno = realEntries.filter((e) => e.origin === 'banco').reduce((a, e) => a + e.entryAmount, 0);
  const totalTesourariaAno = realEntries.filter((e) => e.origin === 'caixa').reduce((a, e) => a + e.entryAmount, 0);

  // Quebra das transferências internas por conta de contrapartida (301.07,
  // 301.10, ...). É a resposta para "de onde veio esse dinheiro" sem reabrir a
  // planilha do ERP.
  const transferEntries = entries.filter((e) => e.isInternalTransfer);
  const totalTransferenciasAno = transferEntries.reduce((a, e) => a + e.entryAmount + e.exitAmount, 0);
  const transferBreakdown = useMemo(() => {
    const map = new Map<string, { code: string; label: string; count: number; entrada: number; saida: number }>();
    transferEntries.forEach((e) => {
      // Lançamentos gravados antes deste campo existir não têm
      // `counterAccountCode`. Em vez de mostrá-los todos como "não
      // identificada" (o que esconderia justamente a resposta que se quer), a
      // conta é relida do texto da classificação gerencial, que já estava
      // gravado. Assim a auditoria funciona na base atual, sem reimportar.
      const code = e.counterAccountCode || extractCashAccountFromText(e.managementAccount) || 'outros';
      const cur = map.get(code) || {
        code,
        label:
          TESOURARIA_ACCOUNTS[code]?.label ||
          (code === 'outros' ? 'Conta não identificada' : `Conta ${code}`),
        count: 0,
        entrada: 0,
        saida: 0,
      };
      cur.count += 1;
      cur.entrada += e.entryAmount;
      cur.saida += e.exitAmount;
      map.set(code, cur);
    });
    return [...map.values()].sort((a, b) => b.entrada + b.saida - (a.entrada + a.saida));
  }, [entries]);

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Entradas Bancos ({selectedYear})
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(totalBancosAno)}</p>
          <span className="text-[10px] text-[#8B7D6B]">recebimento real, sem transferência interna</span>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Entradas Tesouraria/Caixa ({selectedYear})
          </span>
          <p className="text-lg font-black text-[#C19A6B] mt-1">{formatCurrency(totalTesourariaAno)}</p>
          <span className="text-[10px] text-[#8B7D6B]">bate com o Resultado Financeiro</span>
        </div>
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
            Transferências Internas ({selectedYear})
          </span>
          <p className="text-lg font-black text-amber-800 mt-1">{formatCurrency(totalTransferenciasAno)}</p>
          <span className="text-[10px] text-amber-700">
            {transferEntries.length} lançamento(s) — fora do total de entradas
          </span>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Lançamentos Importados
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{entries.length}</p>
        </div>
      </div>

      {/* Auditoria: de onde vem o dinheiro das transferências internas.
          Responde "as entradas do extrato 30101 vieram do 30107/30110?" com
          número, sem precisar reabrir a planilha do ERP. */}
      {transferBreakdown.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-[#2D2A26]">Origem das transferências internas ({selectedYear})</p>
              <p className="text-[11px] text-[#8B7D6B] mt-0.5">
                Dinheiro que trocou de conta dentro da própria empresa (faixa 301.xx). Fica gravado no extrato para o
                saldo da conta fechar, mas está fora do total de entradas — somá-lo contaria o mesmo real duas vezes.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#EAE6DF] text-[10px] uppercase text-[#8B7D6B]">
                  <th className="text-left py-2 font-bold">Conta de contrapartida</th>
                  <th className="text-right py-2 font-bold">Lançamentos</th>
                  <th className="text-right py-2 font-bold">Entrou</th>
                  <th className="text-right py-2 font-bold">Saiu</th>
                </tr>
              </thead>
              <tbody>
                {transferBreakdown.map((t) => (
                  <tr key={t.code} className="border-b border-[#F3F1ED] last:border-0">
                    <td className="py-2 font-bold text-[#2D2A26]">{t.label}</td>
                    <td className="py-2 text-right font-mono text-[#433E37]">{t.count}</td>
                    <td className="py-2 text-right font-mono font-bold text-emerald-700">{formatCurrency(t.entrada)}</td>
                    <td className="py-2 text-right font-mono font-bold text-rose-700">{formatCurrency(t.saida)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => { setSourceFilter('transferencias'); setCurrentPage(1); }}
            className="mt-3 px-3 py-1.5 text-[11px] font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200 rounded-lg transition-all"
          >
            Ver os lançamentos
          </button>
        </div>
      )}

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
        {/* Seleção da conta — obrigatória no RFN019, que não traz a conta no arquivo */}
        {sourceType === 'tesouraria' && (
          <div className="border border-[#C19A6B]/40 bg-[#C19A6B]/5 rounded-lg p-3 space-y-2">
            <div className="flex items-start gap-2">
              <Wallet className="w-4 h-4 text-[#C19A6B] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-[#2D2A26]">De qual conta é este extrato?</p>
                <p className="text-[10px] text-[#8B7D6B]">
                  O RFN019 não informa a conta em nenhuma coluna — é preciso indicar. A escolha entra na chave do
                  lançamento, então importar na conta errada lança o dinheiro no caixa errado.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.values(TESOURARIA_ACCOUNTS).map((acc) => {
                const active = tesourariaAccount === acc.code;
                return (
                  <button
                    key={acc.code}
                    onClick={() => {
                      setTesourariaAccount(acc.code);
                      setPreviewRows([]);
                      setFileName(null);
                      setImportSuccessMsg(null);
                    }}
                    className={`text-left p-2.5 rounded-lg border transition-all ${
                      active
                        ? 'bg-[#2D2A26] border-[#2D2A26] text-white shadow-xs'
                        : 'bg-white border-[#EAE6DF] text-[#433E37] hover:border-[#C19A6B]'
                    }`}
                  >
                    <p className="text-xs font-bold">{acc.label}</p>
                    <p className={`text-[10px] mt-0.5 ${active ? 'text-white/70' : 'text-[#8B7D6B]'}`}>
                      {acc.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

          {/* ALERTA DE TRANSFERÊNCIA INTERNA
              Dinheiro que vai da tesouraria para o caixa da mesma empresa não é
              recebimento. Se entrasse como "Entradas de Tesouraria", o Resultado
              Financeiro mostraria caixa que nenhum cliente pagou. Os lançamentos
              são gravados (o extrato precisa fechar com o saldo da conta), mas
              ficam marcados e fora do cálculo de entradas. */}
          {previewTransferCount > 0 && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-900 leading-relaxed">
                <p className="font-bold">
                  {previewTransferCount} lançamento(s) são transferência interna entre contas da empresa
                  ({formatCurrency(previewTransferValue)}).
                </p>
                <p className="mt-0.5">
                  São remanejos caixa ↔ tesouraria, não recebimento de cliente. Serão importados e marcados para
                  conciliação, mas <span className="font-bold">não entram como Entradas</span> no Resultado Financeiro —
                  contá-los infla o caixa com dinheiro que a empresa apenas trocou de bolso.
                </p>
                {previewTransferByAccount.length > 0 && (
                  <ul className="mt-2 space-y-0.5 font-mono">
                    {previewTransferByAccount.map((t) => (
                      <li key={t.code}>
                        • <span className="font-bold">{t.label}</span>: {t.count} lançamento(s) — entrou{' '}
                        {formatCurrency(t.entrada)}, saiu {formatCurrency(t.saida)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* DUPLICIDADE NO PRÓPRIO ARQUIVO.
              O Tesouraria_Codigo garante que a mesma LINHA não entre duas
              vezes. O que ele não pega é o repasse digitado duas vezes no ERP:
              dois códigos diferentes, mesmo dia, mesmo valor, mesma conta. Nada
              é bloqueado nem apagado automaticamente — pode ser um repasse
              legítimo repetido —, mas o gestor precisa ver o número antes de
              gravar, porque depois ele vira saldo. */}
          {previewDuplicateExtra > 0 && (
            <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-rose-900 leading-relaxed w-full">
                <p className="font-bold">
                  Possível duplicidade: {previewDuplicateExtra} lançamento(s) repetem dia, valor e conta
                  ({formatCurrency(previewDuplicateValue)} de excedente).
                </p>
                <p className="mt-0.5">
                  Códigos de movimento diferentes, então o ERP os trata como lançamentos distintos e a chave de
                  importação não os funde. Confira antes de gravar — se for digitação repetida, corrija no ERP e
                  reimporte; a importação atualiza as linhas no lugar, sem duplicar.
                </p>
                <ul className="mt-2 space-y-0.5 font-mono">
                  {previewDuplicates.slice(0, 8).map((g, i) => (
                    <li key={i}>
                      • {g.date} — {formatCurrency(g.amount)} × {g.refs.length}
                      {g.code ? ` — conta ${g.code}` : ''} — códs. {g.refs.slice(0, 6).join(', ')}
                    </li>
                  ))}
                  {previewDuplicates.length > 8 && (
                    <li>• … e mais {previewDuplicates.length - 8} grupo(s).</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#C19A6B]" />
              Validação dos Lançamentos — {meta.shortLabel}
              {sourceType === 'tesouraria' && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30 font-bold">
                  {TESOURARIA_ACCOUNTS[tesourariaAccount]?.label || tesourariaAccount}
                </span>
              )}
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
              <option value="tesouraria">Caixa/Tesouraria (todas)</option>
              {/* As duas contas de dinheiro precisam ser filtráveis separadamente:
                  sem isso não há como conferir o saldo de cada caixa. */}
              <option value="conta:30108">— Caixa 30108</option>
              <option value="conta:30101">— Tesouraria 30101</option>
              <option value="transferencias">— Só transferências internas</option>
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
