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
  | 'delinquency'
  | 'sellers'
  | 'statement'
  | 'payables'
  | 'api-docs'
  | 'postgres-settings';

export interface Seller {
  id: string;
  code: string;
  name: string;
  email?: string;
  phone?: string;
  status: 'Ativo' | 'Inativo';
  totalDelinquentAmount?: number;
}

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
  // Campos adicionais importados da planilha de clientes
  personType?: 'F' | 'J' | string; // tipo_pessoa (F=Física, J=Jurídica)
  cellphone?: string;              // celular
  address?: string;               // endereco
  addressNumber?: string;         // numero
  neighborhood?: string;          // bairro
  zipCode?: string;               // cep
  sellerResponsible?: string;     // vendedor_responsavel
  relationshipType?: 'Cliente' | 'Fornecedor' | 'Ambos' | 'Nenhum' | string; // tipo_relacionamento
  expenseClassification?: 'Despesa Fixa' | 'Despesa Variável' | 'Nenhuma' | string; // classificacao_despesa
}

export interface DelinquentTitle {
  id: string;
  titleNumber: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  sellerId?: string;
  sellerCode?: string;
  sellerName?: string;
  cnpjCpf: string;
  issueDate: string;
  dueDate: string;
  originalAmount: number;
  updatedAmount: number;
  daysOverdue: number;
  agingBucket: '1-30' | '31-60' | '61-90' | '>90';
  collectionStatus: 'Aguardando' | 'Em Cobrança' | 'Negativado' | 'Acordo em Andamento' | 'Judicial';
  notes?: string;
  // Campos adicionais importados da planilha de títulos
  parcela?: string;   // Titulo_Parcela
  juros?: number;     // Juros
  multa?: number;     // Multa
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

// ─── Extrato Financeiro (Conciliação Bancária / Caixa) ─────────────────────────

export type StatementSource = 'bradesco' | 'pagseguro' | 'tesouraria';
export type StatementOrigin = 'banco' | 'caixa';

// Um lançamento individual de extrato bancário ou de caixa/tesouraria, usado
// para conciliação e para alimentar automaticamente Resultado Financeiro
// (entradasBancos / entradasTesouraria).
export interface FinancialStatementEntry {
  id: string;
  origin: StatementOrigin;       // 'banco' (Bradesco/PagSeguro) ou 'caixa' (Tesouraria/RFN019)
  source: StatementSource;       // 'bradesco' | 'pagseguro' | 'tesouraria'
  sourceLabel: string;           // Rótulo amigável: 'Bradesco', 'PagSeguro', 'Caixa/Tesouraria'
  date: string;                 // YYYY-MM-DD
  year: number;
  monthKey: string;              // 'jan'..'dez'
  description: string;           // Lançamento / Descrição / Observação
  clientName?: string;           // Cliente/Beneficiário (ClienteBeneficiario ou nome extraído do Pix)
  documentType?: string;         // Dcto. / Tipo / Tesouraria_TipoDocumentoDes (ex: 'DINHEIRO', 'Pix recebido')
  documentRef?: string;          // Dcto. / Tesouraria_NroDocumento / Tesouraria_Codigo
  entryAmount: number;           // Valor de entrada (crédito/recebimento)
  exitAmount: number;            // Valor de saída (débito/pagamento)
  balance?: number;              // Saldo após o lançamento, se disponível no extrato
  notes?: string;
  dedupeKey: string;             // Chave determinística para evitar duplicidade em reimportações
  importedAt?: string;
}

// ─── Contas a Pagar ──────────────────────────────────────────────────────────

// Status de baixa (conciliação) de um título pago:
// - 'Em Aberto': pagamento registrado no ERP mas ainda não conciliado com extrato
// - 'Baixado Automático': conciliado automaticamente com um lançamento de extrato
// - 'Baixado Manual': baixa confirmada manualmente pelo gestor
export type PayableStatus = 'Em Aberto' | 'Baixado Automático' | 'Baixado Manual';

// Título de contas a pagar importado do relatório RFN006 (Totais Pagos por Credor).
// Chave única: movCode (TituloMovCodigo). O credor (TituloPessoaCod) é vinculado
// ao cadastro de clientes/pessoas pelo cod_cliente.
export interface PayableTitle {
  id: string;
  movCode: string;               // TituloMovCodigo — chave única do movimento
  companyName?: string;          // TituloEmpresaNome
  supplierCode: string;          // TituloPessoaCod → vincula a cod_cliente
  supplierName: string;          // TituloPessoaNome
  supplierCustomerId?: string;   // id do documento do cliente vinculado (se houver)
  titleCode?: string;            // TituloCodigo
  parcela?: string;              // TituloNumeroParcela (ex: '24000/1')
  dueDate: string;               // TituloDataVencto — YYYY-MM-DD
  paymentDate: string;           // TitMovDataCaixa — YYYY-MM-DD (data efetiva do pagamento)
  year: number;                  // ano de paymentDate
  monthKey: string;              // 'jan'..'dez' de paymentDate
  description?: string;          // TituloHistorico
  payingAgent?: string;          // TituloAgentePagadorDescr (CARTEIRA, VEICULOS...)
  department?: string;           // Departamento_Descricao
  amount: number;                // TituloValor (valor pago, positivo)
  status: PayableStatus;
  reconciledStatementId?: string; // id do lançamento de extrato conciliado (baixa automática)
  reconciledSource?: string;      // fonte do extrato (Bradesco/PagSeguro/Caixa)
  reconciledAt?: string;
  baixaCode?: string;            // Código técnico da baixa (ex: BX-2026-00001)
  notes?: string;
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
  parsedCustomer?: Partial<Customer>;
  errors: string[];
}

// Resultado de validação específico para importação de inadimplência
export interface DelinquencyValidationRowResult {
  rowNumber: number;
  rawTitleNumber: string;    // Nº do título
  rawCustomerName: string;  // Nome do cliente (coluna Devedor ou Cliente)
  rawCustomerCode: string;  // Código do cliente para vínculo (coluna cod_cliente)
  rawSellerName: string;    // Nome do vendedor (coluna Vendedor)
  rawSellerCode: string;    // Código do vendedor (coluna cod_vendedor)
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
