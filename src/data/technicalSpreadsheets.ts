/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Catálogo de Planilhas e Ingestão Técnica de Dados.
 * Mapeamento de Engenharia de Software e Banco de Dados (DBA) para a operação do sistema.
 */

import { TechnicalSpreadsheetSpec } from '../types';

export const TECHNICAL_SPREADSHEETS: TechnicalSpreadsheetSpec[] = [
  {
    id: 'spec_extrato_geral',
    code: 'Extrato Geral',
    name: 'EXTRATO GERAL — todas as contas (bancos e caixas) em um arquivo',
    description:
      'Formato ÚNICO e recomendado de entrada de extrato. Um só arquivo com Bradesco, PagBank e os caixas 301.xx juntos: a coluna BANCO roteia cada linha para a conta certa e a coluna CONTA diz se é BANCO ou DINHEIRO.',
    targetCollection: 'extrato_financeiro',
    dbImpact:
      'Substitui os três formatos por fonte. Gera os lançamentos reais para o motor de conciliação (reconciliation.ts) e as Entradas de Bancos/Tesouraria do Resultado Financeiro. A coluna SAIDA vem NEGATIVA e é o SINAL DO VALOR que define entrada ou saída — a coluna TIPO é apenas conferida contra ele, e as divergências são listadas na prévia em vez de corrigidas em silêncio. Chave determinística por conteúdo (banco, data, histórico, valor) com contador de ocorrência: reimportar atualiza, nunca duplica, mesmo que a coluna ID seja renumerada.',
    expectedColumns: ['ID', 'BANCO', 'LANCAMENTO', 'DATA', 'ENTRADA', 'SAIDA', 'TIPO', 'CONTA'],
    sampleFilename: 'extratogeral.xlsx',
    targetModule: 'statement',
    importActionType: 'statement',
  },
  {
    id: 'spec_extrato_bancario',
    code: 'OFX / XLSX Extrato',
    name: 'Extratos por fonte — legado (Bradesco XML, PagSeguro, RFN019)',
    description:
      'Formatos originais de cada banco/relatório. Mantidos porque a base histórica foi carregada com eles e as chaves precisam continuar reproduzíveis. Para dados novos, use o Extrato Geral.',
    targetCollection: 'extrato_financeiro',
    dbImpact:
      'Gera os lançamentos reais da tesouraria para o motor de conciliação (reconciliation.ts). Alimenta os relatórios de saldo real, fluxo de caixa realizado e conciliação bancária contra os títulos do RFN046. Chave determinística hash (conta, data, documento, valor).',
    expectedColumns: ['Data', 'Conta / Banco', 'Documento / Histórico', 'Tipo (Entrada/Saída)', 'Valor (R$)'],
    sampleFilename: 'extrato_bradesco_julho_2026.ofx',
    targetModule: 'statement',
    importActionType: 'statement',
  },
  {
    id: 'spec_rfn046_pagar',
    code: 'RFN046 Pagar',
    name: 'RFN046 — Títulos Financeiros de Saída (Contas a Pagar)',
    description: 'Relatório corporativo de compromissos com fornecedores e terceiros.',
    targetCollection: 'contas_a_pagar',
    dbImpact:
      'Títulos de saída para cálculo do aging de pagamentos, projeção de desembolsos semanais do Fluxo de Caixa e apuração da Posicao de Caixa Hoje — Necessidade de Aporte.',
    expectedColumns: ['Título / Nosso Número', 'Fornecedor / Favorecido', 'Data Emissão', 'Vencimento', 'Valor Original', 'Saldo a Pagar', 'Status / Portador'],
    sampleFilename: 'RFN046_ContasPagar.xlsx',
    targetModule: 'payables',
    importActionType: 'titulos_pay',
  },
  {
    id: 'spec_rfn046_receber',
    code: 'RFN046 Receber',
    name: 'RFN046 — Títulos Financeiros de Entrada (Contas a Receber)',
    description: 'Relatório corporativo de recebíveis de clientes.',
    targetCollection: 'contas_a_receber',
    dbImpact:
      'Títulos de entrada para aging de cobrança, cálculo de inadimplência acumulada e projeção de entradas no Fluxo de Caixa.',
    expectedColumns: ['Título / Nosso Número', 'Cliente / Sacado', 'Emissão', 'Vencimento', 'Valor Original', 'Saldo a Receber', 'Carteira / Status'],
    sampleFilename: 'RFN046_ContasReceber.xlsx',
    targetModule: 'receivables',
    importActionType: 'titulos_rec',
  },
  {
    id: 'spec_rpr014',
    code: 'RPR014',
    name: 'RPR014 — Faturamento & Notas Fiscais Emitidas',
    description: 'Demonstrativo de faturamento bruto mensal e notas fiscais emitidas.',
    targetCollection: 'faturamento',
    dbImpact:
      'Alimenta o cálculo da Receita Bruta mensal do Resultado Econômico (DRE), análise de concentração de clientes, impostos faturados e risco da carteira.',
    expectedColumns: ['Número da Nota', 'Data de Emissão', 'Código Cliente', 'Razão Social', 'Vendedor', 'Valor Total da Nota', 'Status NF'],
    sampleFilename: 'RPR014_Faturamento_Julho2026.xlsx',
    targetModule: 'billing',
    importActionType: 'billing',
  },
  {
    id: 'spec_rpr001',
    code: 'RPR001',
    name: 'RPR001 — Vendas de Produtos Item a Item',
    description: 'Relatório de vendas detalhadas por item de produto e equipe comercial.',
    targetCollection: 'vendas',
    dbImpact:
      'Alimenta o módulo de Auditoria de Vendas e Vendedores. Apura a Margem de Contribuição por vendedor, descontos praticados vs preço de tabela e desvios de política comercial.',
    expectedColumns: ['Pedido', 'Código Produto', 'Descrição Item', 'Vendedor', 'Quantidade Vendida', 'Preço Tabela', 'Preço Praticado', 'Desconto %'],
    sampleFilename: 'RPR001_VendasProdutos.xlsx',
    targetModule: 'sales',
    importActionType: 'sales',
  },
  {
    id: 'spec_rpr053',
    code: 'RPR053',
    name: 'RPR053 — Posição Físico-Financeira de Estoque',
    description: 'Relatório de produtos em estoque, custo médio e valuation patrimonial.',
    targetCollection: 'estoque',
    dbImpact:
      'Registra o valor do Capital Parado em Estoque e alimenta a apuração do CMV (Custo das Mercadorias Vendidas) no DRE Econômico.',
    expectedColumns: ['Código Produto', 'Descrição Produto', 'Família / Categoria', 'Saldo Físico (Qtd)', 'Preço Tabela', 'Custo Médio Un.', 'Valor Estoque Total'],
    sampleFilename: 'RPR053_PosicaoEstoque.xlsx',
    targetModule: 'stock',
    importActionType: 'stock',
  },
  {
    id: 'spec_rfn029',
    code: 'RFN029',
    name: 'RFN029 — Carteira de Clientes e Histórico de Inadimplência',
    description: 'Relatório cadastral de clientes com limites de crédito e ocorrências de cobrança.',
    targetCollection: 'clientes',
    dbImpact:
      'Atualiza os dados cadastrais da carteira, score de risco por cliente e inadimplência histórica no relatório de recebíveis.',
    expectedColumns: ['Código Cliente', 'CNPJ / CPF', 'Razão Social / Nome', 'Vendedor Responsável', 'Limite de Crédito', 'Classe de Risco', 'Total em Atraso'],
    sampleFilename: 'RFN029_InadimplenciaClientes.xlsx',
    targetModule: 'customers',
    importActionType: 'delinquency',
  },
  {
    id: 'spec_dre_executivo',
    code: 'DRE Executivo',
    name: 'Planilha DRE Executivo — Plano de Contas Econômico',
    description: 'Valores mensais de despesas fixas, CMV e metas econômicas.',
    targetCollection: 'resultado_economico',
    dbImpact:
      'Grava os dados consolidados do Resultado Econômico no Firestore (`resultado_economico/{ano}`), calculando margem líquida e Ponto de Equilíbrio.',
    expectedColumns: ['Mês/Ano', 'Receita Bruta', 'CMV', 'Margem Bruta', 'Despesas Fixas', 'Resultado Econômico', 'Ponto de Equilíbrio'],
    sampleFilename: 'DRE_Executivo_2026.xlsx',
    targetModule: 'economic',
    importActionType: 'economic',
  },
];
