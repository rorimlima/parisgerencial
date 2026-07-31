import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc, writeBatch } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const readEnv = () => {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch (err) {
    console.error('Erro ao ler .env:', err);
    process.exit(1);
  }
  return out;
};

const env = readEnv();
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const executeAudit = async () => {
  console.log('=== AUDITORIA SÊNIOR DE DUPLICIDADES NO EXTRATO FINANCEIRO ===\n');
  const snap = await getDocs(collection(db, 'extrato_financeiro'));
  console.log(`Total de documentos encontrados no Firestore: ${snap.size}`);

  const docs = [];
  snap.forEach((d) => {
    docs.push({ id: d.id, ...d.data() });
  });

  // 1. Agrupamento por ID do Documento vs dedupeKey
  const byDedupeKey = new Map();
  const byContentHash = new Map();

  let totalEntradas = 0;
  let totalSaidas = 0;

  docs.forEach((item) => {
    const entrada = Number(item.valor_entrada || 0);
    const saida = Number(item.valor_saida || 0);
    totalEntradas += entrada;
    totalSaidas += saida;

    // Chave de deduplicação explícita
    const key = (item.chave_dedupe || '').toString().trim();
    if (key) {
      if (!byDedupeKey.has(key)) byDedupeKey.set(key, []);
      byDedupeKey.get(key).push(item);
    }

    // Chave de conteúdo (independente se tem chave_dedupe ou não)
    // normalizando data, conta, documento, valor entrada e saída
    const dataNorm = (item.data || '').toString().trim();
    const conta = (item.conta_codigo || item.fonte || item.origem || '').toString().trim().toUpperCase();
    const docRef = (item.documento_ref || '').toString().trim().toUpperCase();
    const desc = (item.descricao || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
    const contentKey = `${conta}|${dataNorm}|${entrada.toFixed(2)}|${saida.toFixed(2)}|${docRef}|${desc}`;

    if (!byContentHash.has(contentKey)) byContentHash.set(contentKey, []);
    byContentHash.get(contentKey).push(item);
  });

  console.log(`\nSoma Total do Extrato no Firestore:`);
  console.log(`  - Entradas: R$ ${totalEntradas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  console.log(`  - Saídas:   R$ ${totalSaidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  console.log(`  - Resultado: R$ ${(totalEntradas - totalSaidas).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

  // Análise de Duplicidades por dedupeKey
  const duplicateKeys = [];
  let dupCountKey = 0;
  let dupEntradasKey = 0;
  let dupSaidasKey = 0;

  byDedupeKey.forEach((items, key) => {
    if (items.length > 1) {
      duplicateKeys.push({ key, items });
      const dupItems = items.slice(1);
      dupCountKey += dupItems.length;
      dupItems.forEach((it) => {
        dupEntradasKey += Number(it.valor_entrada || 0);
        dupSaidasKey += Number(it.valor_saida || 0);
      });
    }
  });

  console.log(`\n--- DUP 1: Duplicidades por 'chave_dedupe' ---`);
  console.log(`  - Chaves duplicadas: ${duplicateKeys.length}`);
  console.log(`  - Registros excedentes: ${dupCountKey}`);
  console.log(`  - Entradas duplicadas acumuladas: R$ ${dupEntradasKey.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  console.log(`  - Saídas duplicadas acumuladas:   R$ ${dupSaidasKey.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

  // Análise de Duplicidades por Conteúdo Idêntico
  const duplicateContents = [];
  let dupCountContent = 0;
  let dupEntradasContent = 0;
  let dupSaidasContent = 0;

  byContentHash.forEach((items, contentKey) => {
    if (items.length > 1) {
      duplicateContents.push({ contentKey, items });
      const dupItems = items.slice(1);
      dupCountContent += dupItems.length;
      dupItems.forEach((it) => {
        dupEntradasContent += Number(it.valor_entrada || 0);
        dupSaidasContent += Number(it.valor_saida || 0);
      });
    }
  });

  console.log(`\n--- DUP 2: Duplicidades por Conteúdo Idêntico (Conta + Data + Entrada + Saída + Doc + Descrição) ---`);
  console.log(`  - Grupos idênticos: ${duplicateContents.length}`);
  console.log(`  - Registros excedentes: ${dupCountContent}`);
  console.log(`  - Entradas duplicadas acumuladas: R$ ${dupEntradasContent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  console.log(`  - Saídas duplicadas acumuladas:   R$ ${dupSaidasContent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

  // Exemplo de amostras de duplicidade se existirem
  if (duplicateKeys.length > 0) {
    console.log('\nAmostra de 5 chaves duplicadas:');
    duplicateKeys.slice(0, 5).forEach(({ key, items }) => {
      console.log(`\nChave: ${key} (${items.length} cópias)`);
      items.forEach((it) => {
        console.log(`  -> ID: ${it.id} | Data: ${it.data} | Fonte: ${it.fonte} | Desc: ${it.descricao?.slice(0, 40)} | Ent: ${it.valor_entrada} | Sai: ${it.valor_saida}`);
      });
    });
  } else if (duplicateContents.length > 0) {
    console.log('\nAmostra de 5 grupos com conteúdo idêntico:');
    duplicateContents.slice(0, 5).forEach(({ contentKey, items }) => {
      console.log(`\nConteúdo: ${contentKey.slice(0, 80)} (${items.length} cópias)`);
      items.forEach((it) => {
        console.log(`  -> ID: ${it.id} | ChaveDedupe: ${it.chave_dedupe} | Data: ${it.data} | Fonte: ${it.fonte}`);
      });
    });
  }

  process.exit(0);
};

executeAudit().catch((e) => {
  console.error(e);
  process.exit(1);
});
