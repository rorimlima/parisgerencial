/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tasks Service — Gerenciamento de Tarefas Diárias e Rotinas Operacionais.
 * Suporta persistência em Firestore (`tarefas_rotinas`) e fallback no LocalStorage.
 */

import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { getFirestoreDb } from './firebaseService';
import { FinancialAttachment, RoutineTask, TaskCategory, TaskPriority, TaskStatus } from '../types';

const TASKS_COLLECTION = 'tarefas_rotinas';
const ATTACHMENTS_COLLECTION = 'comprovantes_francesas';
const LOCAL_STORAGE_KEY_PREFIX = 'pdg.tasks.';
const ATTACHMENTS_STORAGE_KEY_PREFIX = 'pdg.attachments.';

/**
 * Retorna as rotinas padrão inicializadas para qualquer data operacional.
 */
export function getDefaultSystemRoutines(dateISO: string): RoutineTask[] {
  const nowStr = new Date().toISOString();
  return [
    {
      id: `sys_extratos_${dateISO}`,
      dateISO,
      title: 'Lançar e Conciliar Extratos dos Bancos',
      description:
        'Importar extratos OFX/XLSX de Bradesco, PagBank e Caixa/Tesouraria para o Extrato Financeiro e executar a conciliação automática com o RFN046.',
      category: 'extratos_tesouraria',
      status: 'pendente',
      priority: 'alta',
      spreadsheetSpecId: 'spec_extrato_bancario',
      targetViewTab: 'statement',
      isSystemRoutine: true,
      createdAt: nowStr,
      updatedAt: nowStr,
      checklists: [
        { id: 'chk_1_1', text: 'Baixar extrato OFX/XLSX no Internet Banking (Bradesco, PagBank, Caixa)', done: false },
        { id: 'chk_1_2', text: 'Realizar upload do extrato no módulo Extrato Financeiro', done: false },
        { id: 'chk_1_3', text: 'Executar conciliação automática de lançamentos', done: false },
      ],
    },
    {
      id: `sys_comprovantes_${dateISO}`,
      dateISO,
      title: 'Guardar Comprovantes, Francesas e Extratos do Dia',
      description:
        'Fazer upload e arquivar no banco de dados os comprovantes de pagamento, francesas bancárias (borderôs de cobrança) e extratos diários.',
      category: 'extratos_tesouraria',
      status: 'pendente',
      priority: 'alta',
      spreadsheetSpecId: 'spec_extrato_bancario',
      targetViewTab: 'tasks',
      isSystemRoutine: true,
      createdAt: nowStr,
      updatedAt: nowStr,
      checklists: [
        { id: 'chk_c_1', text: 'Anexar francesas bancárias (borderôs de liquidação)', done: false },
        { id: 'chk_c_2', text: 'Anexar comprovantes de pagamento e transferências efetuadas', done: false },
        { id: 'chk_c_3', text: 'Validar arquivos anexados no banco de dados do dia', done: false },
      ],
    },
    {
      id: `sys_pagamentos_${dateISO}`,
      dateISO,
      title: 'Baixar e Processar Pagamentos do Dia (Contas a Pagar)',
      description:
        'Verificar compromissos e títulos de saída do RFN046 com vencimento na data de hoje, efetuar os pagamentos no banco e registrar as baixas.',
      category: 'pagamentos_dia',
      status: 'pendente',
      priority: 'alta',
      spreadsheetSpecId: 'spec_rfn046_pagar',
      targetViewTab: 'payables',
      isSystemRoutine: true,
      createdAt: nowStr,
      updatedAt: nowStr,
      checklists: [
        { id: 'chk_2_1', text: 'Filtrar títulos a pagar com vencimento para o dia de hoje', done: false },
        { id: 'chk_2_2', text: 'Agendar / autorizar pagamentos na tesouraria bancária', done: false },
        { id: 'chk_2_3', text: 'Dar baixa manual ou via extrato nos títulos pagos', done: false },
      ],
    },
    {
      id: `sys_compras_${dateISO}`,
      dateISO,
      title: 'Processar Compras Pendentes e Notas de Recebimento',
      description:
        'Conferir notas fiscais de entrada de compras, atualização de ordens de fornecedores e títulos a receber do dia.',
      category: 'compras_pendentes',
      status: 'pendente',
      priority: 'media',
      spreadsheetSpecId: 'spec_rfn046_receber',
      targetViewTab: 'receivables',
      isSystemRoutine: true,
      createdAt: nowStr,
      updatedAt: nowStr,
      checklists: [
        { id: 'chk_3_1', text: 'Conferir títulos a receber de clientes agendados para hoje', done: false },
        { id: 'chk_3_2', text: 'Verificar compras pendentes de faturamento de fornecedores', done: false },
      ],
    },
    {
      id: `sys_vendas_${dateISO}`,
      dateISO,
      title: 'Importar Vendas do Dia (RPR001) e Estoque (RPR053)',
      description:
        'Carregar planilhas RPR001 para auditoria de margem por vendedor e RPR053 para atualização do capital em estoque.',
      category: 'vendas_estoque',
      status: 'pendente',
      priority: 'media',
      spreadsheetSpecId: 'spec_rpr001',
      targetViewTab: 'sales',
      isSystemRoutine: true,
      createdAt: nowStr,
      updatedAt: nowStr,
      checklists: [
        { id: 'chk_4_1', text: 'Exportar RPR001 no ERP com vendas detalhadas', done: false },
        { id: 'chk_4_2', text: 'Importar RPR001 para auditoria de vendedores e descontos', done: false },
        { id: 'chk_4_3', text: 'Atualizar relatório RPR053 de estoque físico-financeiro', done: false },
      ],
    },
    {
      id: `sys_fechamento_${dateISO}`,
      dateISO,
      title: 'Validar Movimento Diário de Caixa & Aportes',
      description:
        'Conferir totais de entradas e saídas no Movimento Diário de Caixa e checar a Necessidade de Aporte no Fluxo de Caixa.',
      category: 'fechamento_caixa',
      status: 'pendente',
      priority: 'alta',
      targetViewTab: 'daily',
      isSystemRoutine: true,
      createdAt: nowStr,
      updatedAt: nowStr,
      checklists: [
        { id: 'chk_5_1', text: 'Conferir saldo consolidado das contas no Movimento Diário', done: false },
        { id: 'chk_5_2', text: 'Verificar se o card Posicao de Caixa exige Aporte de Capital', done: false },
      ],
    },
  ];
}

/**
 * Carrega as tarefas para a data especificada (YYYY-MM-DD).
 * Se não houver registros, inicializa as 5 rotinas padrão do dia.
 */
export async function getOrInitializeDailyTasks(dateISO: string): Promise<RoutineTask[]> {
  const localKey = `${LOCAL_STORAGE_KEY_PREFIX}${dateISO}`;
  let tasks: RoutineTask[] = [];

  // 1. Tenta carregar do Firestore se disponível
  try {
    const db = getFirestoreDb();
    if (db) {
      const q = query(collection(db, TASKS_COLLECTION), where('dateISO', '==', dateISO));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        tasks = snapshot.docs.map((docSnap) => docSnap.data() as RoutineTask);
      }
    }
  } catch (err) {
    console.warn('[TasksService] Erro ao carregar tarefas do Firestore, utilizando fallback local:', err);
  }

  // 2. Se não encontrou no Firestore, busca no LocalStorage
  if (tasks.length === 0 && typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(localKey);
      if (stored) {
        tasks = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[TasksService] Erro ao ler tarefas do localStorage:', e);
    }
  }

  // 3. Se ainda assim a lista estiver vazia, gera as rotinas padrão e salva
  if (tasks.length === 0) {
    tasks = getDefaultSystemRoutines(dateISO);
    await saveTasksList(dateISO, tasks);
  }

  return tasks;
}

/**
 * Salva a lista completa de tarefas de um dia no Firestore e no LocalStorage.
 */
export async function saveTasksList(dateISO: string, tasks: RoutineTask[]): Promise<void> {
  const localKey = `${LOCAL_STORAGE_KEY_PREFIX}${dateISO}`;

  // Grava no LocalStorage para acesso imediato
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(localKey, JSON.stringify(tasks));
    } catch (e) {
      console.warn('[TasksService] Erro ao gravar tarefas no LocalStorage:', e);
    }
  }

  // Grava no Firestore doc a doc
  try {
    const db = getFirestoreDb();
    if (db) {
      for (const t of tasks) {
        await setDoc(doc(db, TASKS_COLLECTION, t.id), t, { merge: true });
      }
    }
  } catch (err) {
    console.warn('[TasksService] Aviso ao persistir no Firestore:', err);
  }
}

/**
 * Atualiza uma única tarefa (status, nota, checklist ou cancelamento).
 */
export async function saveSingleTask(task: RoutineTask): Promise<void> {
  task.updatedAt = new Date().toISOString();
  const dateISO = task.dateISO;
  const currentList = await getOrInitializeDailyTasks(dateISO);
  const idx = currentList.findIndex((t) => t.id === task.id);

  if (idx >= 0) {
    currentList[idx] = task;
  } else {
    currentList.push(task);
  }

  await saveTasksList(dateISO, currentList);
}

/**
 * Exclui ou cancela uma tarefa.
 */
export async function deleteTask(taskId: string, dateISO: string): Promise<void> {
  const currentList = await getOrInitializeDailyTasks(dateISO);
  const updatedList = currentList.filter((t) => t.id !== taskId);
  const localKey = `${LOCAL_STORAGE_KEY_PREFIX}${dateISO}`;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(localKey, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('[TasksService] Erro ao remover do LocalStorage:', e);
    }
  }

  try {
    const db = getFirestoreDb();
    if (db) {
      await deleteDoc(doc(db, TASKS_COLLECTION, taskId));
    }
  } catch (err) {
    console.warn('[TasksService] Erro ao remover do Firestore:', err);
  }
}

// ─── GERENCIAMENTO DE COMPROVANTES, FRANCESAS E EXTRATOS BANCÁRIOS ─────────────

export async function getAttachmentsForDate(dateISO: string): Promise<FinancialAttachment[]> {
  const localKey = `${ATTACHMENTS_STORAGE_KEY_PREFIX}${dateISO}`;
  let list: FinancialAttachment[] = [];

  try {
    const db = getFirestoreDb();
    if (db) {
      const q = query(collection(db, ATTACHMENTS_COLLECTION), where('dateISO', '==', dateISO));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        list = snapshot.docs.map((d) => d.data() as FinancialAttachment);
      }
    }
  } catch (err) {
    console.warn('[TasksService] Erro ao buscar anexos no Firestore:', err);
  }

  if (list.length === 0 && typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(localKey);
      if (stored) list = JSON.parse(stored);
    } catch (e) {
      console.warn('[TasksService] Erro ao buscar anexos do LocalStorage:', e);
    }
  }

  return list;
}

export async function saveAttachment(attachment: FinancialAttachment): Promise<void> {
  const dateISO = attachment.dateISO;
  const currentList = await getAttachmentsForDate(dateISO);
  const updatedList = [...currentList.filter((a) => a.id !== attachment.id), attachment];
  const localKey = `${ATTACHMENTS_STORAGE_KEY_PREFIX}${dateISO}`;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(localKey, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('[TasksService] Erro ao salvar anexo no LocalStorage:', e);
    }
  }

  try {
    const db = getFirestoreDb();
    if (db) {
      await setDoc(doc(db, ATTACHMENTS_COLLECTION, attachment.id), attachment, { merge: true });
    }
  } catch (err) {
    console.warn('[TasksService] Erro ao salvar anexo no Firestore:', err);
  }
}

export async function deleteAttachment(attachmentId: string, dateISO: string): Promise<void> {
  const currentList = await getAttachmentsForDate(dateISO);
  const updatedList = currentList.filter((a) => a.id !== attachmentId);
  const localKey = `${ATTACHMENTS_STORAGE_KEY_PREFIX}${dateISO}`;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(localKey, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('[TasksService] Erro ao deletar anexo no LocalStorage:', e);
    }
  }

  try {
    const db = getFirestoreDb();
    if (db) {
      await deleteDoc(doc(db, ATTACHMENTS_COLLECTION, attachmentId));
    }
  } catch (err) {
    console.warn('[TasksService] Erro ao deletar anexo no Firestore:', err);
  }
}

