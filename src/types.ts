/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'gestor' | 'analista';

export type ViewTab =
  | 'dashboard'
  | 'economic'
  | 'financial'
  | 'import'
  | 'customers'
  | 'delinquency';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export interface EconomicMonthData {
  monthKey: string; // 'jan', 'fev', etc.
  monthLabel: string; // 'Jan/25'
  receitaBruta: number;
  cmv: number;
  cmvPercent: number; // calculated % of receitaBruta
  margemBruta: number;
  margemPercent: number;
  despesasFixas: number;
  despesasPercent: number;
  resultadoEconomico: number;
  resultadoPercent: number;
  pontoEquilibrio: number;
}

export interface EconomicYearSummary {
  year: number;
  months: Record<string, EconomicMonthData>;
  totalReceitaBruta: number;
  totalCmv: number;
  totalMargemBruta: number;
  totalDespesasFixas: number;
  totalResultadoEconomico: number;
  avgReceitaBruta: number;
  avgCmv: number;
  avgMargemBruta: number;
  avgDespesasFixas: number;
  avgResultadoEconomico: number;
  avgPontoEquilibrio: number;
}

export interface FinancialMonthData {
  monthKey: string;
  monthLabel: string;
  entradasBancos: number;
  entradasTesouraria: number;
  totalEntradas: number;
  totalSaidas: number;
  resultadoFinanceiro: number;
  resultadoPercent: number;
  estoque: number;
  inadimplenciaMensal: number;
  inadimplenciaAcumulada: number;
}

export interface FinancialYearSummary {
  year: number;
  months: Record<string, FinancialMonthData>;
  totalBancos: number;
  totalTesouraria: number;
  totalEntradas: number;
  totalSaidas: number;
  totalResultadoFinanceiro: number;
  avgResultadoPercent: number;
  avgEstoque: number;
  avgInadimplenciaMensal: number;
  avgInadimplenciaAcumulada: number;
}

export interface Customer {
  id: string;
  code: string;
  cnpjCpf: string;
  name: string;
  tradeName?: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  creditLimit: number;
  currentBalance: number;
  delinquentAmount: number;
  status: 'Adimplente' | 'Inadimplente' | 'Risco';
  lastPurchaseDate?: string;
}

export interface DelinquentTitle {
  id: string;
  titleNumber: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  cnpjCpf: string;
  issueDate: string;
  dueDate: string;
  originalAmount: number;
  updatedAmount: number;
  daysOverdue: number;
  agingBucket: '1-30' | '31-60' | '61-90' | '>90';
  collectionStatus: 'Aguardando' | 'Em Cobrança' | 'Negativado' | 'Acordo em Andamento' | 'Judicial';
  notes?: string;
}

export type TransactionCategory =
  | 'receita_vendas'
  | 'cmv_mercadorias'
  | 'despesa_pessoal'
  | 'despesa_aluguel'
  | 'despesa_utilidades'
  | 'despesa_impostos'
  | 'despesa_outras'
  | 'entrada_banco'
  | 'entrada_tesouraria'
  | 'saida_fornecedores'
  | 'saida_impostos'
  | 'saida_operacional'
  | 'ajuste_estoque'
  | 'ajuste_inadimplencia';

export interface FinancialEntry {
  id: string;
  date: string; // YYYY-MM-DD
  year: number;
  monthKey: string; // 'jan' .. 'dez'
  type: 'receita' | 'cmv' | 'despesa' | 'entrada_banco' | 'entrada_tesouraria' | 'saida' | 'estoque' | 'inadimplencia';
  category: TransactionCategory;
  description: string;
  value: number;
  customerId?: string;
  customerName?: string;
  createdByName: string;
  createdAt: string;
}

export interface ValidationRowResult {
  rowNumber: number;
  rawDate: string;
  rawType: string;
  rawDescription: string;
  rawValue: string;
  rawCustomer: string;
  status: 'valid' | 'invalid' | 'warning';
  parsedEntry?: Partial<FinancialEntry>;
  errors: string[];
}

// Resultado de validação específico para importação de inadimplência
export interface DelinquencyValidationRowResult {
  rowNumber: number;
  rawTitleNumber: string;    // Nº do título
  rawCustomerName: string;  // Nome do cliente (coluna Devedor ou Cliente)
  rawCustomerCode: string;  // Código do cliente para vínculo (coluna cod_cliente)
  rawCnpjCpf: string;       // CNPJ/CPF
  rawIssueDate: string;     // Data de emissão
  rawDueDate: string;       // Data de vencimento
  rawOriginalAmount: string;// Valor original
  rawUpdatedAmount: string; // Valor atualizado (opcional)
  rawDaysOverdue: string;   // Dias em atraso (calculado se ausente)
  rawAgingBucket: string;   // Faixa aging
  rawCollectionStatus: string; // Status de cobrança
  rawNotes: string;         // Observações
  status: 'valid' | 'invalid';
  errors: string[];
  parsedTitle?: Partial<DelinquentTitle>;
}

export interface ImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  totalValue: number;
}

export interface DateFilter {
  year: number;
  periodType: 'anual' | 'primeiro_semestre' | 'segundo_semestre' | 'trimestre' | 'mes_especifico' | 'customizado';
  quarter?: 1 | 2 | 3 | 4;
  monthKey?: string;
  startDate?: string;
  endDate?: string;
}

export interface ApiToken {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  lastUsed?: string;
  status: 'active' | 'revoked';
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  isConnected: boolean;
  lastTested?: string;
  error?: string;
}
