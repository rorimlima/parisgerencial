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
  | 'cashflow'
  | 'billing'
  | 'stock'
  | 'sales'
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

  // ─── RFN029 — Títulos Atrasados por Vendedor ───────────────────────────────
  // Nenhuma coluna do relatório é descartada: cobrança precisa do telefone, o
  // financeiro precisa do nº de lançamento para achar o título no ERP, e a
  // conferência de veículo depende do chassi/pedido.
  dedupeKey?: string;          // `${companyName}|${titleNumber}|${parcela}` — evita duplicar na reimportação
  lancamento?: string;         // Lançamento — nº interno do lançamento no ERP (NÃO é data)
  companyName?: string;        // EmpresaNome
  customerPhone?: string;      // DevedorTelefone — contato de cobrança (WhatsApp)
  sellerPhone?: string;        // VendedorTelefone
  endossoName?: string;        // Endosso
  endossoCode?: string;        // Pessoa_CodigoEndosso
  endossoPhone?: string;       // EndossoTelefone
  collectionAgent?: string;    // Titulo_AgenteCobradorDes — banco/agente cobrador
  paymentType?: string;        // Tipo (V-DINHEIRO, BOLETO ...)
  collectionTypeDescription?: string; // TipoCobranca_Descricao
  department?: string;         // Departamento
  orderNumber?: string;        // Nro_Pedido
  chassi?: string;             // Chassi
  currency?: string;           // moeda_descricao
  nfseNumber?: string;         // NotaFiscalEletServico_NroNFSe
  invoiceNumber?: string;      // NotaFiscal_Numero
  lastHistoryDate?: string;    // TituloHistorico_Data (ISO)
  lastHistoryCode?: string;    // TituloHistorico_Codigo (CRI, PAG, ALT ...)
  occurrence?: string;         // Ocorrencia — última movimentação legível
  importedAt?: string;
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

// ─── Fluxo de Caixa (Planejamento Semanal Previsto x Realizado) ──────────────

// Semanas do mês (01 a 05). O REALIZADO é calculado a partir do Extrato
// Financeiro (entradas = recebimentos, saídas = desembolsos), agrupado por
// semana. O PREVISTO é preenchido manualmente para planejamento do futuro.
export type CashFlowWeekKey = 'sem01' | 'sem02' | 'sem03' | 'sem04' | 'sem05';

export interface CashFlowWeekPlan {
  recebimentos: number; // previsto de entradas
  desembolsos: number;  // previsto de saídas (valor negativo)
  aportes: number;      // previsto de aportes de sócios/capital
  // Realizado manual (opcional). Usado para meses históricos importados de
  // planilha, quando não há Extrato Financeiro carregado. Se `realizadoManual`
  // do mês for false, estes campos são ignorados e o realizado vem do Extrato.
  recebRealizado?: number; // realizado de entradas (positivo)
  desembRealizado?: number; // realizado de saídas (valor negativo, como o previsto)
}

// Item de pendência (obrigação em aberto): pró-labore, aluguel, etc.
export interface CashFlowPendencia {
  descricao: string;
  valor: number;
}

// Documento de planejamento por mês (chave: `${ano}_${monthKey}`). Guarda
// apenas os valores manuais (previsto + saldo inicial). O realizado é derivado.
export interface CashFlowPlan {
  id: string;
  year: number;
  monthKey: string;               // 'jan'..'dez'
  saldoInicial: number;           // saldo de abertura do mês (manual)
  useSaldoAutomatico?: boolean;   // se true, herda o saldo final do mês anterior
  realizadoManual?: boolean;      // se true, usa recebRealizado/desembRealizado das semanas em vez do Extrato
  weeks: Record<CashFlowWeekKey, CashFlowWeekPlan>;
  pendencias?: CashFlowPendencia[]; // obrigações em aberto (pró-labore, aluguel...)
  notes?: string;
  updatedAt?: string;
}

// ─── Faturamento (RPR014 — Notas Fiscais) ────────────────────────────────────

/**
 * Uma linha do relatório RPR014. A granularidade NÃO é a nota: uma mesma
 * NotaFiscalCod pode aparecer em várias linhas, quebradas por CFOP / conta
 * gerencial (ex.: NF 12633 com uma linha de R$150 CFOP 5102 e outra de R$250).
 * Por isso a chave de deduplicação é composta por empresa + nota + SeqOrder,
 * que é único no arquivo inteiro (29.320 linhas → 29.320 chaves).
 *
 * TODOS os 55 campos do cabeçalho são preservados — vários ainda não têm tela,
 * mas serão necessários no futuro (fiscal, cancelamento, endereço do cliente).
 */
export interface InvoiceRecord {
  id: string;
  dedupeKey: string;             // `${empresaCod}|${invoiceCode}|${seqOrder}`

  // Empresa
  companyCode: string;           // EmpresaCod
  companyName: string;           // EmpresaNome

  // Identificação da nota
  invoiceCode: string;           // NotaFiscalCod
  invoiceNumber: string;         // NotaFiscalNum
  invoiceSeries: string;         // NotaFiscalSer
  seqOrder: number;              // SeqOrder — sequencial da linha no relatório

  // Cliente / pessoa  → vínculo com o cadastro de clientes (cod_cliente)
  personCode: string;            // PessoaCod  ⇄ Customer.code
  personName: string;            // PessoaNome
  personDocument: string;        // PessoaDocIdent (CPF/CNPJ)
  personDocRgIe: string;         // PessoaDocRGIE
  personAddressRelType: string;  // PessoaTipoEndCodRelac
  customerId?: string;           // id do documento de cliente vinculado (se houver)

  // Endereço da pessoa (vem na própria nota)
  addressStreetType: string;     // PessoaEndTipoLogrDescr
  addressStreet: string;         // PessoaEndLogradouro
  addressNumber: string;         // PessoaEndNumero
  addressCity: string;           // PessoaEndMunicipioDescr
  addressState: string;          // PessoaEndEstadoCod

  // Operação
  operationCode: string;         // NaturezaOperacaoCod
  operationDescription: string;  // NaturezaOperacaoDescr
  departmentCode: string;        // DepartamentoCod
  departmentDescription: string; // DepartamentoDescr
  departmentAcronym: string;     // DepartamentoSigla
  paymentTermCode: string;       // CondicaoPagamentoCod
  paymentTermDescription: string;// CondicaoPagamentoDescr
  documentTypeCode: string;      // TipoDocumentoCod
  documentTypeDescription: string;// TipoDocumentoDescr
  marketSegmentCode: string;     // SegmentoMercadoCod
  marketSegmentDescription: string;// SegmentoMercadoDescr
  serviceOrderCode: string;      // OSCod
  origin: string;                // NotaFiscalOrigem (OFI/BLC/OUT)
  isOwnInvoice: boolean;         // NotaFiscalPropria
  status: string;                // NotaFiscalStatus (EMI/CAN...)
  movement: string;              // NotaFiscal_Movimento (S/E)

  // Equipe
  employeeCode: string;          // FuncionarioCod
  employeeName: string;          // FuncionarioNome
  sellerCode: string;            // VendedorCod
  sellerName: string;            // VendedorNome

  // Datas
  issueDate: string;             // DataEmissao        → YYYY-MM-DD
  movementDate: string;          // DataMovimento      → YYYY-MM-DD
  registerDate: string;          // DataCadastro       → YYYY-MM-DD (com hora original preservada em registerDateTime)
  registerDateTime: string;      // DataCadastro cru
  cancelDate: string;            // DataCancelamento   → YYYY-MM-DD ('' se não cancelada)
  year: number;                  // ano de issueDate
  monthKey: string;              // 'jan'..'dez' de issueDate

  // Valores e fiscal
  totalValue: number;            // ValorTotal
  cfop: string;                  // CFOP
  nfeKey: string;                // ChaveNFE
  totalIcms: number;             // Total_ICMS
  totalIcmsSt: number;           // Total_ICMSST
  totalIss: number;              // Total_ISS
  totalPis: number;              // Total_PIS
  totalIpi: number;              // Total_IPI
  totalCofins: number;           // Total_COFINS
  totalCsll: number;             // Total_CSLL

  // Conta gerencial
  managerialAccountCode: string; // ContaGerencialCod
  managerialAccountName: string; // ContaGerencialDescr
  managerialAccountIdent: string;// ContaGerencialIdent

  // Cancelamento
  cancelUserName: string;        // UsuNomeCancelamento
  cancelNotes: string;           // ObsCancelamento

  importedAt?: string;
}

/**
 * Resumo mensal de faturamento (documento por `${ano}_${monthKey}` na coleção
 * `faturamento_resumo`). É isto que as telas leem por padrão: 12 documentos por
 * ano em vez de milhares de notas.
 */
export interface BillingMonthSummary {
  id: string;                    // `${year}_${monthKey}`
  year: number;
  monthKey: string;
  monthLabel: string;
  grossRevenue: number;          // soma de ValorTotal
  invoiceCount: number;          // notas distintas
  lineCount: number;             // linhas do relatório
  customerCount: number;         // clientes distintos
  averageTicket: number;         // grossRevenue / invoiceCount
  taxTotal: number;              // soma de todos os impostos
  canceledValue: number;         // valor de notas canceladas
  bySeller: Record<string, number>;       // nome do vendedor → faturamento
  bySegment: Record<string, number>;      // segmento de mercado → faturamento
  byDocumentType: Record<string, number>; // tipo de documento → faturamento
  byCompany: Record<string, number>;      // empresa → faturamento
  updatedAt?: string;
}

/**
 * Consolidado por cliente (documento por PessoaCod na coleção
 * `faturamento_cliente`). É a ponte entre Faturamento e Inadimplência: guarda
 * quanto o cliente comprou, para cruzar com quanto ele deve em atraso.
 */
export interface BillingCustomerSummary {
  id: string;                    // personCode
  personCode: string;
  personName: string;
  personDocument: string;
  customerId?: string;           // cliente vinculado no cadastro
  totalRevenue: number;          // faturamento acumulado (todo o histórico)
  revenueByYear: Record<string, number>;
  invoiceCount: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  mainSeller: string;            // vendedor com maior faturamento no cliente
  city: string;
  state: string;
  updatedAt?: string;
}

/** Linha do cruzamento Faturamento × Títulos em Atraso, calculado em memória. */
export interface CustomerRiskRow {
  personCode: string;
  personName: string;
  customerId?: string;
  totalRevenue: number;          // faturado (histórico ou período)
  overdueAmount: number;         // soma de updatedAmount dos títulos vencidos
  overdueCount: number;
  overdueRate: number;           // overdueAmount / totalRevenue
  worstAging: DelinquentTitle['agingBucket'] | '—';
  maxDaysOverdue: number;
  lastPurchaseDate: string;
  mainSeller: string;
  riskLevel: 'Crítico' | 'Alto' | 'Médio' | 'Baixo' | 'Sem atraso';
}

// ─── Estoque (RPR053 — Lista de Preço) ───────────────────────────────────────

/**
 * Um SKU da lista de preço/estoque. Chave: Produto_Codigo (único no arquivo).
 * Reimportar a mesma planilha atualiza saldo e preços — nunca duplica.
 */
export interface StockItem {
  id: string;                     // Produto_Codigo sanitizado
  dedupeKey: string;              // `${companyName}|${stockDescription}|${productCode}`
  companyName: string;            // Empresa_Nome
  stockDescription: string;       // Estoque_Descricao
  productTypeDescription: string; // TipoProduto_Descricao
  productCode: string;            // Produto_Codigo
  productDescription: string;     // Produto_Descricao
  brandReference: string;         // ProdutoMarca_Referencia
  detailedDescription: string;    // Produto_DescricaoDetalhada
  locationIdentifier: string;     // LocalizacaoProduto_Identificador
  unit: string;                   // Unidade_Sigla
  productGroupCode: string;       // GrupoProduto_Codigo
  profitabilityGroup: string;     // GrupoLucratividade_Letra
  abcPopularity: string;          // ProdutoEstoque_ClasABCLetraPopularidade
  abcSales: string;               // ProdutoEstoque_ClasABCLetraVenda
  abcStock: string;               // ProdutoEstoque_ClasABCLetraEstoque
  availableQty: number;           // ProdutoEstoque_QtdeDisponivel
  publicPrice: number;            // ValorPublicoSugerido
  publicPriceTotal: number;       // ValorPublicoSugeridoTotal
  warrantyPrice: number;          // ValorGarantia
  warrantyPriceTotal: number;     // ValorGarantiaTotal
  replacementCost: number;        // ValorReposicao  (custo unitário)
  replacementCostTotal: number;   // ValorReposicaoTotal
  salePrice: number;              // ValorVenda      (preço de venda unitário)
  salePriceTotal: number;         // ValorVendaTotal
  // Derivados (calculados na importação, gravados para permitir ordenação)
  stockValueAtCost: number;       // availableQty * replacementCost
  stockValueAtSale: number;       // availableQty * salePrice
  markupPercent: number;          // (salePrice / replacementCost - 1) * 100
  marginPercent: number;          // (salePrice - replacementCost) / salePrice * 100
  importedAt?: string;
  updatedAt?: string;
}

/** Documento único (`estoque_resumo/atual`) com o retrato do estoque. */
export interface StockSummary {
  id: string;
  totalSkus: number;
  skusWithBalance: number;
  skusZeroed: number;
  totalQty: number;
  totalValueAtCost: number;
  totalValueAtSale: number;
  potentialGrossMargin: number;   // totalValueAtSale - totalValueAtCost
  averageMarkup: number;
  byType: Record<string, { skus: number; qty: number; cost: number; sale: number }>;
  referenceDate: string;
  updatedAt?: string;
}

// ─── Vendas de Produtos (RPR001 — Venda Produto Intermediário) ───────────────

/**
 * Uma LINHA DE ITEM de nota fiscal de venda. A granularidade é o item, não a
 * nota: a NF 27235 aparece em duas linhas (NFItem_Cod 1 e 2). A chave única é
 * `${NF_EmpresaCod}|${NF_Codigo}|${NFItem_Cod}` — conferido contra o arquivo
 * real: 16.593 linhas → 16.593 chaves, zero colisão.
 *
 * ARMADILHAS DO LAYOUT (documentadas aqui porque já geraram número errado)
 * ------------------------------------------------------------------------
 * 1. `NFItem_VlBruto` é o preço UNITÁRIO bruto, NÃO o total da linha. Quem
 *    somar essa coluna acha R$ 16,5 mi de faturamento quando o correto é
 *    R$ 34,1 mi. Pior: em 377 linhas (2,3%) ela diverge de `NFItem_VlUnit`,
 *    que é o valor realmente usado no cálculo da nota. Por isso a base de
 *    preço aqui é SEMPRE `NFItem_VlUnit`, e a divergência vira alerta.
 *    Fórmula validada em 100% das linhas:
 *        NFItem_VlTotal = NFItem_VlUnit × NFItem_Qtde − NFItem_VlDesc + NFItem_VlAcres
 *
 * 2. `NF_ProdCusto` é o custo TOTAL da linha (já multiplicado pela
 *    quantidade), não o custo unitário. Tratá-lo como unitário multiplica o
 *    CMV por 2,5x.
 *
 * 3. `NFItem_PercMargemGer` vem como FRAÇÃO (0,7356) enquanto
 *    `NFItem_PercMargemCont` vem como PERCENTUAL (73,56). São exatamente o
 *    mesmo número numa escala 100x diferente — bug do export do ERP. Só
 *    `NFItem_PercMargemCont` deve ser exibido.
 *
 * 4. A margem do ERP (`NFItem_VlMargemCont`) é LÍQUIDA de ICMS e PIS/COFINS.
 *    Em 823 linhas (5%) ela não fecha com Total − Custo − Impostos, com
 *    divergência líquida de R$ 243 mil. Por isso guardamos as duas: a do ERP
 *    e a recalculada, mais a diferença — é isso que a auditoria persegue.
 */
export interface SaleItem {
  id: string;
  dedupeKey: string;             // `${companyCode}|${invoiceCode}|${itemCode}`

  // Empresa
  companyCode: string;           // NF_EmpresaCod
  companyName: string;           // EmpNome

  // Nota fiscal
  invoiceCode: string;           // NF_Codigo  (código interno, chave)
  invoiceNumber: string;         // NF_Numero  (número impresso)
  invoiceSeries: string;         // NF_Serie
  itemCode: string;              // NFItem_Cod (sequencial do item na nota)
  status: string;                // NF_Status (EMI/CAN)
  movementType: string;          // Tipo (V = venda)
  origin: string;                // NF_Origem (OFI = oficina, BLC = balcão)
  operationCode: string;         // NF_NatOperCod
  operationDescription: string;  // NaturezaOperacao
  currencyCode: string;          // NFMoedaCod
  itemSharePercent: number;      // NFItem_PercNF — participação do item na nota

  // Ordem de serviço (só existe quando origin = OFI)
  osCode: string;                // NF_OsCod
  osNumber: string;              // NF_OsNum
  osType: string;                // NF_OsTipo
  osTypeDescription: string;     // NF_OsTipoDes
  osValue: number;               // Os_Valor
  intermediateOrder: string;     // PedidoIntermediario

  // Cliente → vínculo com o cadastro (Customer.code / cod_cliente)
  customerCode: string;          // NF_PessoaCod  ⇄ Customer.code
  customerName: string;          // NF_PessoaNom
  customerId?: string;           // id do cliente vinculado, quando resolvido

  // Condição de pagamento
  paymentTermCode: string;       // NF_CondPagCod
  paymentTermDescription: string;// NF_CondPagDes

  // Vendedor
  sellerCode: string;            // NF_VendedorCod
  sellerName: string;            // NF_UsuNomVendedor

  // Produto → vínculo com o estoque (StockItem.productCode / Produto_Codigo)
  productCode: string;           // NFItem_ProdutoCod ⇄ StockItem.productCode
  productDescription: string;    // NFItem_ProdutoDes
  brandReference: string;        // ProdMarcaReferencia
  productTypeCode: string;       // ProdTipoCod
  profitabilityLetter: string;   // ProdLucratLetra
  abcStock: string;              // ProdEstoqueClasABC
  stockCode: string;             // NFItem_EstoqueCod
  listPrice: number;             // ProdPrecoValor — preço/custo de referência do cadastro

  // Datas
  issueDate: string;             // NF_Dataemis  → YYYY-MM-DD
  movementDate: string;          // NF_DataMov   → YYYY-MM-DD
  year: number;
  monthKey: string;              // 'jan'..'dez'

  // Quantidades e valores (ver armadilhas 1 e 2 no cabeçalho)
  quantity: number;              // NFItem_Qtde
  stockQuantity: number;         // NFItem_QtdeEstoque
  unitPrice: number;             // NFItem_VlUnit   — base do cálculo da nota
  reportedUnitGross: number;     // NFItem_VlBruto  — unitário informado (pode divergir)
  grossAmount: number;           // DERIVADO: unitPrice × quantity
  discountAmount: number;        // NFItem_VlDesc
  discountPercent: number;       // DERIVADO: discountAmount / grossAmount × 100
  reportedDiscountPercent: number;// NFItem_PercDesc — o que o ERP informou
  surchargeAmount: number;       // NFItem_VlAcres
  netAmount: number;             // NFItem_VlTotal — receita líquida da linha
  lineCost: number;              // NF_ProdCusto — custo TOTAL da linha
  unitCost: number;              // DERIVADO: lineCost / quantity

  // Impostos
  taxIcms: number;               // ValorICMS
  taxIcmsSt: number;             // ValorICMSST
  taxIcmsDifal: number;          // ValorICMSDIFAL
  taxPis: number;                // ValorPis
  taxCofins: number;             // ValorCofins
  taxPisCofins: number;          // ValorPisCofins
  taxIss: number;                // ValorIss
  taxIpi: number;                // ValorIPI
  taxTotal: number;              // DERIVADO: soma dos anteriores (sem duplicar Pis+Cofins)

  // Margem — a do ERP e a nossa, para poder auditar a diferença
  marginErp: number;             // NFItem_VlMargemCont
  marginErpManagerial: number;   // NFItem_VlMargemGer
  grossProfitErp: number;        // ValorLucroBruto
  marginPercentErp: number;      // NFItem_PercMargemCont
  marginCalculated: number;      // DERIVADO: netAmount − lineCost − taxTotal
  marginPercentCalculated: number;
  marginDivergence: number;      // DERIVADO: marginErp − marginCalculated

  importedAt?: string;
}

/** Motivo pelo qual uma linha foi marcada para conferência. */
export type SaleFlagCode =
  | 'margem_negativa'        // vendeu abaixo do custo + impostos
  | 'margem_baixa'           // margem positiva porém abaixo do piso configurado
  | 'desconto_alto'          // desconto acima do teto configurado
  | 'desconto_sem_margem'    // desconto concedido em item que já saiu no prejuízo
  | 'preco_divergente'       // NFItem_VlBruto ≠ NFItem_VlUnit
  | 'margem_divergente'      // margem do ERP não fecha com Total − Custo − Impostos
  | 'custo_ausente'          // custo zerado: margem aparente de 100%
  | 'preco_fora_da_curva'    // preço unitário muito abaixo da mediana do mesmo SKU
  | 'cliente_e_vendedor';    // cliente com o mesmo nome de um vendedor da equipe

export interface SaleFlag {
  code: SaleFlagCode;
  severity: 'critico' | 'alto' | 'medio';
  message: string;
  /** Valor em risco atribuído a este apontamento (R$). */
  impact: number;
}

/** Uma linha de venda já auditada: o item + os apontamentos encontrados. */
export interface AuditedSale extends SaleItem {
  flags: SaleFlag[];
  /** Maior severidade entre as flags — usada para ordenar e colorir. */
  worstSeverity: 'critico' | 'alto' | 'medio' | 'ok';
  /** Soma dos impactos, sem dupla contagem (usa o maior impacto por linha). */
  riskAmount: number;
  /** true quando productCode existe no cadastro de estoque. */
  linkedToStock: boolean;
  /** true quando customerCode existe no cadastro de clientes. */
  linkedToCustomer: boolean;
}

/** Consolidado de vendas por vendedor — margem, desconto e exposição. */
export interface SalesSellerSummary {
  sellerCode: string;
  sellerName: string;
  lines: number;
  invoices: number;
  customers: number;
  grossAmount: number;
  discountAmount: number;
  discountPercent: number;
  netAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number;
  averageTicket: number;
  negativeLines: number;
  negativeAmount: number;      // prejuízo acumulado (negativo)
  highDiscountLines: number;
  highDiscountAmount: number;
  riskAmount: number;
  /** Desvio da margem % em relação à mediana da equipe (pontos percentuais). */
  marginDeviation: number;
}

/** Consolidado de vendas por cliente — a visão de auditoria de desconto. */
export interface SalesCustomerSummary {
  customerCode: string;
  customerName: string;
  customerId?: string;
  linked: boolean;
  city: string;
  state: string;
  lines: number;
  invoices: number;
  sellers: string[];
  grossAmount: number;
  discountAmount: number;
  discountPercent: number;
  netAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number;
  negativeLines: number;
  negativeAmount: number;
  riskAmount: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  mainSeller: string;
}

/** Consolidado de vendas por produto, já cruzado com o saldo em estoque. */
export interface SalesProductSummary {
  productCode: string;
  productDescription: string;
  brandReference: string;
  linked: boolean;             // existe no cadastro de estoque?
  availableQty: number;        // saldo atual (0 quando não vinculado)
  currentCost: number;         // custo de reposição atual (StockItem)
  currentSalePrice: number;    // preço de tabela atual (StockItem)
  lines: number;
  quantity: number;
  grossAmount: number;
  discountAmount: number;
  discountPercent: number;
  netAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPercent: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  medianUnitPrice: number;
  priceSpread: number;         // maxUnitPrice / minUnitPrice
  negativeLines: number;
  negativeAmount: number;
}

/** Resumo mensal de vendas (documento `${ano}_${mes}` em `vendas_resumo`). */
export interface SalesMonthSummary {
  id: string;
  year: number;
  monthKey: string;
  monthLabel: string;
  lines: number;
  invoices: number;
  customers: number;
  products: number;
  grossAmount: number;
  discountAmount: number;
  discountPercent: number;
  netAmount: number;
  costAmount: number;
  taxAmount: number;
  marginAmount: number;
  marginPercent: number;
  negativeLines: number;
  negativeAmount: number;
  bySeller: Record<string, number>;   // vendedor → receita líquida
  byOrigin: Record<string, number>;   // OFI/BLC → receita líquida
  updatedAt?: string;
}

/** Parâmetros da auditoria — o gestor define o que é "abusivo" na própria tela. */
export interface SalesAuditThresholds {
  /** Margem mínima aceitável sobre a receita líquida (%). */
  minMarginPercent: number;
  /** Desconto máximo aceitável sobre o bruto (%). */
  maxDiscountPercent: number;
  /** Quanto o preço pode ficar abaixo da mediana do SKU antes de virar alerta (%). */
  maxPriceBelowMedianPercent: number;
  /** Valor mínimo da linha para entrar na auditoria (evita ruído de centavos). */
  minLineValue: number;
}

export const DEFAULT_SALES_THRESHOLDS: SalesAuditThresholds = {
  minMarginPercent: 15,
  maxDiscountPercent: 20,
  maxPriceBelowMedianPercent: 40,
  minLineValue: 50,
};

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
  rawLancamento: string;    // Lançamento (nº interno do ERP)
  rawCustomerPhone: string; // DevedorTelefone (contato WhatsApp)
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
