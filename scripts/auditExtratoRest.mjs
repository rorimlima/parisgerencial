import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
  console.log('Buscando documentos de extrato_financeiro via Firestore REST API...');
  let documents = [];
  let pageToken = '';
  let page = 1;

  do {
    const url = `${baseUrl}/extrato_financeiro?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Erro na REST API (${res.status}): ${text}`);
    }

    const data = await res.json();
    if (data.documents && data.documents.length > 0) {
      const parsedDocs = data.documents.map(parseDoc);
      documents.push(...parsedDocs);
      console.log(`Página ${page}: +${parsedDocs.length} docs (Total acumulado: ${documents.length})`);
    }

    pageToken = data.nextPageToken || '';
    page++;
  } while (pageToken);

  return documents;
}

async function runAudit() {
  const docs = await fetchAllExtratoDocuments();
  console.log(`\n=== AUDITORIA FINANCEIRA SÊNIOR — EXTRATO FINANCEIRO (${docs.length} registros) ===\n`);

  let totalEntradas = 0;
  let totalSaidas = 0;

  const byYear = {};
  const byFonte = {};
  const byDedupeKey = new Map();
  const byContentHash = new Map();

  docs.forEach((item) => {
    const entrada = Number(item.valor_entrada || 0);
    const saida = Number(item.valor_saida || 0);
    totalEntradas += entrada;
    totalSaidas += saida;

    const ano = item.ano || 'sem_ano';
    if (!byYear[ano]) byYear[ano] = { count: 0, entradas: 0, saidas: 0 };
    byYear[ano].count++;
    byYear[ano].entradas += entrada;
    byYear[ano].saidas += saida;

    const fonte = item.fonte || item.origem || 'outros';
    if (!byFonte[fonte]) byFonte[fonte] = { count: 0, entradas: 0, saidas: 0 };
    byFonte[fonte].count++;
    byFonte[fonte].entradas += entrada;
    byFonte[fonte].saidas += saida;

    // Chave de deduplicação explícita
    const key = (item.chave_dedupe || '').toString().trim();
    if (key) {
      if (!byDedupeKey.has(key)) byDedupeKey.set(key, []);
      byDedupeKey.get(key).push(item);
    }

    // Chave de conteúdo (independente de ter chave_dedupe ou não)
    const dataNorm = (item.data || '').toString().trim();
    const conta = (item.conta_codigo || item.fonte || item.origem || '').toString().trim().toUpperCase();
    const docRef = (item.documento_ref || '').toString().trim().toUpperCase();
    const desc = (item.descricao || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
    const contentKey = `${conta}|${dataNorm}|${entrada.toFixed(2)}|${saida.toFixed(2)}|${docRef}|${desc}`;

    if (!byContentHash.has(contentKey)) byContentHash.set(contentKey, []);
    byContentHash.get(contentKey).push(item);
  });

  const money = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  console.log('📊 RESUMO DE VALORES TOTAIS DA BASE DE EXTRATO:');
  console.log(`   - Total Entradas: ${money(totalEntradas)}`);
  console.log(`   - Total Saídas:   ${money(totalSaidas)}`);
  console.log(`   - Saldo Geral:    ${money(totalEntradas - totalSaidas)}`);

  console.log('\n📅 DISTRIBUIÇÃO POR ANO:');
  Object.keys(byYear).sort().forEach((yr) => {
    const y = byYear[yr];
    console.log(`   - Ano ${yr}: ${y.count} lancts | Entradas: ${money(y.entradas)} | Saídas: ${money(y.saidas)} | Liquido: ${money(y.entradas - y.saidas)}`);
  });

  console.log('\n🏦 DISTRIBUIÇÃO POR FONTE:');
  Object.keys(byFonte).sort().forEach((f) => {
    const fn = byFonte[f];
    console.log(`   - ${fn.count} lancts [${f}] | Entradas: ${money(fn.entradas)} | Saídas: ${money(fn.saidas)}`);
  });

  // DUPLICIDADES POR chave_dedupe
  const dupKeys = [];
  let dupKeyExcedenteCount = 0;
  let dupKeyEntradasSum = 0;
  let dupKeySaidasSum = 0;
  const idsToDelete = new Set();

  byDedupeKey.forEach((items, key) => {
    if (items.length > 1) {
      dupKeys.push({ key, items });
      // Ordena de modo que os documentos que possuem ID determinístico (com a chave ou prefixo da chave) fiquem em PRIMEIRO lugar,
      // e os IDs aleatórios legados fiquem em SEGUNDO lugar para serem apagados.
      items.sort((a, b) => {
        // Se a.id tem o tamanho determinístico ou bate com a chave, fica primeiro
        const aIsDeterministic = a.id.startsWith('stmt_') || a.id === key;
        const bIsDeterministic = b.id.startsWith('stmt_') || b.id === key;
        if (aIsDeterministic && !bIsDeterministic) return -1;
        if (!aIsDeterministic && bIsDeterministic) return 1;
        return 0;
      });

      const masterItem = items[0];
      const dupItems = items.slice(1);
      dupKeyExcedenteCount += dupItems.length;
      dupItems.forEach((it) => {
        idsToDelete.add(it.id);
        dupKeyEntradasSum += Number(it.valor_entrada || 0);
        dupKeySaidasSum += Number(it.valor_saida || 0);
      });
    }
  });

  console.log(`\n🔍 1. ANÁLISE DE DUPLICIDADES POR CHAVE DE DEDUPLICAÇÃO (chave_dedupe):`);
  console.log(`   - Chaves com registros duplicados: ${dupKeys.length}`);
  console.log(`   - Registros duplicados a remover:  ${dupKeyExcedenteCount}`);
  console.log(`   - Impacto nas Entradas duplicadas: ${money(dupKeyEntradasSum)}`);
  console.log(`   - Impacto nas Saídas duplicadas:   ${money(dupKeySaidasSum)}`);

  // DUPLICIDADES POR Conteúdo (Conta + Data + Valor Entrada + Valor Saída + Doc + Descrição)
  const dupContents = [];
  let dupContentExcedenteCount = 0;
  let dupContentEntradasSum = 0;
  let dupContentSaidasSum = 0;

  byContentHash.forEach((items, contentKey) => {
    if (items.length > 1) {
      dupContents.push({ contentKey, items });
      const dupItems = items.slice(1);
      dupContentExcedenteCount += dupItems.length;
      dupItems.forEach((it) => {
        if (!idsToDelete.has(it.id)) {
          dupContentEntradasSum += Number(it.valor_entrada || 0);
          dupContentSaidasSum += Number(it.valor_saida || 0);
        }
      });
    }
  });

  console.log(`\n🔍 2. ANÁLISE DE DUPLICIDADES POR CONTEÚDO IDÊNTICO:`);
  console.log(`   - Grupos idênticos encontrados:    ${dupContents.length}`);
  console.log(`   - Registros duplicados a remover:  ${dupContentExcedenteCount}`);
  console.log(`   - Impacto nas Entradas duplicadas (adicionais): ${money(dupContentEntradasSum)}`);
  console.log(`   - Impacto nas Saídas duplicadas (adicionais):   ${money(dupContentSaidasSum)}`);

  if (dupKeys.length > 0) {
    console.log('\n--- DETALHAMENTO DE AMOSTRA DE DUPLICIDADES POR CHAVE ---');
    dupKeys.slice(0, 5).forEach(({ key, items }, i) => {
      console.log(`\nGrupo #${i + 1} | Chave: ${key} (${items.length} cópias)`);
      items.forEach((it, idx) => {
        const isKeep = idx === 0;
        console.log(`   ${isKeep ? '[MANTER]' : '[APAGAR]'} ID: ${it.id.padEnd(35)} | Ano: ${it.ano} | Data: ${it.data} | Ent: ${it.valor_entrada} | Sai: ${it.valor_saida} | Desc: ${it.descricao?.slice(0, 35)}`);
      });
    });
  }

  // Guardar diagnóstico em arquivo de log para análise
  const diagnostic = {
    totalDocs: docs.length,
    dupKeysCount: dupKeys.length,
    dupKeyExcedenteCount,
    dupKeyEntradasSum,
    dupKeySaidasSum,
    idsToDeleteCount: idsToDelete.size,
    idsToDeleteList: Array.from(idsToDelete),
  };

  writeFileSync(resolve(__dirname, 'audit_report.json'), JSON.stringify(diagnostic, null, 2));
  console.log(`\nRelatório salvo em scripts/audit_report.json com ${idsToDelete.size} IDs identificados para limpeza.`);
}

runAudit().catch((e) => {
  console.error(e);
  process.exit(1);
});
