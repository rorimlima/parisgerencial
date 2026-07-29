/**
 * importExtratoGeral.mjs — SUBSTITUI o Extrato Financeiro pelo EXTRATO GERAL e
 * refaz, a partir dele, as baixas dos títulos e o Resultado Financeiro.
 *
 * COMO RODAR (na pasta do projeto)
 * --------------------------------
 *     npm run import:extrato:dry     # relatório completo, NÃO grava nada
 *     npm run import:extrato         # executa
 *
 * Opções:
 *     --dry                  só relata o que faria
 *     --arquivo=caminho.xlsx planilha de origem (padrão: scripts/data/extratogeral.xlsx)
 *     --year=2026            restringe a exclusão e a carga a um ano
 *     --manter-baixas        não mexe nas baixas dos títulos (só troca o extrato)
 *     --sem-financeiro       não recalcula o Resultado Financeiro
 *
 * O QUE ESTE SCRIPT FAZ, NESTA ORDEM, E POR QUE A ORDEM IMPORTA
 * ============================================================
 * 1. LÊ e valida a planilha inteira ANTES de tocar no banco. Se a planilha tem
 *    problema, o extrato antigo continua no lugar — nunca se apaga o dado bom
 *    para depois descobrir que o novo não presta.
 *
 * 2. SOLTA AS BAIXAS AUTOMÁTICAS dos títulos (voltam a 'Em Aberto'). Isto vem
 *    ANTES de apagar o extrato de propósito: uma baixa automática é um ponteiro
 *    (`extrato_id`) para um lançamento do extrato. Apagar o extrato primeiro
 *    deixaria centenas de títulos "baixados" apontando para documentos que não
 *    existem mais — pagos aos olhos do sistema, sem nenhuma prova por trás, e
 *    invisíveis para a conciliação, que só procura par para quem está em aberto.
 *
 *    AS BAIXAS MANUAIS SÃO PRESERVADAS. Elas representam a decisão de uma
 *    pessoa que conferiu o caso; o script não tem autoridade para desfazer isso.
 *    As que apontarem para um lançamento que deixou de existir são LISTADAS no
 *    final, para conferência humana.
 *
 * 3. APAGA o extrato antigo e GRAVA o novo, com ID de documento derivado da
 *    chave (statementDocId) — a mesma regra da tela, então reimportar pela tela
 *    depois não duplica nada.
 *
 * 4. RECONCILIA os títulos contra o extrato novo com o MESMO motor da tela
 *    (src/utils/reconciliation.ts): o que passa do corte vira 'Baixado
 *    Automático', o que fica abaixo vira 'Conferir' em vez de ser descartado.
 *
 * 5. RECALCULA o Resultado Financeiro (entradas de bancos e de tesouraria por
 *    mês) a partir do extrato novo, com a mesma regra do App: transferência
 *    interna não conta como entrada.
 *
 * NADA DE LÓGICA DUPLICADA
 * ------------------------
 * Parser, chave, conciliação e mapeamento de título são carregados dos módulos
 * TypeScript de verdade (via transpilação em memória). Reescrever qualquer uma
 * dessas regras aqui criaria uma segunda verdade sobre o mesmo dado — é assim
 * que nascem os relatórios que não fecham entre a tela e o banco.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  writeBatch,
  doc,
  collection,
  getDocsFromServer,
  query,
  where,
  setDoc,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Carrega os módulos TS reais, sem build e sem duplicar regra ─────────────
const cache = new Map();
const loadTs = (relPath) => {
  if (cache.has(relPath)) return cache.get(relPath);
  const abs = resolve(root, relPath);
  const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.require = (spec) => {
    if (spec.startsWith('.')) return loadTs(resolve(dirname(abs), spec).replace(root + '/', '') + '.ts');
    return Module.createRequire(abs)(spec);
  };
  cache.set(relPath, m.exports);
  m._compile(js, abs);
  cache.set(relPath, m.exports);
  return m.exports;
};

const {
  parseExtratoGeralRows,
  summarizeExtratoGeral,
  toStatementEntry,
  validateExtratoGeralHeaders,
} = loadTs('src/utils/extratoGeralParser.ts');
const { statementDocId } = loadTs('src/utils/statementKeys.ts');
const { reconcile, buildBaixaCode } = loadTs('src/utils/reconciliation.ts');
const { DEFAULT_RECONCILIATION_SETTINGS } = loadTs('src/types.ts');
const { tituloFromFirestore, RECEIVABLES_COLLECTION, PAYABLES_COLLECTION } = loadTs('src/utils/titulosMapping.ts');

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
const keepBaixas = args.includes('--manter-baixas');
const skipFinancial = args.includes('--sem-financeiro');
const arqArg = args.find((a) => a.startsWith('--arquivo='));
const yearArg = args.find((a) => a.startsWith('--year='));
const onlyYear = yearArg ? parseInt(yearArg.split('=')[1], 10) : null;
const sheetPath = arqArg ? resolve(root, arqArg.split('=')[1]) : resolve(root, 'scripts/data/extratogeral.xlsx');

const STATEMENT_COLLECTION = 'extrato_financeiro';
const FINANCIAL_COLLECTION = 'resultado_financeiro';
const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CHUNK = 400;

const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

// ═══ ETAPA 1 — LER E VALIDAR A PLANILHA ANTES DE TOCAR NO BANCO ════════════

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║  EXTRATO GERAL — substituição do extrato e refação das baixas     ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

if (!existsSync(sheetPath)) {
  console.error(`\nPlanilha não encontrada: ${sheetPath}`);
  console.error('Use --arquivo=caminho/para/extrato.xlsx ou coloque o arquivo em scripts/data/extratogeral.xlsx');
  process.exit(1);
}

const wb = XLSX.read(readFileSync(sheetPath), { type: 'buffer', cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

if (rawRows.length === 0) {
  console.error('\nA planilha está vazia ou o cabeçalho não está na primeira linha.');
  process.exit(1);
}
const headerCheck = validateExtratoGeralHeaders(rawRows[0]);
if (!headerCheck.ok) {
  console.error(`\nColuna(s) ausente(s) na planilha: ${headerCheck.missing.join(', ')}`);
  console.error('Esperado: ID | BANCO | LANCAMENTO | DATA | ENTRADA | SAIDA | TIPO | CONTA');
  process.exit(1);
}

let parsed = parseExtratoGeralRows(rawRows);
if (onlyYear) parsed = parsed.filter((r) => r.year === onlyYear);
const resumo = summarizeExtratoGeral(parsed);
const validRows = parsed.filter((r) => r.valid);

if (validRows.length === 0) {
  console.error('\nNenhuma linha válida na planilha — nada a fazer. O extrato atual foi preservado.');
  process.exit(1);
}
if (resumo.duplicateKeys > 0) {
  // Chave repetida significa que um lançamento sobrescreveria o outro no banco.
  // Abortar aqui é o certo: gravar assim perderia dinheiro em silêncio.
  console.error(`\nABORTADO: ${resumo.duplicateKeys} chave(s) de lançamento repetida(s).`);
  console.error('Duas linhas cairiam no mesmo documento e uma sumiria. Rode:');
  console.error('  node scripts/testExtratoGeralParser.mjs');
  process.exit(1);
}

console.log(`\nArquivo   : ${sheetPath}`);
console.log(`Projeto   : ${firebaseConfig.projectId}`);
console.log(`Período   : ${resumo.periodStart} a ${resumo.periodEnd}   (anos: ${resumo.years.join(', ')})`);
console.log(`\nLinhas lidas        : ${resumo.totalRows}`);
console.log(`  a gravar          : ${resumo.validRows}`);
console.log(`  descartadas       : ${resumo.invalidRows}`);
console.log(`Entradas            : ${money(resumo.entradaTotal)}`);
console.log(`Saídas              : ${money(resumo.saidaTotal)}`);
console.log(`Saldo do movimento  : ${money(resumo.saldo)}`);

console.log('\nPor conta:');
for (const b of resumo.byBank) {
  console.log(
    `  ${pad(b.label, 18)} ${b.origin === 'banco' ? 'banco   ' : 'dinheiro'} ${rpad(b.count, 5)} lanç.` +
      `  entrada ${rpad(money(b.entrada), 16)}  saída ${rpad(money(b.saida), 16)}`
  );
}

if (resumo.typeDivergences.length) {
  console.log(`\nAVISO — coluna TIPO divergindo do valor em ${resumo.typeDivergences.length} linha(s).`);
  console.log('  Prevaleceu o SINAL DO VALOR (é ele que faz o extrato fechar com o banco).');
  for (const r of resumo.typeDivergences.slice(0, 15)) {
    console.log(
      `    linha ${rpad(r.rowNumber, 5)} ID ${rpad(r.sheetId, 5)} ${pad(r.bankRaw, 11)} ${r.date}  ` +
        `planilha: ${pad(r.sheetType, 8)} → gravado: ${pad(r.derivedType, 7)} ${money(r.entryAmount || r.exitAmount)}`
    );
  }
  if (resumo.typeDivergences.length > 15) console.log(`    … e mais ${resumo.typeDivergences.length - 15}.`);
}

if (resumo.discarded.length) {
  const porMotivo = new Map();
  for (const d of resumo.discarded) porMotivo.set(d.reason, (porMotivo.get(d.reason) || 0) + 1);
  console.log(`\nDescartadas (${resumo.discarded.length}) — não são lançamentos:`);
  for (const [motivo, qtd] of porMotivo) console.log(`  ${rpad(qtd, 4)}x ${motivo}`);
}

// ═══ CONEXÃO ═══════════════════════════════════════════════════════════════

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * LEITURA SEMPRE DO SERVIDOR, NUNCA DO CACHE.
 *
 * Com `getDocs`, o SDK do Firebase responde do cache local quando não consegue
 * falar com o servidor — e responde uma coleção VAZIA, sem erro. Num script que
 * decide o que apagar com base no que leu, isso é o pior comportamento
 * possível: ele concluiria "não existe extrato antigo", não apagaria nada, e
 * gravaria os 2.814 lançamentos novos AO LADO dos antigos. O caixa dobraria de
 * tamanho por causa de uma queda de rede.
 *
 * `getDocsFromServer` estoura em vez de mentir. Preferir o erro alto ao dado
 * silenciosamente errado é a regra aqui.
 */
const readFromServer = async (ref, what) => {
  try {
    return await getDocsFromServer(ref);
  } catch (err) {
    console.error(`\nNão foi possível ler ${what} do servidor: ${err?.message || err}`);
    console.error('Nada foi alterado. Confira a conexão e as regras do Firestore, e rode de novo.');
    process.exit(1);
  }
};

/** Escrita em lotes de 400 — o limite do writeBatch do Firestore. */
const commitInChunks = async (items, apply, label) => {
  let done = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const item of chunk) apply(batch, item);
    await batch.commit();
    done += chunk.length;
    process.stdout.write(`\r  ${label}: ${done}/${items.length} (${Math.round((done / items.length) * 100)}%)`);
  }
  if (items.length) process.stdout.write('\n');
  return done;
};

const run = async () => {
  // ═══ LEVANTAMENTO — o que existe hoje ════════════════════════════════════
  console.log('\n── Situação atual no banco ─────────────────────────────────');

  const statementSnap = await readFromServer(
    onlyYear
      ? query(collection(db, STATEMENT_COLLECTION), where('ano', '==', onlyYear))
      : collection(db, STATEMENT_COLLECTION),
    'o extrato atual'
  );
  const existentes = statementSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const porAno = new Map();
  for (const e of existentes) porAno.set(e.ano, (porAno.get(e.ano) || 0) + 1);
  console.log(`Extrato atual       : ${existentes.length} lançamento(s)${onlyYear ? ` no ano ${onlyYear}` : ''}`);
  for (const [ano, qtd] of [...porAno.entries()].sort()) console.log(`  ${ano}: ${qtd}`);

  const [recSnap, paySnap] = await Promise.all([
    readFromServer(collection(db, RECEIVABLES_COLLECTION), 'os títulos a receber'),
    readFromServer(collection(db, PAYABLES_COLLECTION), 'os títulos a pagar'),
  ]);
  const receber = recSnap.docs.map((d) => tituloFromFirestore(d.id, d.data(), 'R'));
  const pagar = paySnap.docs.map((d) => tituloFromFirestore(d.id, d.data(), 'P'));
  const titulos = [...receber, ...pagar];

  const contarStatus = (lista) => {
    const m = new Map();
    for (const t of lista) m.set(t.status, (m.get(t.status) || 0) + 1);
    return m;
  };
  const statusAntes = contarStatus(titulos);
  console.log(`Títulos             : ${titulos.length} (${receber.length} a receber, ${pagar.length} a pagar)`);
  for (const [s, q] of statusAntes) console.log(`  ${pad(s, 22)} ${q}`);

  const autoBaixados = titulos.filter((t) => t.status === 'Baixado Automático' || t.status === 'Conferir');
  const manuais = titulos.filter((t) => t.status === 'Baixado Manual');

  // Baixa manual apontando para lançamento que vai deixar de existir: não é
  // desfeita (foi decisão humana), mas precisa ser conferida por alguém.
  const idsQueVaoSumir = new Set(existentes.map((e) => e.id));
  const idsNovos = new Set(validRows.map((r) => statementDocId(r.dedupeKey)));
  const manuaisOrfaos = manuais.filter(
    (t) => t.reconciledStatementId && idsQueVaoSumir.has(t.reconciledStatementId) && !idsNovos.has(t.reconciledStatementId)
  );

  console.log('\n── Plano de execução ──────────────────────────────────────');
  console.log(`1. Soltar baixas automáticas    : ${keepBaixas ? 'PULADO (--manter-baixas)' : `${autoBaixados.length} título(s) → 'Em Aberto'`}`);
  console.log(`2. Apagar extrato antigo        : ${existentes.length} lançamento(s)`);
  console.log(`3. Gravar extrato novo          : ${validRows.length} lançamento(s)`);
  console.log(`4. Reconciliar contra o novo    : ${keepBaixas ? 'PULADO (--manter-baixas)' : 'sim'}`);
  console.log(`5. Recalcular Resultado Financeiro: ${skipFinancial ? 'PULADO (--sem-financeiro)' : 'sim'}`);
  console.log(`\nBaixas MANUAIS preservadas      : ${manuais.length}`);
  if (manuaisOrfaos.length) {
    console.log(`  ATENÇÃO: ${manuaisOrfaos.length} baixa(s) manual(is) apontam para lançamento que será removido.`);
    console.log('  Ficam como estão (foi decisão humana), mas confira na tela de Títulos:');
    for (const t of manuaisOrfaos.slice(0, 10)) {
      console.log(`    ${t.movType} ${pad(t.titleCode, 14)} ${pad(t.personName.slice(0, 28), 30)} ${money(t.amount)}`);
    }
    if (manuaisOrfaos.length > 10) console.log(`    … e mais ${manuaisOrfaos.length - 10}.`);
  }

  // Prévia da conciliação: roda o motor contra o extrato NOVO, em memória,
  // antes de qualquer escrita. É o número que o gestor precisa para decidir.
  const entradasNovas = validRows.map((r) => {
    const e = toStatementEntry(r);
    return { ...e, id: statementDocId(r.dedupeKey) };
  });
  const titulosSoltos = keepBaixas
    ? titulos
    : titulos.map((t) =>
        t.status === 'Baixado Automático' || t.status === 'Conferir'
          ? { ...t, status: 'Em Aberto', reconciledStatementId: '' }
          : t
      );

  const previa = { R: null, P: null };
  if (!keepBaixas) {
    for (const mov of ['R', 'P']) {
      previa[mov] = reconcile(
        titulosSoltos.filter((t) => t.movType === mov),
        entradasNovas,
        DEFAULT_RECONCILIATION_SETTINGS
      );
    }
    console.log('\n── Prévia da conciliação contra o extrato novo ─────────────');
    for (const mov of ['R', 'P']) {
      const s = previa[mov].stats;
      console.log(`${mov === 'R' ? 'A RECEBER' : 'A PAGAR  '} — ${s.titulosConsiderados} título(s) pago(s) em aberto`);
      console.log(`  baixa automática : ${rpad(s.autoCount, 5)}  ${money(s.autoAmount)}`);
      console.log(`  a conferir       : ${rpad(s.sugestaoCount, 5)}  ${money(s.sugestaoAmount)}`);
      console.log(`  sem par          : ${rpad(s.semParCount, 5)}  ${money(s.semParAmount)}`);
    }
  }

  // Prévia do Resultado Financeiro.
  const entradasPorMes = new Map();
  for (const e of entradasNovas) {
    if (!e.monthKey || e.isInternalTransfer) continue; // transferência interna não é entrada
    const k = `${e.year}|${e.monthKey}`;
    const cur = entradasPorMes.get(k) || { bancos: 0, tesouraria: 0 };
    if (e.origin === 'banco') cur.bancos += e.entryAmount;
    else cur.tesouraria += e.entryAmount;
    entradasPorMes.set(k, cur);
  }
  if (!skipFinancial) {
    console.log('\n── Prévia do Resultado Financeiro (entradas por mês) ──────');
    console.log('  mês       entradas bancos      entradas tesouraria');
    for (const [k, v] of [...entradasPorMes.entries()].sort()) {
      const [ano, mes] = k.split('|');
      console.log(`  ${mes}/${ano}  ${rpad(money(v.bancos), 18)}  ${rpad(money(v.tesouraria), 20)}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry: NADA foi gravado. O extrato e as baixas continuam como estão.');
    console.log('Exemplo do documento que seria criado:');
    const s = entradasNovas[0];
    console.log(`  id       = ${s.id}`);
    console.log(`  data     = ${s.date}  | ${s.sourceLabel} (${s.origin})`);
    console.log(`  histórico= ${s.description.slice(0, 60)}`);
    console.log(`  entrada  = ${money(s.entryAmount)} | saída = ${money(s.exitAmount)}`);
    console.log('\nPara executar de verdade: npm run import:extrato\n');
    process.exit(0);
  }

  // ═══ ETAPA 2 — SOLTAR AS BAIXAS AUTOMÁTICAS ══════════════════════════════
  // ANTES de apagar o extrato: uma baixa é um ponteiro para o lançamento. Se o
  // extrato for embora primeiro, sobram títulos "baixados" apontando para o
  // nada — pagos aos olhos do sistema, sem prova, e fora do alcance da
  // conciliação, que só procura par para quem está em aberto.
  console.log('\n── Executando ─────────────────────────────────────────────');
  if (!keepBaixas && autoBaixados.length) {
    const limpar = {
      status_baixa: 'Em Aberto',
      extrato_id: '',
      extrato_fonte: '',
      extrato_sugerido: '',
      baixa_em: '',
      baixa_score: 0,
      baixa_motivo: '',
      baixa_codigo: '',
    };
    await commitInChunks(
      autoBaixados,
      (batch, t) =>
        batch.set(
          doc(db, t.movType === 'R' ? RECEIVABLES_COLLECTION : PAYABLES_COLLECTION, t.id),
          limpar,
          { merge: true }
        ),
      '1/5 soltando baixas automáticas'
    );
  } else {
    console.log('  1/5 baixas automáticas: nada a soltar');
  }

  // ═══ ETAPA 3 — APAGAR O ANTIGO E GRAVAR O NOVO ═══════════════════════════
  if (existentes.length) {
    await commitInChunks(
      existentes,
      (batch, e) => batch.delete(doc(db, STATEMENT_COLLECTION, e.id)),
      '2/5 apagando extrato antigo'
    );
  } else {
    console.log('  2/5 extrato antigo: já estava vazio');
  }

  const importedAt = new Date().toISOString();
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
    conta_codigo: e.accountCode || '',
    conta_label: e.accountLabel || '',
    conta_gerencial: e.managementAccount || '',
    transferencia_interna: !!e.isInternalTransfer,
    conta_contrapartida: e.counterAccountCode || '',
    importado_em: importedAt,
  });

  await commitInChunks(
    entradasNovas,
    (batch, e) => batch.set(doc(db, STATEMENT_COLLECTION, e.id), toFirestore(e), { merge: true }),
    '3/5 gravando extrato novo'
  );

  // ═══ ETAPA 4 — RECONCILIAR CONTRA O EXTRATO NOVO ═════════════════════════
  const resultadoBaixas = { R: { auto: 0, conferir: 0 }, P: { auto: 0, conferir: 0 } };
  if (!keepBaixas) {
    const now = new Date().toISOString();
    for (const mov of ['R', 'P']) {
      const col = mov === 'R' ? RECEIVABLES_COLLECTION : PAYABLES_COLLECTION;
      const rec = previa[mov];

      // Código legível da baixa (RC-2026-00001 / BX-2026-00001), continuando a
      // sequência que já existe na base para não repetir número.
      const prefix = mov === 'R' ? 'RC-' : 'BX-';
      const usados = titulos
        .filter((t) => t.baixaCode && t.baixaCode.startsWith(prefix))
        .map((t) => parseInt(t.baixaCode.replace(/\D/g, '').slice(-5), 10))
        .filter((n) => !isNaN(n));
      let seq = usados.length ? Math.max(...usados) : 0;

      if (rec.auto.length) {
        const comCodigo = rec.auto.map((m) => ({ ...m, code: buildBaixaCode(mov, new Date().getFullYear(), ++seq) }));
        resultadoBaixas[mov].auto = await commitInChunks(
          comCodigo,
          (batch, m) =>
            batch.set(
              doc(db, col, m.tituloId),
              {
                status_baixa: 'Baixado Automático',
                extrato_id: m.statementId,
                extrato_fonte: m.statementSource,
                baixa_em: now,
                baixa_score: m.score,
                baixa_motivo: m.reason,
                baixa_codigo: m.code,
              },
              { merge: true }
            ),
          `4/5 baixando ${mov === 'R' ? 'recebimentos' : 'pagamentos'}`
        );
      }

      // Candidato abaixo do corte vira 'Conferir'. Descartar seria pior: o
      // título voltaria a 'Em Aberto' sem nenhum registro de que existe um
      // lançamento parecido esperando o olho humano.
      if (rec.suggestions.length) {
        resultadoBaixas[mov].conferir = await commitInChunks(
          rec.suggestions,
          (batch, m) =>
            batch.set(
              doc(db, col, m.tituloId),
              {
                status_baixa: 'Conferir',
                extrato_sugerido: m.statementId,
                baixa_score: m.score,
                baixa_motivo: m.reason,
              },
              { merge: true }
            ),
          `4/5 marcando ${mov === 'R' ? 'recebimentos' : 'pagamentos'} para conferir`
        );
      }
    }
  } else {
    console.log('  4/5 conciliação: PULADA (--manter-baixas)');
  }

  // ═══ ETAPA 5 — RECALCULAR O RESULTADO FINANCEIRO ═════════════════════════
  // Mesma regra do App (recomputeFinancialFromStatement): só as entradas são
  // reescritas a partir do extrato; saídas, estoque e inadimplência continuam
  // como estão, porque não vêm daqui. `resultado_financeiro` é recalculado com
  // a saída já gravada, senão o mês fecharia com o resultado antigo e a entrada
  // nova.
  if (!skipFinancial) {
    const anos = [...new Set(entradasNovas.map((e) => e.year))];
    let gravados = 0;
    for (const ano of anos) {
      const snap = await readFromServer(
        query(collection(db, FINANCIAL_COLLECTION), where('ano', '==', ano)),
        `o Resultado Financeiro de ${ano}`
      );
      const atual = new Map();
      snap.forEach((d) => atual.set(d.data().mes_chave, d.data()));

      for (const mes of MONTH_KEYS) {
        const v = entradasPorMes.get(`${ano}|${mes}`) || { bancos: 0, tesouraria: 0 };
        const existente = atual.get(mes) || {};
        // Mês sem entrada no extrato E sem documento no banco não precisa de
        // documento: criar doze registros zerados por ano só suja a base.
        if (!v.bancos && !v.tesouraria && !atual.has(mes)) continue;

        const entradasBancos = Math.round(v.bancos * 100) / 100;
        const entradasTesouraria = Math.round(v.tesouraria * 100) / 100;
        const totalEntradas = Math.round((entradasBancos + entradasTesouraria) * 100) / 100;
        const totalSaidas = Number(existente.total_saidas) || 0;

        await setDoc(
          doc(db, FINANCIAL_COLLECTION, `${ano}-${mes}`),
          {
            ano,
            mes_chave: mes,
            entradas_bancos: entradasBancos,
            entradas_tesouraria: entradasTesouraria,
            total_entradas: totalEntradas,
            resultado_financeiro: Math.round((totalEntradas - totalSaidas) * 100) / 100,
          },
          { merge: true }
        );
        gravados++;
      }
    }
    console.log(`  5/5 Resultado Financeiro: ${gravados} mês(es) atualizado(s)`);
  } else {
    console.log('  5/5 Resultado Financeiro: PULADO (--sem-financeiro)');
  }

  // ═══ FECHAMENTO ══════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  CONCLUÍDO                                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`Extrato        : ${existentes.length} removido(s) → ${entradasNovas.length} gravado(s)`);
  console.log(`  entradas     : ${money(resumo.entradaTotal)}`);
  console.log(`  saídas       : ${money(resumo.saidaTotal)}`);
  if (!keepBaixas) {
    console.log(`Baixas refeitas:`);
    console.log(`  a receber    : ${resultadoBaixas.R.auto} baixada(s), ${resultadoBaixas.R.conferir} a conferir`);
    console.log(`  a pagar      : ${resultadoBaixas.P.auto} baixada(s), ${resultadoBaixas.P.conferir} a conferir`);
    console.log(`  manuais mantidas: ${manuais.length}${manuaisOrfaos.length ? ` (${manuaisOrfaos.length} para conferir)` : ''}`);
  }
  console.log('\nAbra o sistema em Extrato Financeiro e em Títulos para conferir.');
  process.exit(0);
};

run().catch((err) => {
  console.error('\nErro:', err?.message || err);
  console.error('\nO que já foi gravado permanece. Rode de novo: a gravação é idempotente');
  console.error('(o ID do documento vem da chave do lançamento, então nada duplica).');
  process.exit(1);
});
