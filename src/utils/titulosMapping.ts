/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * titulosMapping.ts — A tradução entre `TituloFinanceiro` e o documento gravado.
 *
 * POR QUE ISTO VIVE FORA DO SERVIÇO DE FIRESTORE
 * ==============================================
 * Duas coisas escrevem nesta base: a tela de importação (browser, SDK web do
 * Firebase) e o script de carga em lote (`scripts/importTitulosRfn046.mjs`,
 * Node). Se cada uma montasse o documento do seu jeito, bastaria um campo
 * renomeado em um lado para o mesmo título existir com dois formatos no banco —
 * e a tela leria vazio justamente o que o script gravou.
 *
 * Este arquivo não importa nada do Firebase de propósito: é código puro, o que
 * permite ao script Node carregá-lo direto e usar EXATAMENTE a mesma regra de
 * ID e de nome de campo que o app usa.
 *
 * NOMES DE CAMPO EM PORTUGUÊS
 * ---------------------------
 * O banco é lido por gente da operação no console do Firebase. `data_vencimento`
 * é conferível; `dueDate` obriga a decorar tradução.
 */

import { BaixaStatus, TituloFinanceiro, TituloMovType } from '../types';

export const RECEIVABLES_COLLECTION = 'contas_a_receber';
export const PAYABLES_COLLECTION = 'contas_a_pagar';

/** Endereço da coleção pelo lado do movimento. */
export const collectionFor = (movType: TituloMovType): string =>
  movType === 'R' ? RECEIVABLES_COLLECTION : PAYABLES_COLLECTION;

/** IDs de documento não aceitam '/', '.', '..' nem string vazia. */
export const sanitizeDocId = (raw: string): string => {
  const cleaned = (raw || '').toString().trim().replace(/[/\\.#$[\]]/g, '_');
  return cleaned || `sem_codigo_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * ID determinístico do documento: `tit_<Titulo_Codigo>`.
 *
 * É esta função que faz reimportar ser inofensivo. O mesmo título sempre cai no
 * mesmo documento, então subir o relatório inteiro toda semana atualiza o que
 * mudou em vez de criar uma segunda cópia de tudo. Vale para a tela e para o
 * script — os dois chamam daqui.
 */
export const tituloDocId = (titleCode: string): string => `tit_${sanitizeDocId(titleCode)}`;

/**
 * Tira do payload as chaves vazias.
 *
 * Com `merge: true`, mandar '' MESCLA o vazio por cima do que já existia: uma
 * reimportação em que o ERP veio sem o departamento apagaria o departamento que
 * estava gravado. Enviando só o que tem conteúdo, o import ACRESCENTA e
 * ATUALIZA, nunca esvazia. Números (inclusive zero) e booleanos passam.
 */
export const stripEmpty = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
};

/**
 * Documento a gravar a partir de um título.
 *
 * Só campos que vêm do ERP. Os campos de CONCILIAÇÃO (status de baixa, extrato
 * casado, código e motivo da baixa) e a CONTA DE ORIGEM escolhida pelo gestor
 * ficam fora: são a única coisa nesta base que não veio do relatório e não pode
 * ser recriada. Deixá-los aqui faria toda reimportação apagar o trabalho de
 * conciliação já conferido e as contas de origem apontadas na mão — o RFN046 não
 * tem coluna de conta de origem, então ele sempre "diria" vazio e o vazio
 * venceria.
 */
export const tituloToFirestore = (t: TituloFinanceiro): Record<string, any> =>
  stripEmpty({
    chave: t.dedupeKey,
    titulo_codigo: t.titleCode,
    movimento: t.movType,
    empresa_codigo: t.companyCode,
    empresa_nome: t.companyName,
    titulo_numero: t.titleNumber,
    parcela: t.parcela,
    tipo_titulo: t.titleType,

    pessoa_codigo: t.personCode,
    pessoa_nome: t.personName,
    cliente_id: t.customerId,

    data_emissao: t.issueDate,
    data_entrada: t.entryDate,
    data_vencimento: t.dueDate,
    data_pagamento: t.paymentDate,
    ano: t.year,
    mes_chave: t.monthKey,
    ano_pagamento: t.paidYear,
    mes_pagamento: t.paidMonthKey,

    valor: t.amount,
    saldo: t.balance,
    valor_pendente: t.penaltyAmount,

    status_erp: t.erpStatus,
    pago: t.isPaid,

    fatura_codigo: t.invoiceCode,
    nota_fiscal_codigo: t.fiscalNoteCode,
    nota_fiscal_vinculada: t.linkedFiscalNoteCode,
    nosso_numero: t.nossoNumero,
    observacao: t.observation,

    conta_gerencial: t.managementAccount,
    classificacao_lancamento: t.launchClass,
    departamento_codigo: t.departmentCode,
    departamento: t.department,
    lote_codigo: t.batchCode,
    lote_descricao: t.batchDescription,
    agente_cobrador_codigo: t.collectionAgentCode,
    agente_cobrador: t.collectionAgent,
    tipo_cobranca_codigo: t.collectionTypeCode,
    tipo_cobranca: t.collectionType,
    natureza_operacao_codigo: t.operationNatureCode,
    natureza_operacao: t.operationNature,
  });

/** Documento gravado de volta para o modelo da aplicação. */
export const tituloFromFirestore = (
  id: string,
  d: any,
  fallbackMov: TituloMovType
): TituloFinanceiro => {
  const movType: TituloMovType = d.movimento === 'R' || d.movimento === 'P' ? d.movimento : fallbackMov;
  const statusBaixa: BaixaStatus = (d.status_baixa as BaixaStatus) || 'Em Aberto';
  const isPaid =
    d.pago === true ||
    d.status_erp === 'Pago' ||
    statusBaixa === 'Baixado Manual' ||
    statusBaixa === 'Baixado Automático' ||
    statusBaixa === 'Conciliado';

  const paymentDate = d.data_pagamento || d.baixa_em || '';
  let paidYear = Number(d.ano_pagamento) || 0;
  let paidMonthKey = d.mes_pagamento || '';

  if (isPaid && (!paidYear || !paidMonthKey)) {
    const refDateStr = paymentDate || d.data_vencimento || d.data_emissao || '';
    if (refDateStr) {
      const dt = new Date(refDateStr);
      if (!isNaN(dt.getTime())) {
        const ALL_MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
        if (!paidYear) paidYear = dt.getFullYear();
        if (!paidMonthKey) paidMonthKey = ALL_MONTH_KEYS[dt.getMonth()];
      }
    }
    if (!paidYear) paidYear = Number(d.ano) || 0;
    if (!paidMonthKey) paidMonthKey = d.mes_chave || '';
  }

  return {
    id,
    dedupeKey: d.chave || `${movType}_${d.titulo_codigo || ''}`,

    titleCode: d.titulo_codigo || '',
    movType,
    companyCode: d.empresa_codigo || '',
    companyName: d.empresa_nome || '',
    titleNumber: d.titulo_numero || '',
    parcela: d.parcela || '',
    titleType: d.tipo_titulo || '',

    personCode: d.pessoa_codigo || '',
    personName: d.pessoa_nome || '',
    customerId: d.cliente_id || '',

    issueDate: d.data_emissao || '',
    entryDate: d.data_entrada || '',
    dueDate: d.data_vencimento || '',
    paymentDate,
    year: Number(d.ano) || 0,
    monthKey: d.mes_chave || '',
    paidYear,
    paidMonthKey,

    amount: Number(d.valor) || 0,
    balance: Number(d.saldo) || 0,
    penaltyAmount: Number(d.valor_pendente) || 0,

    erpStatus: d.status_erp || '',
    isPaid,

    invoiceCode: d.fatura_codigo || '',
    fiscalNoteCode: d.nota_fiscal_codigo || '',
    linkedFiscalNoteCode: d.nota_fiscal_vinculada || '',
    nossoNumero: d.nosso_numero || '',
    observation: d.observacao || '',

    managementAccount: d.conta_gerencial || '',
    launchClass: d.classificacao_lancamento || '',
    departmentCode: d.departamento_codigo || '',
    department: d.departamento || '',
    batchCode: d.lote_codigo || '',
    batchDescription: d.lote_descricao || '',
    collectionAgentCode: d.agente_cobrador_codigo || '',
    collectionAgent: d.agente_cobrador || '',
    collectionTypeCode: d.tipo_cobranca_codigo || '',
    collectionType: d.tipo_cobranca || '',
    operationNatureCode: d.natureza_operacao_codigo || '',
    operationNature: d.natureza_operacao || '',

    status: statusBaixa,
    reconciledStatementId: d.extrato_id || '',
    reconciledSource: d.extrato_fonte || '',
    reconciledAt: d.baixa_em || '',
    matchScore: d.baixa_score !== undefined ? Number(d.baixa_score) : undefined,
    matchReason: d.baixa_motivo || '',
    baixaCode: d.baixa_codigo || '',
    notes: d.observacoes || '',

    originAccountKey: d.conta_origem || '',
    originAccountLabel: d.conta_origem_label || '',
    originSetAt: d.conta_origem_em || '',
    originSetByName: d.conta_origem_por || '',

    importedAt: d.importado_em || '',
    updatedAt: d.atualizado_em || '',
  };
};
