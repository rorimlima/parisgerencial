/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * titulosService.ts — Persistência dos títulos financeiros (RFN046).
 *
 * DUAS COLEÇÕES, UM MODELO
 * ========================
 *   contas_a_receber  ← Titulo_MovimentoFinanceiro = 'R'  (entradas)
 *   contas_a_pagar    ← Titulo_MovimentoFinanceiro = 'P'  (saídas)
 *
 * Coleções separadas porque as duas telas leem sempre um lado só: juntar tudo
 * obrigaria toda consulta a carregar o dobro dos documentos e filtrar em
 * memória. O modelo gravado é idêntico nas duas — o mesmo parser, o mesmo
 * conversor, os mesmos campos. O que muda é o endereço.
 *
 * REIMPORTAR NUNCA DUPLICA, NUNCA APAGA BAIXA
 * -------------------------------------------
 * 1. DocId determinístico `tit_<Titulo_Codigo>`: o mesmo título sempre cai no
 *    mesmo documento. Subir o relatório inteiro toda semana atualiza o que
 *    mudou em vez de criar uma segunda cópia de tudo.
 * 2. `merge: true` + `stripEmpty`: campo vazio no arquivo não apaga campo
 *    preenchido no banco. Um export do ERP sem departamento não pode zerar o
 *    departamento que já estava lá.
 * 3. Os campos de CONCILIAÇÃO (status de baixa, extrato casado, código, notas)
 *    ficam FORA do payload de importação. O trabalho de conciliação do gestor
 *    sobrevive a qualquer reimportação — é a única coisa nesta base que não
 *    veio do ERP e não pode ser recriada.
 *
 * NOMES DE CAMPO EM PORTUGUÊS NO FIRESTORE
 * ----------------------------------------
 * O banco é lido por gente da operação no console do Firebase. Campo chamado
 * `data_vencimento` é conferível; `dueDate` obriga a decorar tradução.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import {
  BaixaStatus,
  ReconciliationMatch,
  TituloFinanceiro,
  TituloMovType,
} from '../types';
import { getFirestoreDb } from './firebaseService';

import {
  PAYABLES_COLLECTION,
  RECEIVABLES_COLLECTION,
  collectionFor,
  tituloDocId,
  tituloFromFirestore,
  tituloToFirestore,
} from '../utils/titulosMapping';

// Reexportados para quem já importava daqui.
export { PAYABLES_COLLECTION, RECEIVABLES_COLLECTION, collectionFor };

// ─── Infra ───────────────────────────────────────────────────────────────────

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tempo esgotado ao ${label}. Verifique a conexão e tente novamente.`)), ms)
    ),
  ]);

// ─── Leitura ─────────────────────────────────────────────────────────────────

/**
 * Busca títulos de um lado do movimento.
 *
 * SEM `year` VOLTA TUDO — E ISSO É NECESSÁRIO NA CONCILIAÇÃO. Um título pago em
 * 30/12 compensa no extrato em 03/01; filtrando por ano, o par nunca é
 * encontrado. As telas filtram por ano; o motor de baixa, não.
 */
export const fetchTitulos = async (
  movType: TituloMovType,
  year?: number
): Promise<TituloFinanceiro[]> => {
  try {
    const db = getFirestoreDb();
    const col = collectionFor(movType);
    const q = year ? query(collection(db, col), where('ano', '==', year)) : collection(db, col);
    const snapshot = await withTimeout(
      getDocs(q),
      25000,
      `buscar ${movType === 'R' ? 'contas a receber' : 'contas a pagar'}`
    );
    return snapshot.docs
      .map((d) => tituloFromFirestore(d.id, d.data(), movType))
      .sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0));
  } catch (error) {
    console.error(`Erro ao buscar títulos (${movType}):`, error);
    return [];
  }
};

export const fetchReceivables = (year?: number) => fetchTitulos('R', year);
export const fetchPayables = (year?: number) => fetchTitulos('P', year);

const fetchExistingIds = async (collectionName: string): Promise<Set<string>> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await withTimeout(getDocs(collection(db, collectionName)), 25000, `conferir base ${collectionName}`);
    return new Set(snapshot.docs.map((d) => d.id));
  } catch (error) {
    console.error(`Não foi possível conferir os IDs existentes de ${collectionName}:`, error);
    return new Set();
  }
};

// ─── Importação (UPSERT em lote) ─────────────────────────────────────────────

export interface UpsertResult {
  count: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Grava os títulos em blocos de 400 operações (limite prático do writeBatch).
 * Gravar 1 a 1 uma base de 400+ linhas custaria minutos e travaria a tela.
 *
 * O status de baixa inicial só é definido em documento NOVO: sobrescrever o
 * status de um título já existente devolveria para "Em Aberto" uma baixa que o
 * gestor já tinha conferido.
 */
export const upsertTitulosBatch = async (titulos: TituloFinanceiro[]): Promise<UpsertResult> => {
  if (titulos.length === 0) return { count: 0, created: 0, updated: 0, errors: 0 };

  const db = getFirestoreDb();
  const movType = titulos[0].movType;
  const col = collectionFor(movType);
  const existingIds = await fetchExistingIds(col);
  const now = new Date().toISOString();

  let count = 0, created = 0, updated = 0, errors = 0;
  const CHUNK = 400;

  for (let i = 0; i < titulos.length; i += CHUNK) {
    const chunk = titulos.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      let chunkCreated = 0;

      for (const t of chunk) {
        const docId = tituloDocId(t.titleCode);
        const isNew = !existingIds.has(docId);
        if (isNew) chunkCreated += 1;

        const payload = tituloToFirestore(t);
        payload.atualizado_em = now;
        if (isNew) {
          payload.criado_em = now;
          payload.importado_em = now;
          payload.status_baixa = 'Em Aberto';
        }

        batch.set(doc(db, col, docId), payload, { merge: true });
        existingIds.add(docId);
      }

      await withTimeout(batch.commit(), 25000, `gravar lote de títulos (${chunk.length} registros)`);
      count += chunk.length;
      created += chunkCreated;
      updated += chunk.length - chunkCreated;
    } catch (err) {
      console.error('Erro no lote de títulos:', err);
      errors += chunk.length;
    }
  }

  return { count, created, updated, errors };
};

// ─── Conciliação / baixa ─────────────────────────────────────────────────────

/** Aplica um conjunto de baixas automáticas vindas do motor de conciliação. */
export const applyReconciliation = async (
  movType: TituloMovType,
  matches: ReconciliationMatch[],
  baixaStatus: BaixaStatus = 'Baixado Automático'
): Promise<number> => {
  if (matches.length === 0) return 0;
  const db = getFirestoreDb();
  const col = collectionFor(movType);
  const now = new Date().toISOString();
  const CHUNK = 400;
  let applied = 0;

  for (let i = 0; i < matches.length; i += CHUNK) {
    const chunk = matches.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const m of chunk) {
      batch.set(
        doc(db, col, m.tituloId),
        {
          status_baixa: baixaStatus,
          extrato_id: m.statementId,
          extrato_fonte: m.statementSource,
          baixa_em: now,
          baixa_score: m.score,
          baixa_motivo: m.reason,
        },
        { merge: true }
      );
    }
    await withTimeout(batch.commit(), 25000, `aplicar baixas (${chunk.length} títulos)`);
    applied += chunk.length;
  }
  return applied;
};

/** Marca títulos como candidatos a conferência (sugestões abaixo do corte). */
export const markForReview = async (movType: TituloMovType, matches: ReconciliationMatch[]): Promise<number> => {
  if (matches.length === 0) return 0;
  const db = getFirestoreDb();
  const col = collectionFor(movType);
  const CHUNK = 400;
  let applied = 0;
  for (let i = 0; i < matches.length; i += CHUNK) {
    const chunk = matches.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const m of chunk) {
      batch.set(
        doc(db, col, m.tituloId),
        { status_baixa: 'Conferir', baixa_score: m.score, baixa_motivo: m.reason, extrato_sugerido: m.statementId },
        { merge: true }
      );
    }
    await withTimeout(batch.commit(), 25000, `marcar títulos para conferência (${chunk.length})`);
    applied += chunk.length;
  }
  return applied;
};

/** Edição pontual de um título (baixa manual, vínculo de cliente, observação). */
export const updateTituloFields = async (
  movType: TituloMovType,
  id: string,
  fields: Partial<TituloFinanceiro>
): Promise<void> => {
  const db = getFirestoreDb();
  const data: Record<string, any> = { atualizado_em: new Date().toISOString() };
  if (fields.status !== undefined) data.status_baixa = fields.status;
  if (fields.reconciledStatementId !== undefined) data.extrato_id = fields.reconciledStatementId;
  if (fields.reconciledSource !== undefined) data.extrato_fonte = fields.reconciledSource;
  if (fields.reconciledAt !== undefined) data.baixa_em = fields.reconciledAt;
  if (fields.baixaCode !== undefined) data.baixa_codigo = fields.baixaCode;
  if (fields.matchScore !== undefined) data.baixa_score = fields.matchScore;
  if (fields.matchReason !== undefined) data.baixa_motivo = fields.matchReason;
  if (fields.notes !== undefined) data.observacoes = fields.notes;
  if (fields.customerId !== undefined) data.cliente_id = fields.customerId;

  if (fields.isPaid !== undefined) data.pago = fields.isPaid;
  if (fields.paymentDate !== undefined) data.data_pagamento = fields.paymentDate;
  if (fields.paidYear !== undefined) data.ano_pagamento = fields.paidYear;
  if (fields.paidMonthKey !== undefined) data.mes_pagamento = fields.paidMonthKey;

  // Se o status for de baixa e não tiver sido passado isPaid explícito, define como pago
  if (fields.status && ['Baixado Manual', 'Baixado Automático', 'Conciliado'].includes(fields.status)) {
    data.pago = true;
    if (!data.data_pagamento && fields.reconciledAt) data.data_pagamento = fields.reconciledAt;
  } else if (fields.status === 'Em Aberto') {
    data.pago = false;
  }

  await withTimeout(
    setDoc(doc(db, collectionFor(movType), id), data, { merge: true }),
    12000,
    'salvar alteração do título'
  );
};

/** Grava em lote o vínculo título → cliente resolvido pelo cod_cliente. */
export const linkCustomersBatch = async (
  movType: TituloMovType,
  links: { id: string; customerId: string }[]
): Promise<number> => {
  if (links.length === 0) return 0;
  const db = getFirestoreDb();
  const col = collectionFor(movType);
  const CHUNK = 400;
  let applied = 0;
  for (let i = 0; i < links.length; i += CHUNK) {
    const chunk = links.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const l of chunk) batch.set(doc(db, col, l.id), { cliente_id: l.customerId }, { merge: true });
    await withTimeout(batch.commit(), 25000, `vincular clientes (${chunk.length} títulos)`);
    applied += chunk.length;
  }
  return applied;
};

// ─── Exclusão / zeramento ────────────────────────────────────────────────────

export const deleteTitulo = async (movType: TituloMovType, id: string): Promise<void> => {
  const db = getFirestoreDb();
  await withTimeout(deleteDoc(doc(db, collectionFor(movType), id)), 12000, 'excluir título');
};

/**
 * Zera uma coleção de títulos (ano específico ou tudo).
 *
 * Operação destrutiva e sem volta: o Firestore não tem lixeira. Quem chama é
 * responsável por confirmar com o gestor antes — e a tela de manutenção exige
 * a digitação do nome da base justamente por isso.
 */
export const clearTitulos = async (movType: TituloMovType, year?: number): Promise<number> => {
  const db = getFirestoreDb();
  const col = collectionFor(movType);
  const q = year ? query(collection(db, col), where('ano', '==', year)) : collection(db, col);
  const snapshot = await withTimeout(getDocs(q), 30000, `buscar títulos para zerar (${col})`);
  const docs = snapshot.docs;
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => batch.delete(doc(db, col, d.id)));
    await withTimeout(batch.commit(), 25000, `zerar lote de ${col}`);
  }
  return docs.length;
};

/** Apaga uma coleção inteira em lotes — usada pelo painel de manutenção. */
export const clearCollection = async (collectionName: string): Promise<number> => {
  const db = getFirestoreDb();
  const snapshot = await withTimeout(getDocs(collection(db, collectionName)), 30000, `buscar ${collectionName}`);
  const docs = snapshot.docs;
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => batch.delete(doc(db, collectionName, d.id)));
    await withTimeout(batch.commit(), 25000, `zerar lote de ${collectionName}`);
  }
  return docs.length;
};

/**
 * Bases que o "zerar recebimento" apaga. As demais (resultado econômico e
 * financeiro, fluxo de caixa, faturamento, vendas, estoque, clientes,
 * vendedores e o extrato bancário) ficam intocadas — foi o que o gestor pediu,
 * e é o que preserva o histórico gerencial enquanto a nova fonte é montada.
 */
export const RESETTABLE_COLLECTIONS: { key: string; label: string; description: string }[] = [
  {
    key: 'titulos_inadimplentes',
    label: 'Inadimplência (RFN029)',
    description: 'Base antiga de recebimento — substituída pelo Contas a Receber (RFN046).',
  },
  {
    key: RECEIVABLES_COLLECTION,
    label: 'Contas a Receber',
    description: 'Títulos de entrada importados do RFN046.',
  },
  {
    key: PAYABLES_COLLECTION,
    label: 'Contas a Pagar',
    description: 'Títulos de saída importados do RFN046.',
  },
  {
    key: 'contas_a_pagar_previsao',
    label: 'Previsão de Pagamento (legado)',
    description: 'Base antiga separada de previsão — agora vive dentro do Contas a Pagar, pelo status.',
  },
];

/** Coleções que NUNCA entram no zeramento. Documentado para não virar acidente. */
export const PROTECTED_COLLECTIONS = [
  'resultado_economico',
  'resultado_financeiro',
  'fluxo_caixa',
  'extrato_financeiro',
  'faturamento',
  'faturamento_resumo',
  'faturamento_cliente',
  'vendas',
  'vendas_resumo',
  'estoque',
  'estoque_resumo',
  'clientes',
  'vendedores',
  'usuarios',
];
