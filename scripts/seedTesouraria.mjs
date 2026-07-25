/**
 * seedTesouraria.mjs — Grava os extratos RFN019 (Caixa 30108 e Tesouraria
 * 30101) direto no Firestore, sem precisar importar pela tela.
 *
 * COMO RODAR (na pasta do projeto):
 *     node scripts/seedTesouraria.mjs
 *
 * Opções:
 *     --dry        só mostra o que faria, não grava nada
 *     --year=2026  grava apenas um ano
 *
 * SEGURANÇA CONTRA DUPLICIDADE
 * ----------------------------
 * O ID de cada documento é derivado da MESMA chave que a tela de importação
 * usa (src/utils/statementKeys.ts → statementDocId). Consequências práticas:
 *   - rodar este script duas vezes não duplica nada, apenas regrava por cima;
 *   - importar depois a mesma planilha pela tela também não duplica, porque a
 *     chave cai no mesmo documento;
 *   - a ordem entre script e tela é irrelevante.
 * Isso é conferido por scripts/testRfn019Parser.mjs, que roda o parser da tela
 * contra os .xlsx originais e compara campo a campo com o seed daqui.
 *
 * As transferências internas (caixa ↔ tesouraria) são gravadas marcadas com
 * `transferencia_interna: true`. Elas precisam existir para o extrato fechar
 * com o saldo da conta, mas o app as exclui do cálculo de Entradas — ver
 * comentário em App.tsx/recomputeFinancialFromStatement.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import { initializeApp } from 'firebase/app';
import { getFirestore, writeBatch, doc, collection, getDocs, query, where } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Carrega a regra de chave do TypeScript, sem duplicá-la aqui ────────────
const loadTs = (relPath) => {
  const abs = resolve(root, relPath);
  const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m._compile(js, abs);
  return m.exports;
};
const { statementDocId } = loadTs('src/utils/statementKeys.ts');

// ── Config do Firebase (mesma do app, lida do .env) ────────────────────────
const readEnv = () => {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    console.error('Não encontrei o arquivo .env na raiz do projeto.');
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

if (!firebaseConfig.projectId) {
  console.error('VITE_FIREBASE_PROJECT_ID ausente no .env.');
  process.exit(1);
}

// ── Argumentos ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const yearArg = args.find((a) => a.startsWith('--year='));
const onlyYear = yearArg ? parseInt(yearArg.split('=')[1], 10) : null;

// ── Dados ──────────────────────────────────────────────────────────────────
let seed = JSON.parse(readFileSync(resolve(root, 'scripts/data/rfn019Seed.json'), 'utf8'));
if (onlyYear) seed = seed.filter((e) => e.year === onlyYear);

const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const sum = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);

const real = seed.filter((e) => !e.isInternalTransfer);
const transf = seed.filter((e) => e.isInternalTransfer);

console.log('\n═══ SEED DO EXTRATO DE CAIXA/TESOURARIA (RFN019) ═══');
console.log(`Projeto Firebase : ${firebaseConfig.projectId}`);
console.log(`Lançamentos      : ${seed.length}${onlyYear ? ` (filtrado: ${onlyYear})` : ''}`);
for (const acc of ['30108', '30101']) {
  const rows = seed.filter((e) => e.accountCode === acc);
  if (!rows.length) continue;
  console.log(`  ${rows[0].accountLabel.padEnd(20)} ${String(rows.length).padStart(5)} lançamentos`);
}
console.log(`\nMovimento REAL      : entradas ${money(sum(real, 'entryAmount'))} | saídas ${money(sum(real, 'exitAmount'))}`);
console.log(`Transferência interna: ${transf.length} lançamentos, ${money(sum(transf, 'entryAmount') + sum(transf, 'exitAmount'))}`);
console.log('  (gravadas e marcadas; NÃO entram como Entradas no Resultado Financeiro)');

const anos = [...new Set(seed.map((e) => e.year))].sort();
console.log(`Anos                : ${anos.join(', ')}`);

if (dryRun) {
  console.log('\n--dry: nada foi gravado.');
  console.log('Exemplo de documento que seria criado:');
  const s = seed[0];
  console.log(`  id   = ${statementDocId(s.dedupeKey)}`);
  console.log(`  data = ${s.date} | ${s.description.slice(0, 60)}`);
  console.log(`  saída= ${money(s.exitAmount)} | entrada = ${money(s.entryAmount)}`);
  process.exit(0);
}

// ── Gravação ───────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const COLLECTION = 'extrato_financeiro';

const toFirestore = (e) => ({
  origem: e.origin,
  fonte: e.source,
  fonte_label: e.sourceLabel,
  data: e.date,
  ano: e.year,
  mes_chave: e.monthKey,
  descricao: e.description,
  cliente_beneficiario: e.clientName || '',
  tipo_documento: e.documentType || '',
  documento_ref: e.documentRef || '',
  valor_entrada: e.entryAmount,
  valor_saida: e.exitAmount,
  observacoes: e.notes || '',
  chave_dedupe: e.dedupeKey,
  conta_codigo: e.accountCode,
  conta_label: e.accountLabel,
  conta_gerencial: e.managementAccount || '',
  transferencia_interna: !!e.isInternalTransfer,
  importado_em: new Date().toISOString(),
});

const run = async () => {
  // Limpa lançamentos antigos das MESMAS contas que tenham sido gravados com
  // ID aleatório numa importação anterior pela tela. Sem isso, o mesmo
  // movimento existiria duas vezes: no documento antigo e no determinístico.
  console.log('\nProcurando lançamentos anteriores destas contas...');
  const legacy = [];
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where('fonte', '==', 'tesouraria')));
    const validIds = new Set(seed.map((e) => statementDocId(e.dedupeKey)));
    snap.forEach((d) => {
      if (!validIds.has(d.id)) legacy.push(d.id);
    });
  } catch (err) {
    console.warn('  (não foi possível varrer os anteriores:', err.message, ')');
  }
  console.log(`  ${legacy.length} lançamento(s) antigo(s) de tesouraria com ID aleatório serão removidos.`);

  const CHUNK = 400;
  let written = 0;

  for (let i = 0; i < legacy.length; i += CHUNK) {
    const batch = writeBatch(db);
    legacy.slice(i, i + CHUNK).forEach((id) => batch.delete(doc(db, COLLECTION, id)));
    await batch.commit();
  }

  console.log('\nGravando...');
  for (let i = 0; i < seed.length; i += CHUNK) {
    const chunk = seed.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const e of chunk) {
      batch.set(doc(db, COLLECTION, statementDocId(e.dedupeKey)), toFirestore(e), { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\r  ${written}/${seed.length} lançamentos (${Math.round((written / seed.length) * 100)}%)`);
  }

  console.log('\n\n✓ Concluído.');
  console.log('  Abra o sistema em Extrato Financeiro para conferir.');
  console.log('  O Resultado Financeiro é recalculado ao abrir a tela.');
  process.exit(0);
};

run().catch((err) => {
  console.error('\nErro ao gravar:', err.message);
  process.exit(1);
});
