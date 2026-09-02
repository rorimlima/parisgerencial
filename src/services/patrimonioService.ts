/**
 * patrimonioService.ts — CRUD Firestore para Tombamento de Loja, Patrimônio e Anexos de Notas Fiscais
 *
 * Arquitetura Híbrida & Offline-First:
 *  - Persistência no Google Cloud Firestore
 *  - Cache resiliente no LocalStorage
 *  - Tratamento de timeout e conectividade
 */

import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import type { PatrimonioItem, PatrimonioAnexo } from '../types';

const STORAGE_KEY_ITEMS = 'pdg.patrimonio.items.v1';
const STORAGE_KEY_ANEXOS_PREFIX = 'pdg.patrimonio.anexos.';

// ── Instância do Firestore ──────────────────────────────────────────────────

function getDb() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// ── Timeout Helper Resiliente ───────────────────────────────────────────────

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tempo limite excedido (${Math.round(ms / 1000)}s) em: ${label}`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
};

// ── Helpers de Armazenamento Local (Offline-First) ──────────────────────────

function getLocalItems(): PatrimonioItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ITEMS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[PatrimonioService] Erro ao ler do localStorage:', e);
    return [];
  }
}

function saveLocalItems(items: PatrimonioItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
  } catch (e) {
    console.warn('[PatrimonioService] Erro ao gravar no localStorage:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PATRIMÔNIO / TOMBAMENTO (ITENS)
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchPatrimonioItems(): Promise<{ items: PatrimonioItem[]; source: 'firestore' | 'cache' }> {
  let items: PatrimonioItem[] = [];
  let source: 'firestore' | 'cache' = 'firestore';

  try {
    const db = getDb();
    const snap = await withTimeout(
      getDocs(collection(db, 'patrimonio')),
      12000,
      'fetchPatrimonioItems',
    );

    items = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        codigoTombo: data.codigoTombo || '',
        produto: data.produto || '',
        quantidade: Number(data.quantidade) || 1,
        valorUnitario: Number(data.valorUnitario) || 0,
        valorTotal: Number(data.valorTotal) || (Number(data.quantidade) || 1) * (Number(data.valorUnitario) || 0),
        setor: data.setor || 'Salão de Vendas',
        empresa: data.empresa || 'Paris Dakar Matriz',
        dataAquisicao: data.dataAquisicao || '',
        numeroNotaFiscal: data.numeroNotaFiscal || '',
        fornecedor: data.fornecedor || '',
        estadoConservacao: data.estadoConservacao || 'Bom',
        observacao: data.observacao || '',
        anexosCount: Number(data.anexosCount) || 0,
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
      };
    });

    // Atualiza cache local
    if (items.length > 0) {
      saveLocalItems(items);
    } else {
      // Se o Firestore está vazio, confere se há dados no cache local
      const local = getLocalItems();
      if (local.length > 0) {
        items = local;
        source = 'cache';
      }
    }
  } catch (err) {
    console.warn('[PatrimonioService] Erro ou timeout no Firestore, recuperando do cache local:', err);
    items = getLocalItems();
    source = 'cache';
  }

  // Ordena por data mais recente ou código tombo
  const sorted = items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { items: sorted, source };
}

export async function savePatrimonioItem(
  item: Omit<PatrimonioItem, 'id'> & { id?: string },
): Promise<string> {
  const db = getDb();
  const now = new Date().toISOString();
  const quantidade = Number(item.quantidade) || 1;
  const valorUnitario = Number(item.valorUnitario) || 0;
  const valorTotal = quantidade * valorUnitario;

  const payload = {
    ...item,
    quantidade,
    valorUnitario,
    valorTotal,
    updatedAt: now,
  };

  let savedId = item.id;

  // 1. Salva ou atualiza no Firestore
  try {
    if (savedId) {
      const ref = doc(db, 'patrimonio', savedId);
      const { id: _, ...dataWithoutId } = payload;
      await withTimeout(
        setDoc(ref, dataWithoutId, { merge: true }),
        12000,
        'savePatrimonioItem.update',
      );
    } else {
      const newDoc = {
        ...payload,
        anexosCount: 0,
        createdAt: now,
      };
      const ref = await withTimeout(
        addDoc(collection(db, 'patrimonio'), newDoc),
        12000,
        'savePatrimonioItem.add',
      );
      savedId = ref.id;
    }
  } catch (err) {
    console.warn('[PatrimonioService] Firestore indisponível para gravação direta, gravando em cache local:', err);
    if (!savedId) {
      savedId = `pat_local_${Date.now()}`;
    }
  }

  // 2. Grava no cache local (Garante disponibilidade instantânea)
  const fullItem: PatrimonioItem = {
    ...payload,
    id: savedId!,
    createdAt: item.createdAt || now,
    anexosCount: item.anexosCount || 0,
  };

  const localList = getLocalItems();
  const existingIdx = localList.findIndex((i) => i.id === savedId);
  if (existingIdx >= 0) {
    localList[existingIdx] = fullItem;
  } else {
    localList.unshift(fullItem);
  }
  saveLocalItems(localList);

  return savedId!;
}

export async function deletePatrimonioItem(patrimonioId: string): Promise<void> {
  // 1. Deleta do cache local
  const localList = getLocalItems().filter((i) => i.id !== patrimonioId);
  saveLocalItems(localList);

  // 2. Deleta do Firestore
  try {
    const db = getDb();
    const anexosSnap = await getDocs(
      collection(db, 'patrimonio', patrimonioId, 'anexos'),
    );
    const batch = writeBatch(db);
    anexosSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'patrimonio', patrimonioId));

    await withTimeout(batch.commit(), 12000, 'deletePatrimonioItem');
  } catch (err) {
    console.warn('[PatrimonioService] Erro ao deletar no Firestore:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANEXOS DE NOTAS FISCAIS & COMPROVANTES
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchAnexosByPatrimonioId(
  patrimonioId: string,
): Promise<PatrimonioAnexo[]> {
  const localKey = `${STORAGE_KEY_ANEXOS_PREFIX}${patrimonioId}`;

  try {
    const db = getDb();
    const snap = await withTimeout(
      getDocs(collection(db, 'patrimonio', patrimonioId, 'anexos')),
      12000,
      'fetchAnexosByPatrimonioId',
    );

    const anexos = snap.docs.map((d) => ({
      id: d.id,
      patrimonioId,
      ...d.data(),
    })) as PatrimonioAnexo[];

    if (typeof window !== 'undefined' && anexos.length > 0) {
      try {
        window.localStorage.setItem(localKey, JSON.stringify(anexos));
      } catch (e) {}
    }

    return anexos.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  } catch (err) {
    console.warn('[PatrimonioService] Erro ao buscar anexos no Firestore, lendo cache local:', err);
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(localKey);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  }
}

export async function saveAnexoPatrimonio(
  anexo: Omit<PatrimonioAnexo, 'id'> & { id?: string },
): Promise<string> {
  const db = getDb();
  const colRef = collection(db, 'patrimonio', anexo.patrimonioId, 'anexos');
  const now = new Date().toISOString();
  let anexoId = anexo.id;

  try {
    if (anexoId) {
      const ref = doc(db, 'patrimonio', anexo.patrimonioId, 'anexos', anexoId);
      const { id: _, ...data } = anexo;
      await withTimeout(setDoc(ref, data, { merge: true }), 15000, 'saveAnexoPatrimonio.update');
    } else {
      const payload = {
        ...anexo,
        uploadedAt: anexo.uploadedAt || now,
      };
      const ref = await withTimeout(
        addDoc(colRef, payload),
        15000,
        'saveAnexoPatrimonio.add',
      );
      anexoId = ref.id;
    }

    // Atualiza contador no documento pai
    const snap = await getDocs(colRef);
    await updateDoc(doc(db, 'patrimonio', anexo.patrimonioId), {
      anexosCount: snap.docs.length,
      updatedAt: now,
    });
  } catch (err) {
    console.warn('[PatrimonioService] Erro ao gravar anexo no Firestore:', err);
    if (!anexoId) anexoId = `anx_local_${Date.now()}`;
  }

  // Grava no cache local de anexos
  const localKey = `${STORAGE_KEY_ANEXOS_PREFIX}${anexo.patrimonioId}`;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(localKey);
      const list: PatrimonioAnexo[] = raw ? JSON.parse(raw) : [];
      const itemWithId: PatrimonioAnexo = {
        ...anexo,
        id: anexoId!,
        uploadedAt: anexo.uploadedAt || now,
      };
      const updated = [itemWithId, ...list.filter((a) => a.id !== anexoId)];
      window.localStorage.setItem(localKey, JSON.stringify(updated));
    } catch (e) {}
  }

  return anexoId!;
}

export async function deleteAnexoPatrimonio(
  patrimonioId: string,
  anexoId: string,
): Promise<void> {
  const localKey = `${STORAGE_KEY_ANEXOS_PREFIX}${patrimonioId}`;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        const list: PatrimonioAnexo[] = JSON.parse(raw);
        window.localStorage.setItem(
          localKey,
          JSON.stringify(list.filter((a) => a.id !== anexoId)),
        );
      }
    } catch (e) {}
  }

  try {
    const db = getDb();
    await withTimeout(
      deleteDoc(doc(db, 'patrimonio', patrimonioId, 'anexos', anexoId)),
      10000,
      'deleteAnexoPatrimonio',
    );

    const snap = await getDocs(collection(db, 'patrimonio', patrimonioId, 'anexos'));
    await updateDoc(doc(db, 'patrimonio', patrimonioId), {
      anexosCount: snap.docs.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[PatrimonioService] Erro ao excluir anexo do Firestore:', err);
  }
}
