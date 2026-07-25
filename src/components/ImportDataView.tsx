/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Image,
  Info,
  UploadCloud,
} from 'lucide-react';
import { Customer, DelinquencyValidationRowResult, SaleItem, ValidationRowResult } from '../types';
import {
  formatPhoneBr,
  parseDelinquencyRows,
  parseSalesRows,
  ParsedSalesSheet,
  RFN029_EXPECTED_HEADERS,
  RPR001_EXPECTED_HEADERS,
} from '../utils/sheetParsers';

interface ImportDataViewProps {
  onCommitImport: (
    validEntries: ValidationRowResult[],
    year: number,
    targetModule: 'economic' | 'financial' | 'customers' | 'delinquency'
  ) => void;
  onCommitDelinquencyImport: (
    validEntries: DelinquencyValidationRowResult[]
  ) => void;
  /**
   * Carga das vendas de produto (RPR001). Opcional para não quebrar telas que
   * montam este componente sem o módulo de vendas — quando ausente, a opção
   * simplesmente não aparece no seletor.
   */
  onCommitSalesImport?: (items: SaleItem[]) => Promise<void> | void;
  selectedYear: number;
  initialModule?: 'economic' | 'financial' | 'customers' | 'delinquency' | 'sales';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Converte valores monetários de múltiplos formatos (número JS, "1.234,56", "1234.56", "R$ ...").
const parseAmount = (raw: any): number => {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  let s = raw.toString().trim().replace(/R\$\s?/gi, '').replace(/\s/g, '');
  if (s === '') return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Formato PT-BR: ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Só vírgula → decimal
    s = s.replace(',', '.');
  }
  // Só ponto (ou número puro) → ponto já é o decimal
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
};

// Normaliza datas de vários formatos para YYYY-MM-DD (aceita Date, "2026-07-01 00:00:00", "01/03/1987").
const normalizeDate = (raw: any): string => {
  if (raw === null || raw === undefined || raw === '') return '';
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
  return s;
};

// Lê um valor de uma linha aceitando múltiplas variações de nome de coluna
const pick = (row: any, keys: string[]): string => {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v.toString().trim() !== '') {
      return v instanceof Date ? v.toISOString() : v.toString().trim();
    }
  }
  return '';
};


// ─── Component ───────────────────────────────────────────────────────────────

export const ImportDataView: React.FC<ImportDataViewProps> = ({
  onCommitImport,
  onCommitDelinquencyImport,
  onCommitSalesImport,
  selectedYear,
  initialModule,
}) => {
  const [targetModule, setTargetModule] = useState<'economic' | 'financial' | 'customers' | 'delinquency' | 'sales'>(initialModule || 'financial');
  const [year, setYear] = useState<number>(selectedYear || 2026);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  // Resultados financeiro/econômico
  const [validationResults, setValidationResults] = useState<ValidationRowResult[]>([]);
  // Resultados inadimplência
  const [delinquencyResults, setDelinquencyResults] = useState<DelinquencyValidationRowResult[]>([]);
  // Diagnóstico da leitura do RFN029 (linhas de histórico, duplicatas, layout)
  const [delinquencyMeta, setDelinquencyMeta] = useState<{
    totalRows: number;
    titleRows: number;
    occurrenceRows: number;
    duplicateKeys: number;
    missingHeaders: string[];
    extraHeaders: string[];
  } | null>(null);

  // Resultado da leitura do RPR001 (Vendas de Produtos). Guardamos a análise
  // inteira, não só as linhas: o diagnóstico de integridade é parte do que o
  // gestor precisa ver ANTES de confirmar a carga.
  const [salesParsed, setSalesParsed] = useState<ParsedSalesSheet | null>(null);
  const [isCommittingSales, setIsCommittingSales] = useState(false);

  const [filterStatus, setFilterStatus] = useState<'all' | 'valid' | 'invalid'>('all');
  const [isProcessing, setIsProcessing] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  // ── Processamento de arquivo ──────────────────────────────────────────────

  const processFile = (file: File) => {
    setFileName(file.name);
    setIsProcessing(true);
    setImportSuccessMsg(null);
    setValidationResults([]);
    setDelinquencyResults([]);
    setDelinquencyMeta(null);

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          handleRows(results.data);
          setIsProcessing(false);
        },
        error: (err) => {
          alert(`Erro ao ler arquivo CSV: ${err.message}`);
          setIsProcessing(false);
        },
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          handleRows(jsonRows);
        } catch (err: any) {
          alert(`Erro ao processar planilha Excel: ${err.message}`);
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      // Imagens não podem ser lidas via OCR no front-end puro
      alert(
        'Arquivos de imagem (PNG/JPG) não podem ser processados diretamente.\n\n' +
        'Por favor, converta a imagem em uma planilha Excel (.xlsx) ou arquivo CSV (.csv) ' +
        'e faça o upload novamente.\n\n' +
        'Dica: Você pode copiar a tabela da imagem manualmente para o Excel ou usar uma ferramenta online de OCR.'
      );
      setIsProcessing(false);
      setFileName(null);
    } else {
      alert('Formato de arquivo não suportado. Envie um arquivo .csv, .xlsx ou .xls');
      setIsProcessing(false);
      setFileName(null);
    }
  };

  const handleRows = (rawRows: any[]) => {
    if (targetModule === 'sales') {
      setSalesParsed(parseSalesRows(rawRows));
    } else if (targetModule === 'delinquency') {
      validateDelinquencyRows(rawRows);
    } else if (targetModule === 'customers') {
      validateCustomerRows(rawRows);
    } else {
      validateFinancialRows(rawRows);
    }
  };

  // ── Validação financeiro/econômico ────────────────────────────────────────

  const validateFinancialRows = (rawRows: any[]) => {
    if (!rawRows || rawRows.length === 0) {
      setValidationResults([]);
      return;
    }

    const validated: ValidationRowResult[] = rawRows.map((row: any, idx: number) => {
      const errors: string[] = [];

      const rawDate = (row.data || row.Data || row['DATA'] || row.date || '').toString().trim();
      const rawType = (row.tipo || row.Tipo || row['TIPO'] || row.categoria || row.type || '').toString().trim();
      const rawDesc = (row.descricao || row.Descricao || row['DESCRIÇÃO'] || row.historico || '').toString().trim();
      const rawVal = (row.valor || row.Valor || row['VALOR'] || row.monto || '').toString().trim();
      const rawCust = (row.cliente || row.Cliente || row['CLIENTE'] || '').toString().trim();

      if (!rawDate) errors.push('Data ou Mês de referência ausente');
      if (!rawType) errors.push('Tipo/Categoria de lançamento não informado');
      if (!rawVal) {
        errors.push('Valor numérico ausente');
      } else {
        const numVal = parseFloat(rawVal.replace('R$', '').replace(/\./g, '').replace(',', '.'));
        if (isNaN(numVal) || numVal <= 0) {
          errors.push('Valor numérico zerado ou inválido');
        }
      }

      return {
        rowNumber: idx + 1,
        rawDate,
        rawType,
        rawDescription: rawDesc,
        rawValue: rawVal,
        rawCustomer: rawCust,
        status: errors.length === 0 ? 'valid' : 'invalid',
        errors,
      };
    });

    setValidationResults(validated);
  };

  // ── Validação de clientes ──────────────────────────────────────────────────

  const validateCustomerRows = (rawRows: any[]) => {
    if (!rawRows || rawRows.length === 0) {
      setValidationResults([]);
      return;
    }

    const validated: ValidationRowResult[] = rawRows.map((row: any, idx: number) => {
      const errors: string[] = [];

      // Código do cliente (CHAVE = cod_cliente)
      const rawCode = pick(row, [
        'cod_cliente', 'Cod_Cliente', 'COD_CLIENTE', 'codigo_cliente',
        'codigo', 'Código', 'Codigo', 'CODIGO', 'cod', 'Cod', 'COD', 'id',
      ]);

      const personType = pick(row, ['tipo_pessoa', 'Tipo_Pessoa', 'TIPO_PESSOA', 'tipoPessoa']);

      // Razão social / nome — obrigatório
      const rawName = pick(row, [
        'razao_social', 'Razao Social', 'Razão Social', 'RAZAO SOCIAL', 'razaosocial',
        'nome', 'Nome', 'NOME', 'cliente', 'Cliente', 'CLIENTE', 'name', 'Name',
      ]);

      // CNPJ / CPF — a planilha traz colunas separadas cnpj e cpf
      const rawCnpj = pick(row, [
        'cnpj_cpf', 'cnpj', 'CNPJ', 'CNPJ/CPF', 'cnpj/cpf', 'documento',
      ]);
      const rawCpf = pick(row, ['cpf', 'CPF']);
      const cnpjCpf = rawCnpj || rawCpf;

      const rawFantasia = pick(row, [
        'nome_fantasia', 'fantasia', 'Fantasia', 'Nome Fantasia', 'FANTASIA',
      ]);

      // Limite de crédito — a planilha usa "valorLimiteCredito"
      const rawLimit = pick(row, [
        'valorLimiteCredito', 'valor_limite_credito', 'limite_credito',
        'Limite', 'limite', 'LIMITE', 'Limite Crédito', 'limite credito',
      ]) || '0';

      // Contato — planilha usa Contato1_Nome; fallback para vendedor_responsavel
      const rawContact = pick(row, [
        'contato', 'Contato', 'CONTATO', 'Contato1_Nome', 'responsavel', 'Responsável',
      ]);

      // Telefone / Celular (a planilha tem os dois)
      const rawPhone = pick(row, ['telefone', 'Telefone', 'TELEFONE', 'fone', 'Contato1_Telefone1']);
      const rawCell = pick(row, ['celular', 'Celular', 'cel', 'CELULAR']);

      const rawEmail = pick(row, ['email', 'Email', 'E-mail', 'e-mail', 'EMAIL']);
      const rawCity = pick(row, ['cidade', 'Cidade', 'CIDADE', 'city']);
      const rawState = pick(row, ['estado', 'Estado', 'UF', 'uf']);
      const rawAddress = pick(row, ['endereco', 'Endereço', 'Endereco', 'ENDERECO', 'logradouro']);
      const rawNumber = pick(row, ['numero', 'Número', 'Numero', 'NUMERO']);
      const rawNeighborhood = pick(row, ['bairro', 'Bairro', 'BAIRRO']);
      const rawZip = pick(row, ['cep', 'CEP']);
      const rawSeller = pick(row, ['vendedor_responsavel', 'Vendedor Responsável', 'vendedor']);

      if (!rawName) errors.push('Razão Social / Nome do cliente é obrigatório');

      const parsedCustomer: Partial<Customer> = errors.length === 0 ? {
        code: rawCode,
        name: rawName,
        tradeName: rawFantasia,
        cnpjCpf,
        contactName: rawContact,
        phone: (rawPhone || rawCell).trim(),
        cellphone: (rawCell || rawPhone).trim(),
        email: rawEmail,
        city: rawCity,
        state: rawState,
        creditLimit: parseAmount(rawLimit),
        personType,
        address: rawAddress,
        addressNumber: rawNumber,
        neighborhood: rawNeighborhood,
        zipCode: rawZip,
        sellerResponsible: rawSeller,
      } : undefined;

      return {
        rowNumber: idx + 1,
        rawDate: rawCode,          // exibição: código
        rawType: rawName,          // exibição: nome
        rawDescription: rawFantasia,
        rawValue: rawLimit,
        rawCustomer: cnpjCpf,
        parsedCustomer,
        status: errors.length === 0 ? 'valid' : 'invalid',
        errors,
      };
    });

    setValidationResults(validated);
  };

  // ── Validação de inadimplência ────────────────────────────────────────────

  /**
   * A leitura do RFN029 é feita pelo parser central (`parseDelinquencyRows`),
   * que reconhece os cabeçalhos por nome normalizado — acento, caixa e espaços
   * no export do ERP deixam de quebrar a carga. O que sobra aqui é só a
   * projeção do título já lido para as linhas de conferência da tela.
   */
  const validateDelinquencyRows = (rawRows: any[]) => {
    if (!rawRows || rawRows.length === 0) {
      setDelinquencyResults([]);
      setDelinquencyMeta(null);
      return;
    }

    const parsed = parseDelinquencyRows(rawRows);

    const errorsByRow = new Map<number, string[]>();
    parsed.errors.forEach((e) => {
      errorsByRow.set(e.rowNumber, [...(errorsByRow.get(e.rowNumber) || []), e.message]);
    });

    const validRows: DelinquencyValidationRowResult[] = parsed.titles.map((t, idx) => ({
      rowNumber: idx + 1,
      rawTitleNumber: t.titleNumber,
      rawCustomerName: t.customerName,
      rawCustomerCode: t.customerCode,
      rawSellerName: t.sellerName || '',
      rawSellerCode: t.sellerCode || '',
      rawCnpjCpf: t.cnpjCpf,
      rawIssueDate: t.issueDate,
      rawDueDate: t.dueDate,
      rawOriginalAmount: String(t.originalAmount),
      rawUpdatedAmount: String(t.updatedAmount),
      rawDaysOverdue: String(t.daysOverdue),
      rawAgingBucket: t.agingBucket,
      rawCollectionStatus: t.collectionStatus,
      rawNotes: t.notes || '',
      rawLancamento: t.lancamento || '',
      rawCustomerPhone: t.customerPhone || '',
      status: 'valid',
      errors: [],
      parsedTitle: t,
    }));

    // Linhas recusadas aparecem na conferência com o motivo, em vez de sumirem.
    const rejectedRows: DelinquencyValidationRowResult[] = parsed.errors.map((e, i) => ({
      rowNumber: validRows.length + i + 1,
      rawTitleNumber: '', rawCustomerName: `Linha ${e.rowNumber} da planilha`, rawCustomerCode: '',
      rawSellerName: '', rawSellerCode: '', rawCnpjCpf: '', rawIssueDate: '', rawDueDate: '',
      rawOriginalAmount: '', rawUpdatedAmount: '', rawDaysOverdue: '', rawAgingBucket: '',
      rawCollectionStatus: '', rawNotes: '', rawLancamento: '', rawCustomerPhone: '',
      status: 'invalid',
      errors: [e.message],
    }));

    setDelinquencyMeta({
      totalRows: rawRows.length,
      titleRows: parsed.titles.length,
      occurrenceRows: parsed.ignoredOccurrenceRows,
      duplicateKeys: parsed.duplicateKeys,
      missingHeaders: parsed.missingHeaders,
      extraHeaders: parsed.extraHeaders,
    });
    setDelinquencyResults([...validRows, ...rejectedRows]);
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // ── Commit ────────────────────────────────────────────────────────────────

  const handleCommitSales = async () => {
    if (!salesParsed || !onCommitSalesImport) return;
    setIsCommittingSales(true);
    try {
      await onCommitSalesImport(salesParsed.items);
      setImportSuccessMsg(
        `${salesParsed.items.length.toLocaleString('pt-BR')} linhas de venda importadas. ` +
        'A equipe de vendas foi sincronizada com o cadastro de vendedores.'
      );
      setSalesParsed(null);
      setFileName(null);
    } catch (err: any) {
      alert(`Erro ao importar vendas: ${err?.message || err}`);
    } finally {
      setIsCommittingSales(false);
    }
  };

  const handleCommit = () => {
    if (targetModule === 'delinquency') {
      const validRows = delinquencyResults.filter((r) => r.status === 'valid');
      if (validRows.length === 0) {
        alert('Nenhum registro válido para importar.');
        return;
      }
      onCommitDelinquencyImport(validRows);
      setImportSuccessMsg(`${validRows.length} título(s) inadimplente(s) importados com sucesso!`);
      setDelinquencyResults([]);
      setFileName(null);
    } else {
      const validRows = validationResults.filter((r) => r.status === 'valid');
      if (validRows.length === 0) {
        alert('Nenhum registro válido para importar.');
        return;
      }
      onCommitImport(validRows, year, targetModule);
      setImportSuccessMsg(`${validRows.length} lançamentos importados e atualizados nos registros!`);
      setValidationResults([]);
      setFileName(null);
    }
  };

  // ── Cálculos de sumário ───────────────────────────────────────────────────

  const activeResults = targetModule === 'delinquency' ? delinquencyResults : validationResults;
  const validRowsCount = activeResults.filter((r) => r.status === 'valid').length;
  const invalidRowsCount = activeResults.filter((r) => r.status === 'invalid').length;

  const filteredDelinquency = delinquencyResults.filter((r) => {
    if (filterStatus === 'valid') return r.status === 'valid';
    if (filterStatus === 'invalid') return r.status === 'invalid';
    return true;
  });

  const filteredFinancial = validationResults.filter((r) => {
    if (filterStatus === 'valid') return r.status === 'valid';
    if (filterStatus === 'invalid') return r.status === 'invalid';
    return true;
  });

  const totalDelinquentValue = delinquencyResults
    .filter((r) => r.status === 'valid')
    .reduce((acc, r) => acc + parseAmount(r.rawOriginalAmount), 0);

  const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              UPLOAD AUTOMÁTICO
            </span>
            <span className="text-xs text-[#8B7D6B]">• Formatos: .XLSX, .XLS, .CSV</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Importação de Dados com Validação Automática</h2>
          <p className="text-xs text-[#8B7D6B]">
            Envie planilhas financeiras, de DRE ou de inadimplência para validação prévia antes da consolidação no banco.
          </p>
        </div>

        {/* Configuration Target */}
        <div className="flex items-center space-x-3 bg-[#F9F7F2] p-2 rounded-lg border border-[#EAE6DF]">
          <div>
            <label className="block text-[10px] font-bold text-[#8B7D6B] uppercase">Módulo Alvo</label>
            <select
              value={targetModule}
              onChange={(e) => {
                setTargetModule(e.target.value as any);
                setValidationResults([]);
                setDelinquencyResults([]);
                setSalesParsed(null);
                setFileName(null);
                setImportSuccessMsg(null);
              }}
              className="bg-white border border-[#EAE6DF] text-xs text-[#2D2A26] rounded p-1 font-bold focus:outline-none focus:border-[#C19A6B]"
            >
              <option value="financial">Resultado Financeiro (Caixa)</option>
              <option value="economic">Resultado Econômico (DRE)</option>
              <option value="payables">Contas a Pagar (Planilha RFN006)</option>
              <option value="statement">Extrato Financeiro (Bancos / Tesouraria)</option>
              <option value="customers">Carteira de Clientes</option>
              <option value="delinquency">Inadimplência (Títulos Vencidos)</option>
              {onCommitSalesImport && (
                <option value="sales">Vendas de Produtos (Planilha RPR001)</option>
              )}
            </select>
          </div>

          {targetModule !== 'delinquency' && targetModule !== 'customers' && targetModule !== 'sales' && targetModule !== 'payables' && targetModule !== 'statement' && (
            <div>
              <label className="block text-[10px] font-bold text-[#8B7D6B] uppercase">Ano Base</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                className="bg-white border border-[#EAE6DF] text-xs text-[#2D2A26] rounded p-1 font-bold focus:outline-none focus:border-[#C19A6B]"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Guia de colunas para Contas a Pagar (RFN006) */}
      {targetModule === 'payables' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-900">Importação de Contas a Pagar (Relatório RFN006)</p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Envie o arquivo <strong>RFN006 (Totais Pagos por Credor)</strong> em formato Excel (.xlsx/.xls).
                O sistema efetuará o mapeamento dos credores (`TituloPessoaCod`) para o `cod_cliente` e executará a conciliação automática contra o Extrato Financeiro.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Guia de colunas para Extrato Financeiro (Bancos e Tesouraria) */}
      {targetModule === 'statement' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-900">Importação do Extrato Financeiro (Bancos & Caixa/Tesouraria)</p>
              <p className="text-[11px] text-blue-800 mt-0.5">
                Envie arquivos do <strong>Bradesco</strong> (.xlsx/.csv), <strong>PagSeguro</strong> (.xlsx) ou relatórios de caixa/tesouraria <strong>RFN019</strong>.
                Estes extratos servem de base para a conciliação bancária e baixa de contas a pagar.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Guia de colunas para Vendas de Produtos (RPR001) */}
      {targetModule === 'sales' && (
        <div className="bg-[#F9F7F2] border border-[#C19A6B]/40 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#C19A6B] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-[#2D2A26]">
                Layout RPR001 — Venda Produto Intermediário ({RPR001_EXPECTED_HEADERS.length} colunas)
              </p>
              <p className="text-[11px] text-[#6B5A45] mt-0.5">
                Uma linha por ITEM de nota. Nenhuma coluna é descartada. A chave de deduplicação é
                <span className="font-mono"> NF_EmpresaCod | NF_Codigo | NFItem_Cod</span> — reimportar o mesmo
                relatório atualiza as linhas em vez de duplicá-las.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
            {[
              { col: 'NFItem_ProdutoCod', label: 'Vincula ao Estoque (Produto_Codigo)', key: true },
              { col: 'NF_PessoaCod', label: 'Vincula ao Cadastro de Clientes (cod_cliente)', key: true },
              { col: 'NF_VendedorCod / NF_UsuNomVendedor', label: 'Cadastra e vincula o vendedor', key: true },
              { col: 'NFItem_VlUnit × NFItem_Qtde', label: 'Base do valor bruto da linha', key: false },
              { col: 'NFItem_VlDesc / NFItem_VlAcres', label: 'Desconto e acréscimo', key: false },
              { col: 'NF_ProdCusto', label: 'Custo TOTAL da linha (não é unitário)', key: false },
            ].map((item) => (
              <div key={item.col} className="bg-white border border-[#EAE6DF] rounded p-2">
                <p className="font-bold text-[#2D2A26]">
                  {item.label} {item.key && <span className="text-[#C19A6B]">★</span>}
                </p>
                <p className="text-[#8B7D6B] font-mono leading-tight mt-0.5">{item.col}</p>
              </div>
            ))}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-[11px] font-bold text-amber-900 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> Três armadilhas conhecidas deste relatório
            </p>
            <ul className="text-[10px] text-amber-800 mt-1 space-y-0.5 list-disc list-inside leading-relaxed">
              <li>
                <span className="font-mono">NFItem_VlBruto</span> é o preço <strong>unitário</strong>, não o total da
                linha — e diverge de <span className="font-mono">NFItem_VlUnit</span> em parte das linhas. O sistema
                usa <span className="font-mono">NFItem_VlUnit</span>, que é o que fecha com o total da nota.
              </li>
              <li>
                <span className="font-mono">NF_ProdCusto</span> é o custo <strong>total</strong> da linha. Tratá-lo como
                unitário multiplica o CMV.
              </li>
              <li>
                <span className="font-mono">NFItem_PercMargemGer</span> vem como fração (0,73) e
                <span className="font-mono"> NFItem_PercMargemCont</span> como percentual (73,56) — mesmo número em
                escalas diferentes. Só o segundo é usado.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Guia de colunas para clientes */}
      {targetModule === 'customers' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-emerald-800">Colunas esperadas na planilha de clientes</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                O sistema aceita variações de cabeçalho. Campos principais destacados com *.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-[10px]">
            {[
              { col: 'cod_cliente (CHAVE)', label: 'Código Cliente', req: true },
              { col: 'razao_social / Nome / Cliente', label: 'Razão Social / Nome', req: true },
              { col: 'cnpj / cpf', label: 'CNPJ ou CPF', req: false },
              { col: 'nome_fantasia', label: 'Nome Fantasia', req: false },
              { col: 'Contato1_Nome / contato', label: 'Contato', req: false },
              { col: 'telefone / celular', label: 'Telefone / Celular', req: false },
              { col: 'email', label: 'E-mail', req: false },
              { col: 'cidade / bairro / endereco', label: 'Endereço', req: false },
              { col: 'estado / UF', label: 'UF (Estado)', req: false },
              { col: 'valorLimiteCredito', label: 'Limite de Crédito', req: false },
            ].map((item) => (
              <div key={item.col} className="bg-white border border-emerald-100 rounded p-2">
                <p className="font-bold text-emerald-900">
                  {item.label} {item.req && <span className="text-red-500">*</span>}
                </p>
                <p className="text-emerald-600 font-mono leading-tight mt-0.5">{item.col}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guia de colunas para inadimplência */}
      {targetModule === 'delinquency' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-800">
                Layout RFN029 — Títulos Atrasados por Vendedor ({RFN029_EXPECTED_HEADERS.length} colunas)
              </p>
              <p className="text-[11px] text-blue-700 mt-0.5">
                As colunas são reconhecidas por nome normalizado (acento, caixa e espaços não importam).
                Nenhuma coluna do relatório é descartada. Obrigatórias marcadas com *.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-[10px]">
            {[
              { col: 'Devedor', label: 'Nome do Devedor/Cliente', req: true },
              { col: 'Vencimento', label: 'Data Vencimento', req: true },
              { col: 'Valor', label: 'Valor Original (R$)', req: true },
              { col: 'Pessoa_CodigoDevedor', label: 'Código do Cliente (CHAVE de vínculo)', req: false },
              { col: 'Lançamento', label: 'Nº do Lançamento (ERP)', req: false },
              { col: 'DevedorTelefone', label: 'Telefone / WhatsApp', req: false },
              { col: 'Emissão', label: 'Data Emissão', req: false },
              { col: 'Titulo_Numero + Titulo_Parcela', label: 'Nº do Título / Parcela', req: false },
              { col: 'DevedorCpfCnpj', label: 'CNPJ ou CPF', req: false },
              { col: 'Juros + Multa', label: 'Encargos (Valor Atualizado)', req: false },
              { col: 'Atr', label: 'Dias em Atraso', req: false },
              { col: 'Vendedor + VendedorTelefone', label: 'Vendedor', req: false },
              { col: 'Titulo_AgenteCobradorDes / Tipo', label: 'Agente e Forma de Cobrança', req: false },
              { col: 'Departamento / Nro_Pedido / Chassi', label: 'Origem do título', req: false },
              { col: 'Ocorrencia / TituloHistorico_*', label: 'Última movimentação', req: false },
              { col: 'Registro = "T" (só títulos)', label: 'Filtro automático', req: false },
            ].map((item) => (
              <div key={item.col} className="bg-white border border-blue-100 rounded p-2">
                <p className="font-bold text-blue-900">
                  {item.label} {item.req && <span className="text-red-500">*</span>}
                </p>
                <p className="text-blue-600 font-mono leading-tight mt-0.5">{item.col}</p>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <Image className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800">
              <strong>Importação por Imagem:</strong> O sistema não processa imagens diretamente (PNG/JPG).
              Para importar dados de uma imagem ou print, copie os dados para uma planilha Excel (.xlsx)
              ou CSV e faça o upload.
            </p>
          </div>
        </div>
      )}

      {importSuccessMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-bold">{importSuccessMsg}</p>
        </div>
      )}

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
          isDragOver
            ? 'border-[#C19A6B] bg-[#C19A6B]/10 scale-[1.01]'
            : 'border-[#EAE6DF] bg-white hover:border-[#C19A6B]'
        }`}
      >
        <div className="max-w-md mx-auto space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#C19A6B]/15 text-[#C19A6B] flex items-center justify-center mx-auto border border-[#C19A6B]/30">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#2D2A26]">
              {targetModule === 'delinquency'
                ? 'Arraste sua planilha de inadimplência aqui'
                : 'Arraste e solte sua planilha Excel ou arquivo CSV aqui'}
            </p>
            <p className="text-xs text-[#8B7D6B] mt-0.5">
              {targetModule === 'delinquency'
                ? 'Formatos aceitos: .xlsx, .xls, .csv — Validação automática dos títulos'
                : 'Validação automática de campos antes da consolidação final'}
            </p>
          </div>
          <div>
            <label className="px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg cursor-pointer shadow-xs inline-block transition-all">
              <span>Selecionar Arquivo do Computador</span>
              <input
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
          </div>
          {fileName && (
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#F3F1ED] text-xs text-[#C19A6B] font-mono border border-[#EAE6DF]">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{fileName}</span>
            </div>
          )}
          {isProcessing && (
            <p className="text-xs text-[#8B7D6B] animate-pulse">Processando arquivo...</p>
          )}
        </div>
      </div>

      {/* ── Resultados: Vendas de Produtos (RPR001) ──────────────────────── */}
      {targetModule === 'sales' && salesParsed && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl p-6 shadow-xs space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-[#EAE6DF]">
            <div className="bg-[#F9F7F2] rounded-lg p-3 border border-[#EAE6DF]">
              <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Itens lidos</p>
              <p className="text-lg font-black text-[#2D2A26]">
                {salesParsed.items.length.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-[#F9F7F2] rounded-lg p-3 border border-[#EAE6DF]">
              <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Notas distintas</p>
              <p className="text-lg font-black text-[#2D2A26]">
                {new Set(salesParsed.items.map((i) => `${i.companyCode}|${i.invoiceCode}`)).size.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
              <p className="text-[10px] font-bold text-emerald-700 uppercase">Receita líquida</p>
              <p className="text-lg font-black text-emerald-800">
                {formatCurrency(salesParsed.items.reduce((a, i) => a + i.netAmount, 0))}
              </p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-[10px] font-bold text-amber-700 uppercase">Desconto concedido</p>
              <p className="text-lg font-black text-amber-800">
                {formatCurrency(salesParsed.items.reduce((a, i) => a + i.discountAmount, 0))}
              </p>
            </div>
          </div>

          {/* Diagnóstico de integridade — o que o gestor precisa saber antes */}
          <div>
            <p className="text-xs font-bold text-[#2D2A26] mb-2">Diagnóstico do arquivo</p>
            <div className="space-y-1.5 text-[11px]">
              {salesParsed.missingHeaders.length > 0 && (
                <DiagLine tone="warn">
                  Faltam {salesParsed.missingHeaders.length} colunas esperadas (
                  {salesParsed.missingHeaders.slice(0, 5).join(', ')}
                  {salesParsed.missingHeaders.length > 5 ? '…' : ''}). Os campos ausentes ficam vazios.
                </DiagLine>
              )}
              {salesParsed.integrity.unitPriceMismatch > 0 && (
                <DiagLine tone="warn">
                  <strong>{salesParsed.integrity.unitPriceMismatch.toLocaleString('pt-BR')}</strong> linhas com
                  NFItem_VlBruto diferente de NFItem_VlUnit. O sistema adota NFItem_VlUnit, que fecha com o total
                  da nota em 100% dos casos.
                </DiagLine>
              )}
              {salesParsed.integrity.marginMismatch > 0 && (
                <DiagLine tone="warn">
                  <strong>{salesParsed.integrity.marginMismatch.toLocaleString('pt-BR')}</strong> linhas em que a
                  margem informada pelo ERP não fecha com Total − Custo − Impostos. Divergência líquida de{' '}
                  <strong>{formatCurrency(salesParsed.integrity.marginMismatchAmount)}</strong>. As duas margens
                  ficam gravadas para conferência na tela de Vendas.
                </DiagLine>
              )}
              {salesParsed.integrity.totalMismatch > 0 && (
                <DiagLine tone="error">
                  <strong>{salesParsed.integrity.totalMismatch.toLocaleString('pt-BR')}</strong> linhas em que
                  NFItem_VlTotal não fecha com Unitário × Qtde − Desconto + Acréscimo.
                </DiagLine>
              )}
              {salesParsed.integrity.zeroCost > 0 && (
                <DiagLine tone="warn">
                  <strong>{salesParsed.integrity.zeroCost.toLocaleString('pt-BR')}</strong> linhas com custo zerado —
                  a margem delas é fictícia e aparecem marcadas na auditoria.
                </DiagLine>
              )}
              {salesParsed.duplicateKeys > 0 && (
                <DiagLine tone="info">
                  {salesParsed.duplicateKeys.toLocaleString('pt-BR')} chaves repetidas no arquivo foram consolidadas.
                </DiagLine>
              )}
              {salesParsed.errors.length > 0 && (
                <DiagLine tone="error">
                  {salesParsed.errors.length.toLocaleString('pt-BR')} linhas com erro de leitura serão ignoradas
                  (ex.: {salesParsed.errors[0]?.message}).
                </DiagLine>
              )}
              {salesParsed.missingHeaders.length === 0 &&
                salesParsed.errors.length === 0 &&
                salesParsed.integrity.totalMismatch === 0 && (
                  <DiagLine tone="ok">Layout aderente e totais consistentes.</DiagLine>
                )}
            </div>
          </div>

          {/* Prévia */}
          <div className="overflow-x-auto border border-[#EAE6DF] rounded-lg">
            <table className="w-full text-[11px]">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B]">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold uppercase text-[9px]">Emissão</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase text-[9px]">NF</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase text-[9px]">Vendedor</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase text-[9px]">Cliente</th>
                  <th className="px-2 py-1.5 text-left font-bold uppercase text-[9px]">Produto</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase text-[9px]">Qtd</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase text-[9px]">Desc.</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase text-[9px]">Total</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase text-[9px]">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F1ED]">
                {salesParsed.items.slice(0, 25).map((i) => (
                  <tr key={i.dedupeKey} className="hover:bg-[#F9F7F2]">
                    <td className="px-2 py-1.5 whitespace-nowrap">{i.issueDate.split('-').reverse().join('/')}</td>
                    <td className="px-2 py-1.5">{i.invoiceNumber}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{i.sellerName}</td>
                    <td className="px-2 py-1.5 max-w-[180px] truncate" title={i.customerName}>{i.customerName}</td>
                    <td className="px-2 py-1.5 max-w-[200px] truncate" title={i.productDescription}>{i.productDescription}</td>
                    <td className="px-2 py-1.5 text-right">{i.quantity}</td>
                    <td className="px-2 py-1.5 text-right">{i.discountAmount ? formatCurrency(i.discountAmount) : '—'}</td>
                    <td className="px-2 py-1.5 text-right font-bold">{formatCurrency(i.netAmount)}</td>
                    <td className={`px-2 py-1.5 text-right ${i.marginCalculated < 0 ? 'text-red-600 font-bold' : ''}`}>
                      {formatCurrency(i.marginCalculated)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {salesParsed.items.length > 25 && (
            <p className="text-[10px] text-[#8B7D6B] text-center">
              Prévia das 25 primeiras linhas de {salesParsed.items.length.toLocaleString('pt-BR')}.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#EAE6DF]">
            <p className="text-[11px] text-[#8B7D6B]">
              Ao confirmar, as vendas são gravadas (atualizando as existentes, sem duplicar) e a equipe de
              vendas é cadastrada automaticamente, para que a inadimplência encontre o responsável.
            </p>
            <button
              onClick={handleCommitSales}
              disabled={!salesParsed.items.length || isCommittingSales}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-[#C19A6B] text-white hover:bg-[#A9835A] disabled:opacity-40 whitespace-nowrap transition-colors"
            >
              {isCommittingSales ? 'Importando...' : 'Confirmar importação'}
            </button>
          </div>
        </div>
      )}

      {/* ── Resultados: Inadimplência ─────────────────────────────────────── */}
      {targetModule === 'delinquency' && delinquencyResults.length > 0 && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl p-6 shadow-xs space-y-4">
          {/* Sumário de valores */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-[#EAE6DF]">
            <div className="bg-[#F9F7F2] rounded-lg p-3 border border-[#EAE6DF]">
              <p className="text-[10px] font-bold text-[#8B7D6B] uppercase">Total de Linhas</p>
              <p className="text-lg font-black text-[#2D2A26]">{delinquencyResults.length}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
              <p className="text-[10px] font-bold text-emerald-700 uppercase">Títulos Válidos</p>
              <p className="text-lg font-black text-emerald-800">{validRowsCount}</p>
            </div>
            <div className="bg-rose-50 rounded-lg p-3 border border-rose-200">
              <p className="text-[10px] font-bold text-rose-700 uppercase">Com Erro</p>
              <p className="text-lg font-black text-rose-800">{invalidRowsCount}</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-[10px] font-bold text-amber-700 uppercase">Total Inadimplente</p>
              <p className="text-sm font-black text-amber-800">{formatCurrency(totalDelinquentValue)}</p>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              Validação dos Títulos Inadimplentes ({delinquencyResults.length} linhas analisadas)
            </h3>
            <div className="flex items-center space-x-2">
              {(['all', 'valid', 'invalid'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                    filterStatus === f
                      ? f === 'valid'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : f === 'invalid'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-[#2D2A26] text-white border-[#2D2A26]'
                      : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF]'
                  }`}
                >
                  {f === 'all' ? `Todos (${delinquencyResults.length})` : f === 'valid' ? `Válidos (${validRowsCount})` : `Erros (${invalidRowsCount})`}
                </button>
              ))}
            </div>
          </div>

          {/* Diagnóstico da leitura — mostra o que foi lido e o que foi descartado */}
          {delinquencyMeta && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5">
                <p className="text-[#8B7D6B] font-bold">Linhas no arquivo</p>
                <p className="text-sm font-bold text-[#2D2A26]">{delinquencyMeta.totalRows}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                <p className="text-emerald-700 font-bold">Títulos (Registro = T)</p>
                <p className="text-sm font-bold text-emerald-900">{delinquencyMeta.titleRows}</p>
              </div>
              <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5">
                <p className="text-[#8B7D6B] font-bold">Histórico ignorado</p>
                <p className="text-sm font-bold text-[#2D2A26]">{delinquencyMeta.occurrenceRows}</p>
              </div>
              <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5">
                <p className="text-[#8B7D6B] font-bold">Duplicatas unificadas</p>
                <p className="text-sm font-bold text-[#2D2A26]">{delinquencyMeta.duplicateKeys}</p>
              </div>
              {delinquencyMeta.missingHeaders.length > 0 && (
                <div className="col-span-2 sm:col-span-4 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-800">
                  <strong>Colunas do layout RFN029 ausentes:</strong> {delinquencyMeta.missingHeaders.join(', ')}
                </div>
              )}
              {delinquencyMeta.extraHeaders.length > 0 && (
                <div className="col-span-2 sm:col-span-4 bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-blue-800">
                  <strong>Colunas extras (não previstas no layout):</strong> {delinquencyMeta.extraHeaders.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Tabela de inadimplência */}
          <div className="overflow-x-auto max-h-96 border border-[#EAE6DF] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] sticky top-0">
                <tr className="border-b border-[#EAE6DF] font-bold">
                  <th className="p-2.5 w-10 text-center">#</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Lançamento</th>
                  <th className="p-2.5">Nº Título</th>
                  <th className="p-2.5">Cód. Cliente</th>
                  <th className="p-2.5">Cliente</th>
                  <th className="p-2.5">Telefone</th>
                  <th className="p-2.5">CNPJ/CPF</th>
                  <th className="p-2.5">Emissão</th>
                  <th className="p-2.5">Vencimento</th>
                  <th className="p-2.5 text-center">Dias Atraso</th>
                  <th className="p-2.5 text-center">Aging</th>
                  <th className="p-2.5 text-right">Valor Original</th>
                  <th className="p-2.5">Status Cobrança</th>
                  <th className="p-2.5">Erros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
                {filteredDelinquency.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`hover:bg-[#FDFBF7] ${row.status === 'invalid' ? 'bg-rose-50/40' : ''}`}
                  >
                    <td className="p-2.5 text-center text-[#8B7D6B] font-mono">{row.rowNumber}</td>
                    <td className="p-2.5">
                      {row.status === 'valid' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">VÁLIDO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">ERRO</span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono text-[10px] text-[#8B7D6B]">{row.rawLancamento || '-'}</td>
                    <td className="p-2.5 font-mono text-[#C19A6B] font-bold">{row.rawTitleNumber || '-'}</td>
                    <td className="p-2.5 font-mono text-[10px]">{row.rawCustomerCode || '-'}</td>
                    <td className="p-2.5 font-medium">{row.rawCustomerName || '-'}</td>
                    <td className="p-2.5 font-mono text-[10px]">{formatPhoneBr(row.rawCustomerPhone) || '-'}</td>
                    <td className="p-2.5 font-mono text-[10px]">{row.rawCnpjCpf || '-'}</td>
                    <td className="p-2.5 font-mono">{row.rawIssueDate || '-'}</td>
                    <td className="p-2.5 font-mono">{row.rawDueDate || '-'}</td>
                    <td className="p-2.5 text-center">
                      {row.rawDaysOverdue ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                          {row.rawDaysOverdue}d
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-2.5 text-center font-mono">{row.rawAgingBucket || '-'}</td>
                    <td className="p-2.5 text-right font-bold text-[#2D2A26]">{row.rawOriginalAmount || '-'}</td>
                    <td className="p-2.5">{row.rawCollectionStatus || 'Aguardando'}</td>
                    <td className="p-2.5 text-rose-700 text-[11px]">
                      {row.errors.length > 0 ? row.errors.join(' | ') : '✓'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[#8B7D6B]">
              <span>Serão importados </span>
              <strong className="text-rose-700 font-bold">{validRowsCount} título(s) inadimplente(s)</strong>
              <span> no valor total de </span>
              <strong className="text-rose-700">{formatCurrency(totalDelinquentValue)}</strong>
            </div>
            <button
              onClick={handleCommit}
              disabled={validRowsCount === 0}
              className="px-6 py-2.5 text-xs font-bold bg-rose-700 hover:bg-rose-800 text-white rounded-lg shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirmar e Importar Títulos ({validRowsCount})</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Resultados: Financeiro/Econômico ──────────────────────────────── */}
      {targetModule !== 'delinquency' && validationResults.length > 0 && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EAE6DF] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Relatório de Validação dos Registros ({validationResults.length} linhas analisadas)
              </h3>
              <p className="text-xs text-[#8B7D6B]">Verificação automática de formatos, valores e categorias</p>
            </div>
            <div className="flex items-center space-x-2">
              {(['all', 'valid', 'invalid'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
                    filterStatus === f
                      ? f === 'valid'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : f === 'invalid'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-[#2D2A26] text-white border-[#2D2A26]'
                      : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF]'
                  }`}
                >
                  {f === 'all' ? `Todos (${validationResults.length})` : f === 'valid' ? `Válidos (${validRowsCount})` : `Incompletos (${invalidRowsCount})`}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-80 border border-[#EAE6DF] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] sticky top-0">
                <tr className="border-b border-[#EAE6DF] font-bold">
                  <th className="p-2.5 w-12 text-center">Linha</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Data / Mês</th>
                  <th className="p-2.5">Tipo / Categoria</th>
                  <th className="p-2.5">Descrição</th>
                  <th className="p-2.5 text-right">Valor</th>
                  <th className="p-2.5">Cliente (opcional)</th>
                  <th className="p-2.5">Validação de Inconsistências</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF] text-[#433E37] font-mono">
                {filteredFinancial.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`hover:bg-[#FDFBF7] ${row.status === 'invalid' ? 'bg-rose-50/50' : ''}`}
                  >
                    <td className="p-2.5 text-center text-[#8B7D6B]">{row.rowNumber}</td>
                    <td className="p-2.5">
                      {row.status === 'valid' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">VÁLIDO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">ERRO</span>
                      )}
                    </td>
                    <td className="p-2.5 font-sans font-medium">{row.rawDate || '-'}</td>
                    <td className="p-2.5 font-sans font-medium">{row.rawType || '-'}</td>
                    <td className="p-2.5 font-sans text-[#433E37] line-clamp-1">{row.rawDescription || '-'}</td>
                    <td className="p-2.5 text-right font-bold text-[#2D2A26]">{row.rawValue || '-'}</td>
                    <td className="p-2.5 font-sans text-[#433E37]">{row.rawCustomer || '-'}</td>
                    <td className="p-2.5 font-sans text-[11px] text-rose-700">
                      {row.errors.length > 0 ? row.errors.join(' | ') : 'Nenhuma inconsistência'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[#8B7D6B]">
              <span>Serão consolidados </span>
              <strong className="text-emerald-700 font-bold">{validRowsCount} lançamentos válidos</strong>
              <span> no módulo {targetModule === 'financial' ? 'Resultado Financeiro' : 'Resultado Econômico (DRE)'}.</span>
            </div>
            <button
              onClick={handleCommit}
              disabled={validRowsCount === 0}
              className="px-6 py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#C19A6B]" />
              <span>Confirmar e Importar no Banco ({validRowsCount})</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const DiagLine: React.FC<{ tone: 'ok' | 'info' | 'warn' | 'error'; children: React.ReactNode }> = ({ tone, children }) => {
  const styles = {
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    info: 'bg-slate-50 border-slate-200 text-slate-700',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    error: 'bg-rose-50 border-rose-200 text-rose-900',
  }[tone];
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;
  return (
    <div className={`rounded-lg border px-3 py-2 flex gap-2 items-start ${styles}`}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
};
