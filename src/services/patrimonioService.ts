/**
 * patrimonioService.ts — CRUD Firestore para Tombamento de Loja, Patrimônio e Anexos de Notas Fiscais
 *
 * Collections:
 *   patrimonio/{patrimonioId}
 *   patrimonio/{patrimonioId}/anexos/{anexoId}
 */

import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  orderBy,
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import type { PatrimonioItem, PatrimonioAnexo } from '../types';

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

// ═══════════════════════════════════════════════════════════════════════════
//  PATRIMÔNIO / TOMBAMENTO (ITENS)
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchPatrimonioItems(): Promise<PatrimonioItem[]> {
  const db = getDb();
  const snap = await withTimeout(
    getDocs(collection(db, 'patrimonio')),
    15000,
    'fetchPatrimonioItems',
  );

  const items: PatrimonioItem[] = snap.docs.map((d) => {
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

  // Ordena por data mais recente ou código tombo
  return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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

  if (item.id) {
    const ref = doc(db, 'patrimonio', item.id);
    const { id: _, ...dataWithoutId } = payload;
    await withTimeout(
      setDoc(ref, dataWithoutId, { merge: true }),
      12000,
      'savePatrimonioItem.update',
    );
    return item.id;
  }

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
  return ref.id;
}

export async function deletePatrimonioItem(patrimonioId: string): Promise<void> {
  const db = getDb();
  // Deleta subcoleção de anexos vinculados em batch
  const anexosSnap = await getDocs(
    collection(db, 'patrimonio', patrimonioId, 'anexos'),
  );
  const batch = writeBatch(db);
  anexosSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'patrimonio', patrimonioId));

  await withTimeout(batch.commit(), 15000, 'deletePatrimonioItem');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANEXOS DE NOTAS FISCAIS & COMPROVANTES
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchAnexosByPatrimonioId(
  patrimonioId: string,
): Promise<PatrimonioAnexo[]> {
  const db = getDb();
  const snap = await withTimeout(
    getDocs(collection(db, 'patrimonio', patrimonioId, 'anexos')),
    15000,
    'fetchAnexosByPatrimonioId',
  );

  const anexos = snap.docs.map((d) => ({
    id: d.id,
    patrimonioId,
    ...d.data(),
  })) as PatrimonioAnexo[];

  return anexos.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

export async function saveAnexoPatrimonio(
  anexo: Omit<PatrimonioAnexo, 'id'> & { id?: string },
): Promise<string> {
  const db = getDb();
  const colRef = collection(db, 'patrimonio', anexo.patrimonioId, 'anexos');
  const now = new Date().toISOString();

  let anexoId = anexo.id;

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
  try {
    const snap = await getDocs(colRef);
    await updateDoc(doc(db, 'patrimonio', anexo.patrimonioId), {
      anexosCount: snap.docs.length,
      updatedAt: now,
    });
  } catch (err) {
    console.warn('Erro ao atualizar anexosCount no pai:', err);
  }

  return anexoId;
}

export async function deleteAnexoPatrimonio(
  patrimonioId: string,
  anexoId: string,
): Promise<void> {
  const db = getDb();
  await withTimeout(
    deleteDoc(doc(db, 'patrimonio', patrimonioId, 'anexos', anexoId)),
    10000,
    'deleteAnexoPatrimonio',
  );

  // Atualiza contador no documento pai
  try {
    const snap = await getDocs(collection(db, 'patrimonio', patrimonioId, 'anexos'));
    await updateDoc(doc(db, 'patrimonio', patrimonioId), {
      anexosCount: snap.docs.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Erro ao atualizar anexosCount no pai após exclusão:', err);
  }
}
