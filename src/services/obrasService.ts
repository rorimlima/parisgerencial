/**
 * obrasService.ts — CRUD Firestore para Obras, Funcionários e Registro de Ponto
 *
 * Collections:
 *   obras/{obraId}
 *   obras/{obraId}/funcionarios/{funcId}
 *   obras/{obraId}/registrosPonto/{regId}
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
import type { Obra, FuncionarioObra, RegistroPonto } from '../types';

// ── Firestore Instance ─────────────────────────────────────────────────────

function getDb() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// ── Timeout helper (same pattern as other services) ─────────────────────────

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tempo limite excedido (${Math.round(ms / 1000)}s) em: ${label}`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
};

// ═══════════════════════════════════════════════════════════════════════════
//  OBRAS
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchObras(): Promise<Obra[]> {
  const db = getDb();
  const snap = await withTimeout(getDocs(collection(db, 'obras')), 15000, 'fetchObras');
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Obra));
}

export async function saveObra(obra: Omit<Obra, 'id'> & { id?: string }): Promise<string> {
  const db = getDb();
  if (obra.id) {
    const ref = doc(db, 'obras', obra.id);
    const { id: _, ...data } = obra as Obra;
    await withTimeout(setDoc(ref, data, { merge: true }), 10000, 'saveObra.update');
    return obra.id;
  }
  const ref = await withTimeout(
    addDoc(collection(db, 'obras'), { ...obra, createdAt: new Date().toISOString() }),
    10000,
    'saveObra.add',
  );
  return ref.id;
}

export async function deleteObra(obraId: string): Promise<void> {
  const db = getDb();
  // Deleta funcionários e registros em batch
  const funcSnap = await getDocs(collection(db, 'obras', obraId, 'funcionarios'));
  const regSnap = await getDocs(collection(db, 'obras', obraId, 'registrosPonto'));
  const batch = writeBatch(db);
  funcSnap.docs.forEach((d) => batch.delete(d.ref));
  regSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'obras', obraId));
  await withTimeout(batch.commit(), 15000, 'deleteObra');
}

// ═══════════════════════════════════════════════════════════════════════════
//  FUNCIONÁRIOS
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchFuncionarios(obraId: string): Promise<FuncionarioObra[]> {
  const db = getDb();
  const snap = await withTimeout(
    getDocs(collection(db, 'obras', obraId, 'funcionarios')),
    15000,
    'fetchFuncionarios',
  );
  return snap.docs.map((d) => ({ id: d.id, obraId, ...d.data() } as FuncionarioObra));
}

export async function saveFuncionario(
  func: Omit<FuncionarioObra, 'id'> & { id?: string },
): Promise<string> {
  const db = getDb();
  const colRef = collection(db, 'obras', func.obraId, 'funcionarios');
  if (func.id) {
    const ref = doc(db, 'obras', func.obraId, 'funcionarios', func.id);
    const { id: _, ...data } = func as FuncionarioObra;
    await withTimeout(setDoc(ref, data, { merge: true }), 10000, 'saveFuncionario.update');
    return func.id;
  }
  const ref = await withTimeout(addDoc(colRef, { ...func }), 10000, 'saveFuncionario.add');
  return ref.id;
}

export async function deleteFuncionario(obraId: string, funcId: string): Promise<void> {
  const db = getDb();
  // Deleta registros de ponto desse funcionário
  const regSnap = await getDocs(
    query(collection(db, 'obras', obraId, 'registrosPonto'), where('funcionarioId', '==', funcId)),
  );
  const batch = writeBatch(db);
  regSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'obras', obraId, 'funcionarios', funcId));
  await withTimeout(batch.commit(), 10000, 'deleteFuncionario');
}

// ═══════════════════════════════════════════════════════════════════════════
//  REGISTRO DE PONTO
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchRegistrosPonto(
  obraId: string,
  mes: number,
  ano: number,
): Promise<RegistroPonto[]> {
  const db = getDb();
  // Filtra por range de datas do mês
  const startDate = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const endMonth = mes === 12 ? 1 : mes + 1;
  const endYear = mes === 12 ? ano + 1 : ano;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const snap = await withTimeout(
    getDocs(
      query(
        collection(db, 'obras', obraId, 'registrosPonto'),
        where('data', '>=', startDate),
        where('data', '<', endDate),
      ),
    ),
    15000,
    'fetchRegistrosPonto',
  );
  return snap.docs.map((d) => ({ id: d.id, obraId, ...d.data() } as RegistroPonto));
}

export async function saveRegistroPonto(registro: Omit<RegistroPonto, 'id'> & { id?: string }): Promise<string> {
  const db = getDb();
  const colRef = collection(db, 'obras', registro.obraId, 'registrosPonto');
  // Usa ID determinístico: funcId_data para evitar duplicatas
  const determinísticoId = `${registro.funcionarioId}_${registro.data}`;
  const ref = doc(db, 'obras', registro.obraId, 'registrosPonto', determinísticoId);
  const { id: _, ...data } = registro as RegistroPonto;
  await withTimeout(setDoc(ref, data, { merge: true }), 10000, 'saveRegistroPonto');
  return determinísticoId;
}

export async function saveRegistrosPontoBatch(registros: (Omit<RegistroPonto, 'id'> & { id?: string })[]): Promise<void> {
  if (!registros.length) return;
  const db = getDb();
  // Firestore batch limit = 500
  const chunks: typeof registros[] = [];
  for (let i = 0; i < registros.length; i += 450) {
    chunks.push(registros.slice(i, i + 450));
  }
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const reg of chunk) {
      const detId = `${reg.funcionarioId}_${reg.data}`;
      const ref = doc(db, 'obras', reg.obraId, 'registrosPonto', detId);
      const { id: _, ...data } = reg as RegistroPonto;
      batch.set(ref, data, { merge: true });
    }
    await withTimeout(batch.commit(), 20000, 'saveRegistrosPontoBatch');
  }
}

export async function deleteRegistroPonto(obraId: string, regId: string): Promise<void> {
  const db = getDb();
  await withTimeout(deleteDoc(doc(db, 'obras', obraId, 'registrosPonto', regId)), 10000, 'deleteRegistroPonto');
}
