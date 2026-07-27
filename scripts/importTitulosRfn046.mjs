/**
 * importTitulosRfn046.mjs — Carga direta dos títulos (RFN046) no Firestore.
 *
 * COMO RODAR (na pasta do projeto)
 * ================================
 *     npm run import:titulos:dry     # simula, não grava nada
 *     npm run import:titulos         # grava de verdade
 *
 * Passando arquivos explicitamente:
 *     node scripts/importTitulosRfn046.mjs entradas.xlsx saidas.xlsx
 *
 * Sem argumentos, o script varre `scripts/data/` e a raiz do projeto atrás de
 * arquivos `RFN046*.xlsx` e descobre sozinho qual é de entrada e qual é de
 * saída — pela coluna `Titulo_MovimentoFinanceiro`, não pelo nome do arquivo.
 * Nome de arquivo é convenção humana e falha; a coluna é o dado.
 *
 * OPÇÕES
 * ------
 *     --dry              simula e mostra tudo, sem escrever
 *     --limpar-legado    apaga as bases antigas antes de gravar:
 *                        titulos_inadimplentes, contas_a_pagar_previsao e os
 *                        documentos `mov_*` remanescentes do RFN006 dentro de
 *                        contas_a_pagar (formato antigo, campos incompatíveis)
 *     --sem-conciliar    pula a baixa automática contra o extrato
 *
 * O QUE ELE FAZ, NA ORDEM
 * -----------------------
 *  1. Lê as planilhas com o PARSER DO APP (`src/utils/rfn046Parser.ts`),
 *     transpilado na hora. Não existe segunda implementação da leitura aqui —
 *     é a mesma regra que roda na tela, então o resultado é o mesmo.
 *  2. Resolve o vínculo `Titulo_PessoaCod` ⇄ `cod_cliente` contra a coleção
 *     `clientes`, usando a normalização do app (`src/utils/linking.ts`).
 *  3. Grava com o MESMO ID e os MESMOS nomes de campo da tela
 *     (`src/utils/titulosMapping.ts`). Rodar o script e depois importar pela
 *     tela — ou o contrário — não duplica nada: os dois caem no mesmo documento.
 *  4. Roda a baixa automática contra `extrato_financeiro` com o motor do app
 *     (`src/utils/reconciliation.ts`) e aplica o que passa do corte.
 *
 * NADA AQUI É "SÓ DO SCRIPT". Toda regra vem de um arquivo que o app também usa.
 * É isso que impede a carga em lote e a importação pela tela de produzirem duas
 * verdades diferentes sobre a mesma planilha.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, writeBatch, doc, collection, getDocsFromServer } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ─── Carregador de TypeScript ────────────────────────────────────────────────
// Transpila e executa um módulo .ts do app dentro deste processo Node. É o que
// permite reaproveitar parser, mapeamento e motor de conciliação sem copiar
// código — cópia de regra é como nasce divergência entre tela e script.
const tsCache = new Map();

/**
 * Pacotes que só existem no navegador. `exportUtils.ts` importa jsPDF no topo
 * do arquivo, e o parser importa `parseNumberPtBr` de lá — carregar a cadeia
 * inteira em Node quebraria por falta de DOM.
 *
 * A alternativa seria reescrever `parseNumberPtBr` aqui, e aí a conversão de
 * "1.234,56" passaria a ter duas implementações: a que a tela usa e a que o
 * script usa. Um centavo de diferença entre elas vira divergência permanente
 * entre o que foi importado pela tela e o que foi importado pelo script.
 * Trocar o jsPDF por um objeto vazio é mais barato: o parser nunca o chama.
 */
const SOMENTE_NAVEGADOR = new Set(['jspdf', 'jspdf-autotable', 'html2canvas']);

const loadTs = (relPath) => {
  const abs = resolve(root, relPath);
  if (tsCache.has(abs)) return tsCache.get(abs);

  const js = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(dirname(abs));
  // Registra antes de compilar para suportar ciclos de import entre módulos.
  tsCache.set(abs, m.exports);

  // Resolvedor próprio: import relativo continua sendo código do app (segue
  // por loadTs, mantendo uma única implementação de cada regra); import de
  // pacote vai para o require normal, exceto os que só rodam no navegador.
  m.require = (req) => {
    if (req.startsWith('.')) {
      const candidatos = [req + '.ts', req + '.tsx', req + '/index.ts', req];
      for (const c of candidatos) {
        const alvo = resolve(dirname(abs), c);
        if (existsSync(alvo)) return loadTs(alvo.slice(root.length + 1));
      }
    }
    if (SOMENTE_NAVEGADOR.has(req)) return new Proxy(function () {}, { get: () => () => {} });
    return Module.createRequire(abs)(req);
  };

  m._compile(js, abs);
  tsCache.set(abs, m.exports);
  return m.exports;
};

const { parseRfn046Rows, detectMovType, looksLikeRfn046, missingRfn046Headers, summarizeTitulos } =
  loadTs('src/utils/rfn046Parser.ts');
const { tituloDocId, tituloToFirestore, tituloFromFirestore, collectionFor } =
  loadTs('src/utils/titulosMapping.ts');
const { normalizePersonCode } = loadTs('src/utils/linking.ts');
const { reconcile } = loadTs('src/utils/reconciliation.ts');

// ─── Argumentos ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const LIMPAR_LEGADO = argv.includes('--limpar-legado');
const SEM_CONCILIAR = argv.includes('--sem-conciliar');
const arquivosArg = argv.filter((a) => !a.startsWith('--'));

// ─── Config do Firebase (mesma do app, lida do .env) ─────────────────────────
const readEnv = () => {
  const out = {};
  for (const nome of ['.env.local', '.env']) {
    const p = resolve(root, nome);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].trim();
    }
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

// ─── Formatação ──────────────────────────────────────────────────────────────
const brl = (n) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n) => (n || 0).toLocaleString('pt-BR');
const linha = (c = '─') => console.log(c.repeat(74));
const titulo = (t) => {
  console.log('');
  linha('═');
  console.log(`  ${t}`);
  linha('═');
};

// ─── Descoberta dos arquivos ─────────────────────────────────────────────────
const acharPlanilhas = () => {
  if (arquivosArg.length > 0) return arquivosArg.map((a) => resolve(root, a));
  const candidatos = [];
  for (const dir of [resolve(root, 'scripts/data'), root, resolve(root, 'uploads')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/^RFN046.*\.xlsx?$/i.test(f)) candidatos.push(resolve(dir, f));
    }
  }
  return candidatos;
};

// ─── Leitura + parse de uma planilha ─────────────────────────────────────────
const lerPlanilha = (caminho) => {
  const wb = XLSX.read(readFileSync(caminho), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  if (!looksLikeRfn046(rows)) {
    throw new Error(
      `${basename(caminho)} não parece um RFN046 — faltam as colunas obrigatórias ` +
        '(Titulo_Codigo / Titulo_MovimentoFinanceiro / Titulo_DataVencimento / Titulo_Status).'
    );
  }

  const det = detectMovType(rows);
  if (!det.movType) throw new Error(`${basename(caminho)}: nenhuma linha tem Titulo_MovimentoFinanceiro.`);

  const faltando = missingRfn046Headers(rows);
  const parsed = parseRfn046Rows(rows, det.movType);
  return { caminho, rows, det, faltando, parsed };
};

// ─── Programa ────────────────────────────────────────────────────────────────
const main = async () => {
  titulo('CARGA DE TÍTULOS FINANCEIROS — RFN046');
  console.log(`  Projeto Firebase : ${firebaseConfig.projectId || '(não configurado)'}`);
  console.log(`  Modo             : ${DRY ? 'SIMULAÇÃO (--dry) — nada será gravado' : 'GRAVAÇÃO REAL'}`);
  console.log(`  Limpar legado    : ${LIMPAR_LEGADO ? 'SIM' : 'não'}`);
  console.log(`  Conciliar        : ${SEM_CONCILIAR ? 'não' : 'sim, após a carga'}`);

  if (!firebaseConfig.projectId) {
    console.error('\n  ✕ .env sem VITE_FIREBASE_PROJECT_ID. Configure antes de rodar.');
    process.exit(1);
  }

  const caminhos = acharPlanilhas();
  if (caminhos.length === 0) {
    console.error(
      '\n  ✕ Nenhuma planilha RFN046 encontrada.\n' +
        '    Coloque os arquivos em scripts/data/ ou passe os caminhos:\n' +
        '    node scripts/importTitulosRfn046.mjs entradas.xlsx saidas.xlsx'
    );
    process.exit(1);
  }

  // ── 1. Leitura e conferência ───────────────────────────────────────────────
  titulo('1. LEITURA E CONFERÊNCIA DAS PLANILHAS');
  const lidos = [];
  for (const c of caminhos) {
    const r = lerPlanilha(c);
    lidos.push(r);
    const sum = summarizeTitulos(r.parsed, r.det.movType);
    const lado = r.det.movType === 'R' ? 'ENTRADA → contas_a_receber' : 'SAÍDA → contas_a_pagar';

    console.log(`\n  ${basename(c)}`);
    console.log(`    Movimento     : ${r.det.movType}  (${lado})`);
    console.log(`    Linhas        : ${num(sum.totalRows)}  · válidas ${num(sum.validRows)} · rejeitadas ${num(sum.invalidRows)}`);
    console.log(`    Total         : ${brl(sum.totalAmount)}`);
    console.log(`    Pagos (ERP)   : ${num(sum.paidRows)} · ${brl(sum.paidAmount)}   → viram REALIZADO no fluxo de caixa`);
    console.log(`    Em aberto     : ${num(sum.openRows)} · ${brl(sum.openBalance)}   → viram PREVISÃO`);
    console.log(`    Vencimentos   : ${sum.periodStart || '—'} a ${sum.periodEnd || '—'}`);
    if (r.faltando.length) console.log(`    ! colunas ausentes: ${r.faltando.join(', ')}`);
    if (r.det.mixed) console.log(`    ! arquivo MISTO: ${r.det.counts.R} linha(s) R e ${r.det.counts.P} linha(s) P`);

    const invalidas = r.parsed.filter((p) => !p.valid);
    if (invalidas.length) {
      console.log(`    ! ${invalidas.length} linha(s) rejeitada(s) — NÃO serão gravadas:`);
      invalidas.slice(0, 10).forEach((p) => console.log(`        linha ${p.rowNumber}: ${p.errors.join(' | ')}`));
      if (invalidas.length > 10) console.log(`        ... e mais ${invalidas.length - 10}`);
    }
  }

  const porMov = new Map();
  for (const r of lidos) {
    const lista = porMov.get(r.det.movType) || [];
    lista.push(...r.parsed.filter((p) => p.valid).map((p) => p.titulo));
    porMov.set(r.det.movType, lista);
  }
  for (const [mov, lista] of porMov) {
    const codigos = new Set(lista.map((t) => t.titleCode));
    if (codigos.size !== lista.length) {
      console.log(
        `\n  ! ${lista.length - codigos.size} Titulo_Codigo repetido(s) no lado ${mov}. ` +
          'Repetição cai no MESMO documento — a última linha lida prevalece.'
      );
    }
  }

  // ── 2. Conexão ─────────────────────────────────────────────────────────────
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  /**
   * Lê SEMPRE do servidor, nunca do cache local.
   *
   * Esta é a trava mais importante do script. Sem rede, o SDK do Firestore não
   * dá erro na leitura: ele devolve o cache — que, num processo Node recém
   * iniciado, está vazio. O script então concluiria que a base está zerada, que
   * todos os títulos são novos, e que não há nada a limpar. Sairia imprimindo
   * "gravado" com as escritas presas numa fila que nunca sai.
   *
   * `getDocsFromServer` falha alto quando não há conexão, que é o
   * comportamento certo para uma carga de dados: melhor não rodar do que rodar
   * mentindo.
   */
  const lerColecao = async (nome) => {
    try {
      const snap = await getDocsFromServer(collection(db, nome));
      return snap.docs;
    } catch (err) {
      throw new Error(
        `Não foi possível ler a coleção "${nome}" no Firestore.\n` +
          `    Causa: ${err?.message || err}\n` +
          '    Confira a conexão com a internet e as credenciais do .env antes de tentar de novo.\n' +
          '    Nada foi gravado.'
      );
    }
  };

  // Sonda de conexão antes de qualquer coisa: é aqui que a falha aparece, e não
  // no meio da gravação com a base pela metade.
  process.stdout.write('\n  Conectando ao Firestore... ');
  await lerColecao('clientes');
  console.log('ok.');

  const apagarEmLote = async (nome, docs) => {
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => b.delete(doc(db, nome, d.id)));
      await b.commit();
    }
  };

  // ── 3. Vínculo com o cadastro de clientes ─────────────────────────────────
  titulo('2. VÍNCULO COM O CADASTRO DE CLIENTES');
  const clientesDocs = await lerColecao('clientes');
  const porCodigo = new Map();
  for (const d of clientesDocs) {
    const k = normalizePersonCode(d.data().cod_cliente ?? d.data().codigo ?? '');
    if (k) porCodigo.set(k, d.id);
  }
  console.log(`  ${num(clientesDocs.length)} cliente(s) no cadastro · ${num(porCodigo.size)} com código utilizável.`);

  for (const [mov, lista] of porMov) {
    let ligados = 0;
    for (const t of lista) {
      const id = porCodigo.get(normalizePersonCode(t.personCode));
      if (id) {
        t.customerId = id;
        ligados += 1;
      }
    }
    const pct = lista.length ? Math.round((ligados / lista.length) * 100) : 0;
    console.log(`  ${mov === 'R' ? 'A receber' : 'A pagar  '} : ${num(ligados)}/${num(lista.length)} títulos vinculados (${pct}%)`);
    if (pct < 100) {
      const orfaos = new Map();
      lista.filter((t) => !t.customerId).forEach((t) => orfaos.set(t.personCode, t.personName));
      console.log(`             ${orfaos.size} pessoa(s) sem cadastro. Primeiras:`);
      [...orfaos.entries()].slice(0, 5).forEach(([c, n]) => console.log(`               cód ${c} — ${n}`));
    }
  }

  // ── 4. Estado atual das bases ─────────────────────────────────────────────
  titulo('3. ESTADO ATUAL DAS BASES');
  const estado = {};
  for (const nome of ['contas_a_receber', 'contas_a_pagar', 'contas_a_pagar_previsao', 'titulos_inadimplentes', 'extrato_financeiro']) {
    const docs = await lerColecao(nome);
    estado[nome] = docs;
    console.log(`  ${nome.padEnd(24)} ${num(docs.length).padStart(7)} documento(s)`);
  }
  const legadoNoPagar = estado['contas_a_pagar'].filter((d) => d.id.startsWith('mov_'));
  if (legadoNoPagar.length) {
    console.log(
      `\n  ! ${num(legadoNoPagar.length)} documento(s) no formato ANTIGO (RFN006, id 'mov_*') dentro de contas_a_pagar.\n` +
        '    Eles usam nomes de campo incompatíveis e apareceriam zerados na tela nova.\n' +
        `    ${LIMPAR_LEGADO ? 'Serão apagados (--limpar-legado).' : 'Use --limpar-legado para apagá-los.'}`
    );
  }

  if (DRY) {
    titulo('SIMULAÇÃO CONCLUÍDA — NADA FOI GRAVADO');
    for (const [mov, lista] of porMov) {
      console.log(`  ${collectionFor(mov)}: gravaria ${num(lista.length)} documento(s).`);
    }
    if (LIMPAR_LEGADO) {
      console.log(`  Apagaria: titulos_inadimplentes (${num(estado['titulos_inadimplentes'].length)}), ` +
        `contas_a_pagar_previsao (${num(estado['contas_a_pagar_previsao'].length)}), ` +
        `legado em contas_a_pagar (${num(legadoNoPagar.length)}).`);
    }
    console.log('\n  Rode sem --dry para gravar de verdade.');
    return;
  }

  // ── 5. Limpeza do legado ──────────────────────────────────────────────────
  if (LIMPAR_LEGADO) {
    titulo('4. LIMPEZA DAS BASES LEGADAS');
    for (const nome of ['titulos_inadimplentes', 'contas_a_pagar_previsao']) {
      const docs = estado[nome];
      if (docs.length === 0) {
        console.log(`  ${nome}: já vazia.`);
        continue;
      }
      await apagarEmLote(nome, docs);
      console.log(`  ${nome}: ${num(docs.length)} documento(s) apagado(s).`);
    }
    if (legadoNoPagar.length) {
      await apagarEmLote('contas_a_pagar', legadoNoPagar);
      console.log(`  contas_a_pagar (formato antigo 'mov_*'): ${num(legadoNoPagar.length)} apagado(s).`);
    }
    console.log('\n  Preservadas: resultado_economico, resultado_financeiro, fluxo_caixa,');
    console.log('  extrato_financeiro, faturamento*, vendas*, estoque*, clientes, vendedores.');
  }

  // ── 6. Gravação ───────────────────────────────────────────────────────────
  titulo(`${LIMPAR_LEGADO ? '5' : '4'}. GRAVAÇÃO DOS TÍTULOS`);
  const agora = new Date().toISOString();

  for (const [mov, lista] of porMov) {
    const col = collectionFor(mov);
    const existentes = new Set((await lerColecao(col)).map((d) => d.id));
    let criados = 0;

    for (let i = 0; i < lista.length; i += 400) {
      const bloco = lista.slice(i, i + 400);
      const b = writeBatch(db);
      for (const t of bloco) {
        const id = tituloDocId(t.titleCode);
        const novo = !existentes.has(id);
        if (novo) criados += 1;

        const payload = tituloToFirestore(t);
        payload.atualizado_em = agora;
        if (novo) {
          payload.criado_em = agora;
          payload.importado_em = agora;
          // Status de baixa só na criação: sobrescrever devolveria para "Em
          // Aberto" uma conciliação que o gestor já tinha conferido.
          payload.status_baixa = 'Em Aberto';
        }
        b.set(doc(db, col, id), payload, { merge: true });
        existentes.add(id);
      }
      await b.commit();
      process.stdout.write(`\r  ${col}: ${num(Math.min(i + 400, lista.length))}/${num(lista.length)}   `);
    }
    console.log(`\r  ${col}: ${num(lista.length)} gravado(s) — ${num(criados)} novo(s), ${num(lista.length - criados)} atualizado(s).      `);
  }

  // ── 7. Baixa automática ───────────────────────────────────────────────────
  if (!SEM_CONCILIAR) {
    titulo(`${LIMPAR_LEGADO ? '6' : '5'}. BAIXA AUTOMÁTICA CONTRA O EXTRATO`);

    // Régua padrão do app. Na tela, o gestor pode afrouxar ou apertar.
    const CFG = {
      amountToleranceAbs: 0.05,
      amountTolerancePercent: 0,
      dateWindowDays: 3,
      minNameSimilarity: 70,
      autoMatchMinScore: 75,
      suggestionMinScore: 50,
      requireNameMatch: false,
    };
    console.log(`  Régua: ±${brl(CFG.amountToleranceAbs)} · janela ${CFG.dateWindowDays} dia(s) · nome ≥ ${CFG.minNameSimilarity}%`);
    console.log(`         baixa automática a partir de score ${CFG.autoMatchMinScore}; sugestão a partir de ${CFG.suggestionMinScore}.`);

    const extrato = (await lerColecao('extrato_financeiro')).map((d) => {
      const x = d.data();
      return {
        id: d.id,
        date: x.data || '',
        year: Number(x.ano) || 0,
        monthKey: x.mes_chave || '',
        description: x.descricao || x.lancamento || '',
        clientName: x.cliente || '',
        documentRef: x.documento_ref || '',
        notes: x.observacoes || '',
        entryAmount: Number(x.valor_entrada) || 0,
        exitAmount: Number(x.valor_saida) || 0,
        source: x.fonte || '',
        sourceLabel: x.fonte_rotulo || x.fonte || '',
        isInternalTransfer: x.transferencia_interna === true,
      };
    });
    console.log(`  Extrato: ${num(extrato.length)} lançamento(s) (todos os anos).`);

    if (extrato.length === 0) {
      console.log('  Nenhum lançamento de extrato — nada a conciliar. Importe os extratos e rode a conciliação pela tela.');
    } else {
      for (const mov of porMov.keys()) {
        const col = collectionFor(mov);
        const todos = (await lerColecao(col)).map((d) => tituloFromFirestore(d.id, d.data(), mov));
        const r = reconcile(todos, extrato, CFG);

        const aplicar = async (matches, status) => {
          for (let i = 0; i < matches.length; i += 400) {
            const b = writeBatch(db);
            for (const m of matches.slice(i, i + 400)) {
              b.set(
                doc(db, col, m.tituloId),
                status === 'Conferir'
                  ? { status_baixa: 'Conferir', baixa_score: m.score, baixa_motivo: m.reason, extrato_sugerido: m.statementId }
                  : {
                      status_baixa: status,
                      extrato_id: m.statementId,
                      extrato_fonte: m.statementSource,
                      baixa_em: agora,
                      baixa_score: m.score,
                      baixa_motivo: m.reason,
                    },
                { merge: true }
              );
            }
            await b.commit();
          }
        };

        await aplicar(r.auto, 'Baixado Automático');
        await aplicar(r.suggestions, 'Conferir');

        console.log(`\n  ${col}`);
        console.log(`    Analisados      : ${num(r.stats.titulosConsiderados)} título(s) pagos sem baixa`);
        console.log(`    Baixa automática: ${num(r.stats.autoCount)} · ${brl(r.stats.autoAmount)}`);
        console.log(`    A conferir      : ${num(r.stats.sugestaoCount)} · ${brl(r.stats.sugestaoAmount)}`);
        console.log(`    Sem par         : ${num(r.stats.semParCount)} · ${brl(r.stats.semParAmount)}`);
      }
    }
  }

  titulo('CARGA CONCLUÍDA');
  console.log('  Abra o sistema em Contas a Receber e Contas a Pagar para conferir.');
  console.log('  Os títulos sem par no extrato aparecem como "Em Aberto" na coluna Baixa —');
  console.log('  é dinheiro que o ERP registrou e o extrato importado não cobre.');
  console.log('');
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n  ✕ ERRO:', err?.message || err);
    // O rastreamento só interessa a quem está depurando o script; para o gestor
    // ele só empurra a mensagem útil para fora da tela.
    if (argv.includes('--debug') && err?.stack) console.error(err.stack);
    process.exit(1);
  });
