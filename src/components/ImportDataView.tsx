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
import { DelinquencyValidationRowResult, ValidationRowResult } from '../types';

interface ImportDataViewProps {
  onCommitImport: (
    validEntries: ValidationRowResult[],
    year: number,
    targetModule: 'economic' | 'financial' | 'customers' | 'delinquency'
  ) => void;
  onCommitDelinquencyImport: (
    validEntries: DelinquencyValidationRowResult[]
  ) => void;
  selectedYear: number;
  initialModule?: 'economic' | 'financial' | 'customers' | 'delinquency';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseAmount = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw
    .toString()
    .replace(/R\$\s?/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const normalizeStatus = (raw: string): string => {
  const map: Record<string, string> = {
    aguardando: 'Aguardando',
    'em cobrança': 'Em Cobrança',
    'em cobranca': 'Em Cobrança',
    negativado: 'Negativado',
    'acordo em andamento': 'Acordo em Andamento',
    judicial: 'Judicial',
  };
  return map[raw.toLowerCase().trim()] || 'Aguardando';
};

const normalizeAging = (raw: string, days: number): string => {
  if (raw) {
    const map: Record<string, string> = {
      '1-30': '1-30',
      '31-60': '31-60',
      '61-90': '61-90',
      '>90': '>90',
      '+90': '>90',
      'mais de 90': '>90',
    };
    const found = map[raw.trim()];
    if (found) return found;
  }
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '>90';
};

// ─── Component ───────────────────────────────────────────────────────────────

export const ImportDataView: React.FC<ImportDataViewProps> = ({
  onCommitImport,
  onCommitDelinquencyImport,
  selectedYear,
  initialModule,
}) => {
  const [targetModule, setTargetModule] = useState<'economic' | 'financial' | 'customers' | 'delinquency'>(initialModule || 'financial');
  const [year, setYear] = useState<number>(selectedYear || 2026);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  // Resultados financeiro/econômico
  const [validationResults, setValidationResults] = useState<ValidationRowResult[]>([]);
  // Resultados inadimplência
  const [delinquencyResults, setDelinquencyResults] = useState<DelinquencyValidationRowResult[]>([]);

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
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonRows = XLSX.utils.sheet_to_json(worksheet);
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
    if (targetModule === 'delinquency') {
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

      // Código do cliente
      const rawCode = (
        row['codigo'] || row['Código'] || row['Codigo'] || row['CODIGO'] ||
        row['cod'] || row['Cod'] || row['COD'] || row['id'] || ''
      ).toString().trim();

      // Razão social / nome — obrigatório
      const rawName = (
        row['razao_social'] || row['Razao Social'] || row['Razão Social'] ||
        row['RAZAO SOCIAL'] || row['razaosocial'] || row['nome'] || row['Nome'] ||
        row['NOME'] || row['cliente'] || row['Cliente'] || row['CLIENTE'] ||
        row['name'] || row['Name'] || ''
      ).toString().trim();

      // CNPJ / CPF
      const rawCnpj = (
        row['cnpj_cpf'] || row['cnpj'] || row['CNPJ'] || row['cpf'] || row['CPF'] ||
        row['CNPJ/CPF'] || row['cnpj/cpf'] || row['documento'] || ''
      ).toString().trim();

      // Nome fantasia
      const rawFantasia = (
        row['nome_fantasia'] || row['fantasia'] || row['Fantasia'] ||
        row['Nome Fantasia'] || row['FANTASIA'] || ''
      ).toString().trim();

      // Limite de crédito
      const rawLimit = (
        row['limite_credito'] || row['Limite'] || row['limite'] ||
        row['LIMITE'] || row['Limite Crédito'] || row['limite credito'] || '0'
      ).toString().trim();

      // Contato
      const rawContact = (
        row['contato'] || row['Contato'] || row['CONTATO'] ||
        row['responsavel'] || row['Responsável'] || ''
      ).toString().trim();

      // Telefone
      const rawPhone = (
        row['telefone'] || row['Telefone'] || row['TELEFONE'] ||
        row['fone'] || row['cel'] || row['Celular'] || ''
      ).toString().trim();

      // E-mail
      const rawEmail = (
        row['email'] || row['Email'] || row['E-mail'] ||
        row['e-mail'] || row['EMAIL'] || ''
      ).toString().trim();

      // Cidade
      const rawCity = (
        row['cidade'] || row['Cidade'] || row['CIDADE'] ||
        row['city'] || ''
      ).toString().trim();

      // Estado / UF
      const rawState = (
        row['estado'] || row['Estado'] || row['UF'] || row['uf'] || ''
      ).toString().trim();

      // Validação obrigatória
      if (!rawName) errors.push('Razão Social / Nome do cliente é obrigatório');

      return {
        rowNumber: idx + 1,
        rawDate: rawCode,          // reutilizando campo rawDate para código
        rawType: rawName,          // reutilizando campo rawType para nome
        rawDescription: rawFantasia,
        rawValue: rawLimit,
        rawCustomer: rawCnpj,
        // dados extras preservados como propriedades adicionais
        ...({ rawContact, rawPhone, rawEmail, rawCity, rawState } as any),
        status: errors.length === 0 ? 'valid' : 'invalid',
        errors,
      };
    });

    setValidationResults(validated);
  };

  // ── Validação de inadimplência ────────────────────────────────────────────

  const validateDelinquencyRows = (rawRows: any[]) => {
    if (!rawRows || rawRows.length === 0) {
      setDelinquencyResults([]);
      return;
    }

    const validated: DelinquencyValidationRowResult[] = rawRows.map((row: any, idx: number) => {
      const errors: string[] = [];

      // Mapeamento flexível de colunas (aceita variações de nome)
      const rawTitleNumber = (
        row['numero_titulo'] || row['Nº Título'] || row['N titulo'] || row['Titulo'] ||
        row['TITULO'] || row['titulo'] || row['number'] || row['Number'] || ''
      ).toString().trim();

      // Nome do cliente — aceita também coluna 'Devedor'
      const rawCustomerName = (
        row['Devedor'] || row['devedor'] || row['DEVEDOR'] ||
        row['cliente'] || row['Cliente'] || row['CLIENTE'] || row['cliente_nome'] ||
        row['Nome'] || row['nome'] || row['customer'] || ''
      ).toString().trim();

      // Código do cliente para vínculo — aceita 'cod_cliente'
      const rawCustomerCode = (
        row['cod_cliente'] || row['Cod_Cliente'] || row['COD_CLIENTE'] ||
        row['codigo_cliente'] || row['Código Cliente'] || row['codigo'] ||
        row['Cod'] || row['cod'] || ''
      ).toString().trim();

      const rawCnpjCpf = (
        row['cnpj_cpf'] || row['CNPJ'] || row['CPF'] || row['cnpj'] || row['cpf'] ||
        row['CNPJ/CPF'] || row['cnpj_cpf'] || ''
      ).toString().trim();

      const rawIssueDate = (
        row['data_emissao'] || row['Emissão'] || row['emissao'] || row['Emissao'] ||
        row['DATA EMISSAO'] || row['data emissao'] || ''
      ).toString().trim();

      const rawDueDate = (
        row['data_vencimento'] || row['Vencimento'] || row['vencimento'] || row['VENCIMENTO'] ||
        row['data vencimento'] || row['Due Date'] || ''
      ).toString().trim();

      const rawOriginalAmount = (
        row['valor_original'] || row['Valor Original'] || row['Valor'] || row['valor'] ||
        row['VALOR'] || row['original'] || row['amount'] || ''
      ).toString().trim();

      const rawUpdatedAmount = (
        row['valor_atualizado'] || row['Valor Atualizado'] || row['valor atualizado'] || ''
      ).toString().trim();

      const rawDaysOverdue = (
        row['dias_atraso'] || row['Dias Atraso'] || row['dias atraso'] || row['DIAS ATRASO'] ||
        row['Atraso'] || row['atraso'] || row['days'] || ''
      ).toString().trim();

      const rawAgingBucket = (
        row['faixa_aging'] || row['Aging'] || row['aging'] || row['AGING'] ||
        row['faixa'] || row['Faixa'] || ''
      ).toString().trim();

      const rawCollectionStatus = (
        row['status_cobranca'] || row['Status'] || row['status'] || row['STATUS'] ||
        row['Status Cobrança'] || row['status cobranca'] || ''
      ).toString().trim();

      const rawNotes = (
        row['observacoes'] || row['Observações'] || row['obs'] || row['Obs'] ||
        row['notas'] || row['notes'] || ''
      ).toString().trim();

      // Validações obrigatórias
      if (!rawCustomerName) errors.push('Nome do cliente é obrigatório');
      if (!rawDueDate) errors.push('Data de vencimento é obrigatória');
      if (!rawOriginalAmount) {
        errors.push('Valor original é obrigatório');
      } else {
        const val = parseAmount(rawOriginalAmount);
        if (val <= 0) errors.push('Valor original deve ser maior que zero');
      }

      // Calcula dias em atraso se não fornecido
      let calcDays = parseInt(rawDaysOverdue) || 0;
      if (!calcDays && rawDueDate) {
        const due = new Date(rawDueDate);
        const today = new Date();
        if (!isNaN(due.getTime())) {
          calcDays = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }

      const originalAmount = parseAmount(rawOriginalAmount);
      const updatedAmount = parseAmount(rawUpdatedAmount) || originalAmount;

      const parsedTitle = errors.length === 0 ? {
        titleNumber: rawTitleNumber || `IMP-${String(idx + 1).padStart(4, '0')}`,
        customerName: rawCustomerName,
        customerCode: rawCustomerCode,
        cnpjCpf: rawCnpjCpf,
        issueDate: rawIssueDate,
        dueDate: rawDueDate,
        originalAmount,
        updatedAmount,
        daysOverdue: calcDays,
        agingBucket: normalizeAging(rawAgingBucket, calcDays) as any,
        collectionStatus: normalizeStatus(rawCollectionStatus) as any,
        notes: rawNotes,
      } : undefined;

      return {
        rowNumber: idx + 1,
        rawTitleNumber,
        rawCustomerName,
        rawCustomerCode,
        rawCnpjCpf,
        rawIssueDate,
        rawDueDate,
        rawOriginalAmount,
        rawUpdatedAmount,
        rawDaysOverdue: calcDays ? String(calcDays) : rawDaysOverdue,
        rawAgingBucket,
        rawCollectionStatus,
        rawNotes,
        status: errors.length === 0 ? 'valid' : 'invalid',
        errors,
        parsedTitle,
      };
    });

    setDelinquencyResults(validated);
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
                setFileName(null);
                setImportSuccessMsg(null);
              }}
              className="bg-white border border-[#EAE6DF] text-xs text-[#2D2A26] rounded p-1 font-bold focus:outline-none focus:border-[#C19A6B]"
            >
              <option value="financial">Resultado Financeiro (Caixa)</option>
              <option value="economic">Resultado Econômico (DRE)</option>
              <option value="customers">Carteira de Clientes</option>
              <option value="delinquency">Inadimplência (Títulos Vencidos)</option>
            </select>
          </div>

          {targetModule !== 'delinquency' && targetModule !== 'customers' && (
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
              { col: 'codigo / Código', label: 'Código Cliente', req: false },
              { col: 'razao_social / Nome / Cliente', label: 'Razão Social / Nome', req: true },
              { col: 'cnpj_cpf / CNPJ / CPF', label: 'CNPJ ou CPF', req: false },
              { col: 'nome_fantasia / Fantasia', label: 'Nome Fantasia', req: false },
              { col: 'contato / Contato', label: 'Contato', req: false },
              { col: 'telefone / Telefone', label: 'Telefone', req: false },
              { col: 'email / E-mail', label: 'E-mail', req: false },
              { col: 'cidade / Cidade', label: 'Cidade', req: false },
              { col: 'estado / UF', label: 'UF (Estado)', req: false },
              { col: 'limite_credito / Limite', label: 'Limite de Crédito', req: false },
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
              <p className="text-xs font-bold text-blue-800">Colunas esperadas na planilha de inadimplência</p>
              <p className="text-[11px] text-blue-700 mt-0.5">
                O sistema aceita variações de nome. Campos obrigatórios marcados com *.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-[10px]">
            {[
              { col: 'numero_titulo / Nº Título', label: 'Nº do Título', req: false },
              { col: 'Devedor / cliente / Nome', label: 'Nome do Devedor/Cliente', req: true },
              { col: 'cod_cliente / codigo_cliente', label: 'Código do Cliente (vínculo)', req: false },
              { col: 'cnpj_cpf / CNPJ / CPF', label: 'CNPJ ou CPF', req: false },
              { col: 'data_emissao / Emissão', label: 'Data Emissão', req: false },
              { col: 'data_vencimento / Vencimento', label: 'Data Vencimento', req: true },
              { col: 'valor_original / Valor', label: 'Valor Original (R$)', req: true },
              { col: 'valor_atualizado', label: 'Valor Atualizado', req: false },
              { col: 'dias_atraso / Atraso', label: 'Dias em Atraso', req: false },
              { col: 'faixa_aging / Aging', label: 'Faixa Aging', req: false },
              { col: 'status_cobranca / Status', label: 'Status Cobrança', req: false },
              { col: 'observacoes / Observações', label: 'Observações', req: false },
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

          {/* Tabela de inadimplência */}
          <div className="overflow-x-auto max-h-96 border border-[#EAE6DF] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] sticky top-0">
                <tr className="border-b border-[#EAE6DF] font-bold">
                  <th className="p-2.5 w-10 text-center">#</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Nº Título</th>
                  <th className="p-2.5">Cliente</th>
                  <th className="p-2.5">CNPJ/CPF</th>
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
                    <td className="p-2.5 font-mono text-[#C19A6B] font-bold">{row.rawTitleNumber || '-'}</td>
                    <td className="p-2.5 font-medium">{row.rawCustomerName || '-'}</td>
                    <td className="p-2.5 font-mono text-[10px]">{row.rawCnpjCpf || '-'}</td>
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
