import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAccessToken() {
  try {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('Erro ao obter gcloud token:', err);
    process.exit(1);
  }
}

const token = getAccessToken();
const projectId = 'paris-dakar-gerencial';
const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

function parseFirestoreValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const fields = val.mapValue.fields || {};
    const obj = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  return null;
}

function parseDoc(doc) {
  const nameParts = doc.name.split('/');
  const docId = nameParts[nameParts.length - 1];
  const fields = doc.fields || {};
  const data = { id: docId };
  for (const [k, v] of Object.entries(fields)) {
    data[k] = parseFirestoreValue(v);
  }
  return data;
}

async function fetchAllExtratoDocuments() {
  console.log('Buscando documentos de extrato_financeiro no Firestore...');
  let documents = [];
  let pageToken = '';
  let page = 1;

  do {
    const url = `${baseUrl}/extrato_financeiro?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Erro na REST API (${res.status}): ${text}`);
    }

    const data = await res.json();
    if (data.documents && data.documents.length > 0) {
      const parsedDocs = data.documents.map(parseDoc);
      documents.push(...parsedDocs);
    }

    pageToken = data.nextPageToken || '';
    page++;
  } while (pageToken);

  return documents;
}

async function deleteDocumentRest(docId) {
  const url = `${baseUrl}/extrato_financeiro/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao deletar ${docId} (${res.status}): ${text}`);
  }
}

async function runCleanup() {
  const docs = await fetchAllExtratoDocuments();
  console.log(`Documentos carregados: ${docs.length}`);

  const byDedupeKey = new Map();
  const byContentHash = new Map();
  const idsToDelete = new Set();

  docs.forEach((item) => {
    const entrada = Number(item.valor_entrada || 0);
    const saida = Number(item.valor_saida || 0);

    const key = (item.chave_dedupe || '').toString().trim();
    if (key) {
      if (!byDedupeKey.has(key)) byDedupeKey.set(key, []);
      byDedupeKey.get(key).push(item);
    }

    const dataNorm = (item.data || '').toString().trim();
    const conta = (item.conta_codigo || item.fonte || item.origem || '').toString().trim().toUpperCase();
    const docRef = (item.documento_ref || '').toString().trim().toUpperCase();
    const desc = (item.descricao || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
    const contentKey = `${conta}|${dataNorm}|${entrada.toFixed(2)}|${saida.toFixed(2)}|${docRef}|${desc}`;

    if (!byContentHash.has(contentKey)) byContentHash.set(contentKey, []);
    byContentHash.get(contentKey).push(item);
  });

  // 1. Identificar duplicados por chave_dedupe
  byDedupeKey.forEach((items) => {
    if (items.length > 1) {
      items.sort((a, b) => {
        const aIsDeterministic = a.id.startsWith('stmt_');
        const bIsDeterministic = b.id.startsWith('stmt_');
        if (aIsDeterministic && !bIsDeterministic) return -1;
        if (!aIsDeterministic && bIsDeterministic) return 1;
        return 0;
      });
      const dupItems = items.slice(1);
      dupItems.forEach((it) => idsToDelete.add(it.id));
    }
  });

  // 2. Identificar duplicados adicionais por conteúdo idêntico
  byContentHash.forEach((items) => {
    if (items.length > 1) {
      items.sort((a, b) => {
        const aIsDeterministic = a.id.startsWith('stmt_');
        const bIsDeterministic = b.id.startsWith('stmt_');
        if (aIsDeterministic && !bIsDeterministic) return -1;
        if (!aIsDeterministic && bIsDeterministic) return 1;
        return 0;
      });

      // Filtra itens que já foram marcados para deleção
      const remaining = items.filter((it) => !idsToDelete.has(it.id));
      if (remaining.length > 1) {
        const dupItems = remaining.slice(1);
        dupItems.forEach((it) => idsToDelete.add(it.id));
      }
    }
  });

  const listToDelete = Array.from(idsToDelete);
  console.log(`\n=== INICIANDO HIGIENIZAÇÃO: DELETANDO ${listToDelete.length} DOCUMENTOS DUPLICADOS ===\n`);

  let deletedCount = 0;
  let errorCount = 0;

  // Deleta em lotes concorrentes para alta performance
  const CONCURRENCY = 20;
  for (let i = 0; i < listToDelete.length; i += CONCURRENCY) {
    const batch = listToDelete.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (docId) => {
        try {
          await deleteDocumentRest(docId);
          deletedCount++;
        } catch (err) {
          console.error(`Falha ao deletar ${docId}:`, err.message);
          errorCount++;
        }
      })
    );

    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= listToDelete.length) {
      console.log(`Progresso: ${Math.min(i + CONCURRENCY, listToDelete.length)} / ${listToDelete.length} excluídos...`);
    }
  }

  console.log('\n======================================================');
  console.log(`✅ LIMPEZA CONCLUÍDA COM SUCESSO!`);
  console.log(`   - Documentos Excluídos: ${deletedCount}`);
  console.log(`   - Erros de Exclusão:    ${errorCount}`);
  console.log('======================================================\n');
}

runCleanup().catch((e) => {
  console.error('Erro na higienização:', e);
  process.exit(1);
});
