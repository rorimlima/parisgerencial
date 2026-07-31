/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PERSISTÊNCIA DE ACORDOS DE NEGOCIAÇÃO
 * ─────────────────────────────────────
 * Coleção `acordos_negociacao`.
 *
 * Os nomes dos campos no Firestore são em português, seguindo a convenção já
 * usada em `titulos_inadimplentes` e `extrato_financeiro`. Manter o padrão
 * importa: o financeiro consulta o console do Firebase direto quando precisa
 * conferir um lançamento, e uma coleção em inglês no meio de dez em português
 * é exatamente o tipo de detalhe que faz a conferência ser abandonada.
 *
 * Acordo NUNCA é apagado em operação normal — é cancelado (`status`). Um acordo
 * excluído leva junto a prova de qual desconto foi concedido e por quem, e essa
 * é a informação que uma auditoria de perdas vai pedir primeiro.
 */

import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  doc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { firebaseConfig } from '../firebaseConfig';
import { DebtAgreement, AgreementInstallment } from '../types';
import { money, safeNum } from '../utils/negotiation';

const COLLECTION = 'acordos_negociacao';

const db = () => {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
};

const installmentToFs = (p: AgreementInstallment) => ({
  numero: p.number,
  vencimento: p.dueDate || '',
  valor_previsto: money(safeNum(p.expectedAmount)),
  valor_pago: money(safeNum(p.paidAmount)),
  data_pagamento: p.paidDate || '',
  status: p.status,
  observacoes: p.notes || '',
});

const installmentFromFs = (raw: any): AgreementInstallment => ({
  number: Number(raw?.numero) || 0,
  dueDate: raw?.vencimento || '',
  expectedAmount: money(safeNum(raw?.valor_previsto)),
  paidAmount: money(safeNum(raw?.valor_pago)),
  paidDate: raw?.data_pagamento || '',
  status: (raw?.status as AgreementInstallment['status']) || 'Pendente',
  notes: raw?.observacoes || '',
});

const toFirestore = (a: Partial<DebtAgreement>): Record<string, any> => {
  const d: Record<string, any> = {};
  if (a.code !== undefined) d.codigo = a.code;
  if (a.customerId !== undefined) d.cliente_id = a.customerId || '';
  if (a.customerCode !== undefined) d.codigo_cliente = a.customerCode || '';
  if (a.customerName !== undefined) d.cliente_nome = a.customerName || '';
  if (a.cnpjCpf !== undefined) d.cnpj_cpf = a.cnpjCpf || '';
  if (a.customerPhone !== undefined) d.telefone = a.customerPhone || '';
  if (a.sellerName !== undefined) d.vendedor_nome = a.sellerName || '';
  if (a.titleIds !== undefined) d.titulos_ids = a.titleIds || [];
  if (a.titleNumbers !== undefined) d.titulos_numeros = a.titleNumbers || [];
  if (a.originalDebt !== undefined) d.divida_original = money(a.originalDebt);
  if (a.interestAmount !== undefined) d.juros = money(a.interestAmount);
  if (a.penaltyAmount !== undefined) d.multa = money(a.penaltyAmount);
  if (a.updatedDebt !== undefined) d.divida_atualizada = money(a.updatedDebt);
  if (a.discountPercent !== undefined) d.desconto_percentual = safeNum(a.discountPercent);
  if (a.discountAmount !== undefined) d.desconto_valor = money(a.discountAmount);
  if (a.discountBasis !== undefined) d.desconto_base = a.discountBasis;
  if (a.agreedTotal !== undefined) d.total_acordado = money(a.agreedTotal);
  if (a.downPayment !== undefined) d.entrada = money(a.downPayment);
  if (a.downPaymentDate !== undefined) d.entrada_data = a.downPaymentDate || '';
  if (a.installmentCount !== undefined) d.qtd_parcelas = Math.max(0, Math.floor(safeNum(a.installmentCount)));
  if (a.installmentAmount !== undefined) d.valor_parcela = money(a.installmentAmount);
  if (a.firstDueDate !== undefined) d.primeiro_vencimento = a.firstDueDate || '';
  if (a.installments !== undefined) d.parcelas = (a.installments || []).map(installmentToFs);
  if (a.paymentMethod !== undefined) d.forma_pagamento = a.paymentMethod || '';
  if (a.status !== undefined) d.status = a.status;
  if (a.negotiatedBy !== undefined) d.negociado_por = a.negotiatedBy || '';
  if (a.negotiatedAt !== undefined) d.negociado_em = a.negotiatedAt || '';
  if (a.notes !== undefined) d.observacoes = a.notes || '';
  if (a.totalPaid !== undefined) d.total_pago = money(a.totalPaid);
  if (a.totalOutstanding !== undefined) d.saldo_devedor = money(a.totalOutstanding);
  d.atualizado_em = new Date().toISOString();
  return d;
};

const fromFirestore = (id: string, raw: any): DebtAgreement => ({
  id,
  code: raw?.codigo || id,
  customerId: raw?.cliente_id || '',
  customerCode: raw?.codigo_cliente || '',
  customerName: raw?.cliente_nome || '',
  cnpjCpf: raw?.cnpj_cpf || '',
  customerPhone: raw?.telefone || '',
  sellerName: raw?.vendedor_nome || '',
  titleIds: Array.isArray(raw?.titulos_ids) ? raw.titulos_ids : [],
  titleNumbers: Array.isArray(raw?.titulos_numeros) ? raw.titulos_numeros : [],
  originalDebt: money(safeNum(raw?.divida_original)),
  interestAmount: money(safeNum(raw?.juros)),
  penaltyAmount: money(safeNum(raw?.multa)),
  updatedDebt: money(safeNum(raw?.divida_atualizada)),
  discountPercent: safeNum(raw?.desconto_percentual),
  discountAmount: money(safeNum(raw?.desconto_valor)),
  discountBasis: raw?.desconto_base === 'total' ? 'total' : 'encargos',
  agreedTotal: money(safeNum(raw?.total_acordado)),
  downPayment: money(safeNum(raw?.entrada)),
  downPaymentDate: raw?.entrada_data || '',
  installmentCount: Math.max(0, Math.floor(safeNum(raw?.qtd_parcelas))),
  installmentAmount: money(safeNum(raw?.valor_parcela)),
  firstDueDate: raw?.primeiro_vencimento || '',
  installments: Array.isArray(raw?.parcelas) ? raw.parcelas.map(installmentFromFs) : [],
  paymentMethod: raw?.forma_pagamento || undefined,
  status: (raw?.status as DebtAgreement['status']) || 'Ativo',
  negotiatedBy: raw?.negociado_por || '',
  negotiatedAt: raw?.negociado_em || '',
  updatedAt: raw?.atualizado_em || '',
  notes: raw?.observacoes || '',
  totalPaid: money(safeNum(raw?.total_pago)),
  totalOutstanding: money(safeNum(raw?.saldo_devedor)),
});

/** Carrega todos os acordos. A carteira é pequena (centenas), não paginamos. */
export const fetchAgreements = async (): Promise<DebtAgreement[]> => {
  try {
    const snap = await getDocs(collection(db(), COLLECTION));
    return snap.docs
      .map((d) => fromFirestore(d.id, d.data()))
      .sort((a, b) => (b.negotiatedAt || '').localeCompare(a.negotiatedAt || ''));
  } catch (error) {
    console.error('Erro ao carregar acordos de negociação:', error);
    return [];
  }
};

/**
 * Grava o acordo e carimba os títulos envolvidos numa única transação em lote.
 *
 * O batch é obrigatório aqui: se o acordo gravasse e o carimbo do título
 * falhasse, o mesmo título ficaria disponível para uma segunda negociação e a
 * empresa teria dois acordos vigentes sobre a mesma dívida.
 */
export const saveAgreement = async (agreement: DebtAgreement): Promise<void> => {
  const database = db();
  const batch = writeBatch(database);
  batch.set(doc(database, COLLECTION, agreement.id), toFirestore(agreement), { merge: true });

  const vinculado = agreement.status === 'Ativo' || agreement.status === 'Cumprido';
  for (const titleId of agreement.titleIds) {
    batch.set(
      doc(database, 'titulos_inadimplentes', titleId),
      {
        acordo_id: vinculado ? agreement.id : '',
        status_cobranca:
          agreement.status === 'Cumprido'
            ? 'Aguardando'
            : agreement.status === 'Ativo'
              ? 'Acordo em Andamento'
              : 'Em Cobrança',
      },
      { merge: true }
    );
  }

  await batch.commit();
};

export const updateAgreement = async (id: string, patch: Partial<DebtAgreement>): Promise<void> => {
  await setDoc(doc(db(), COLLECTION, id), toFirestore(patch), { merge: true });
};

/** Exclusão física — reservada a admin/gestor e a erros de digitação recentes. */
export const deleteAgreement = async (id: string, titleIds: string[] = []): Promise<void> => {
  const database = db();
  const batch = writeBatch(database);
  batch.delete(doc(database, COLLECTION, id));
  for (const titleId of titleIds) {
    batch.set(
      doc(database, 'titulos_inadimplentes', titleId),
      { acordo_id: '', status_cobranca: 'Em Cobrança' },
      { merge: true }
    );
  }
  await batch.commit();
};

export const deleteAgreementDoc = async (id: string): Promise<void> => {
  await deleteDoc(doc(db(), COLLECTION, id));
};
