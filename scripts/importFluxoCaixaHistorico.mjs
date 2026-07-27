/**
 * importFluxoCaixaHistorico.mjs — Grava direto no Firestore os planos mensais
 * de Fluxo de Caixa extraídos da planilha legada "FLUXO DE CAIXA (1).xlsx".
 *
 * COMO RODAR (na pasta do projeto):
 *     node scripts/importFluxoCaixaHistorico.mjs "<caminho.xlsx>" --dry
 *     node scripts/importFluxoCaixaHistorico.mjs "<caminho.xlsx>"
 *
 * Opções:
 *     --dry              só mostra o que gravaria, não grava nada
 *     --ano-inicial=2025 ano do primeiro bloco da planilha (mês "MARÇO");
 *                        a planilha não guarda o ano, então isto TEM que ser
 *                        conferido antes de rodar sem --dry (padrão: 2025)
 *
 * O QUE ISTO SOBRESCREVE
 * -----------------------------------------------------------------------
 * Para cada mês encontrado no arquivo, grava (merge) em `fluxo_caixa/{ano}_
 * {mes}`: saldoInicial, as 5 semanas (previsto e realizado digitado de
 * Recebimentos/Desembolsos/Aportes) e a lista de pendências — exatamente os
 * campos que a tela de Fluxo de Caixa edita. `realizadoManual` é sempre
 * gravado como true, pois a partir desta versão do app o REALIZADO é sempre
 * o valor digitado (ver CashFlowView.tsx). NÃO mexe em nenhum outro mês nem
 * em nenhuma outra coleção.
 *
 * DOC ID DETERMINÍSTICO = MESMO QUE O APP USA
 * -----------------------------------------------------------------------
 * `${ano}_${mesChave}` é o mesmo id que `saveCashFlowPlan` grava quando o
 * gestor salva pela tela. Rodar este script duas vezes não duplica nada,
 * apenas regrava por cima — e se o gestor já tiver editado um desses meses
 * pela tela, rodar de novo restaura os números da planilha (é isso que foi
 * pedido: "replicar perfeitamente" o que está na planilha).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, writeBatch, doc, getDoc } from 'firebase/firestore';
import { extractFluxoCaixaHistorico } from './lib/fluxoCaixaHistoricoParser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Argumentos ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry');
const anoArg = args.find((a) => a.startsWith('--ano-inicial='));
const anoInicial = anoArg ? parseInt(anoArg.split('=')[1], 10) : 2025;

if (!file) {
  console.error('Uso: node scripts/importFluxoCaixaHistorico.mjs "<caminho.xlsx>" [--dry] [--ano-inicial=2025]');
  process.exit(1);
}

// ── Config do Firebase (mesma do app, lida do .env) ───────────────────────
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

// ── Extração ───────────────────────────────────────────────────────────────
let plans;
try {
  plans = extractFluxoCaixaHistorico(file, anoInicial);
} catch (err) {
  console.error('Erro ao ler a planilha:', err.message);
  process.exit(1);
}

const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const WEEKS = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];
const sumWeeks = (p, field) => WEEKS.reduce((a, w) => a + (p.weeks[w][field] || 0), 0);

console.log('\n═══ IMPORTAÇÃO DO HISTÓRICO DE FLUXO DE CAIXA ═══');
console.log(`Projeto Firebase : ${firebaseConfig.projectId}`);
console.log(`Arquivo          : ${file}`);
console.log(`Meses encontrados: ${plans.length} (ano inicial assumido: ${anoInicial})\n`);

for (const p of plans) {
  const pend = p.pendencias.reduce((a, x) => a + x.valor, 0);
  console.log(
    `  ${p.year}-${p.monthKey.padEnd(3)} (${p.monthLabel.padEnd(9)}) ` +
      `saldoIni ${money(p.saldoInicial).padStart(14)}  ` +
      `receb.prev ${money(sumWeeks(p, 'recebimentos')).padStart(14)}  ` +
      `receb.real ${money(sumWeeks(p, 'recebRealizado')).padStart(14)}  ` +
      `pendências ${String(p.pendencias.length).padStart(2)} (${money(pend)})`
  );
}

if (dryRun) {
  console.log('\n--dry: nada foi gravado. Confira os números acima contra a planilha antes de rodar sem --dry.');
  process.exit(0);
}

// ── Gravação ───────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const COLLECTION = 'fluxo_caixa';

const toFirestore = (p) => ({
  ano: p.year,
  mes: p.monthKey,
  saldo_inicial: p.saldoInicial,
  saldo_automatico: false,
  realizado_manual: true,
  semanas: p.weeks,
  pendencias: p.pendencias,
  observacoes: `Importado de "FLUXO DE CAIXA (1).xlsx" em ${new Date().toISOString()}`,
  atualizado_em: new Date().toISOString(),
});

const run = async () => {
  console.log('\nConferindo o que já existe em cada mês antes de sobrescrever...');
  let jaExistiam = 0;
  for (const p of plans) {
    const snap = await getDoc(doc(db, COLLECTION, p.id));
    if (snap.exists()) jaExistiam++;
  }
  console.log(`  ${jaExistiam}/${plans.length} já existiam no banco e serão SOBRESCRITOS com os dados da planilha.`);
  console.log(`  ${plans.length - jaExistiam}/${plans.length} são novos.`);

  console.log('\nGravando...');
  const batch = writeBatch(db);
  for (const p of plans) {
    batch.set(doc(db, COLLECTION, p.id), toFirestore(p), { merge: true });
  }
  await batch.commit();

  console.log(`\n✓ ${plans.length} mês(es) gravado(s) em "${COLLECTION}".`);
  console.log('  Abra o sistema em Fluxo de Caixa (troque o ano/mês) para conferir.');
  process.exit(0);
};

run().catch((err) => {
  console.error('\nErro ao gravar:', err.message);
  process.exit(1);
});
