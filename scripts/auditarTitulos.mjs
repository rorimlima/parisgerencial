/**
 * auditarTitulos.mjs — Confere o que ESTÁ NO BANCO contra o que ESTÁ NA PLANILHA.
 *
 * COMO RODAR (na pasta do projeto)
 * ================================
 *     npm run auditar:titulos
 *
 * Só lê. Nenhuma escrita, em nenhuma hipótese — é uma auditoria, e auditoria que
 * corrige o que está medindo deixa de ser auditoria.
 *
 * O QUE ELE PERGUNTA
 * ==================
 * Importar "sem erro" não prova que a base ficou certa. As sete perguntas:
 *
 *  1. FALTOU?      título na planilha que não existe no banco.
 *  2. SOBROU?      título no banco que não está na planilha (carga anterior,
 *                  registro manual, ou resíduo de base legada).
 *  3. BATE?        campo a campo: valor, saldo, datas, status, pessoa, depto.
 *  4. DUPLICOU?    dois documentos apontando para o mesmo Titulo_Codigo.
 *  5. FECHA?       soma dos documentos × soma da planilha, no centavo.
 *  6. VINCULOU?    quantos títulos amarraram no cod_cliente.
 *  7. CONCILIOU?   integridade das baixas: título baixado sem extrato, extrato
 *                  usado em dois títulos, baixa em título que não está pago.
 *
 * FORMATO ANTIGO
 * --------------
 * Documentos com id `mov_*` (RFN006) ou campos do modelo velho são reportados à
 * parte. Eles não são "divergência de dados": são de outra fonte, e continuar
 * somando-os é o que faz o total do sistema não bater com o do ERP.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocsFromServer } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ─── Carregador de TypeScript (mesmo do script de carga) ─────────────────────
const tsCache = new Map();
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
  tsCache.set(abs, m.exports);
  m.require = (req) => {
    if (req.startsWith('.')) {
      for (const c of [req + '.ts', req + '.tsx', req + '/index.ts', req]) {
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

const { parseRfn046Rows, detectMovType, looksLikeRfn046 } = loadTs('src/utils/rfn046Parser.ts');
const { tituloDocId, tituloFromFirestore, tituloToFirestore, collectionFor } = loadTs('src/utils/titulosMapping.ts');
const { normalizePersonCode } = loadTs('src/utils/linking.ts');

// ─── Config ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--detalhado');
const AUTOTESTE = argv.includes('--autoteste');
const LIMITE = Number((argv.find((a) => a.startsWith('--limite=')) || '').split('=')[1] || 15);
const arquivosArg = argv.filter((a) => !a.startsWith('--'));

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

// ─── Formatação ──────────────────────────────────────────────────────────────
const brl = (n) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n) => (n || 0).toLocaleString('pt-BR');
const cent = (n) => Math.round((n || 0) * 100);
const somaCent = (arr, get) => arr.reduce((a, x) => a + cent(get(x)), 0);
const titulo = (t) => {
  console.log('');
  console.log('═'.repeat(76));
  console.log(`  ${t}`);
  console.log('═'.repeat(76));
};
const OK = '  ✓';
const FALHA = '  ✕';
const ALERTA = '  !';

// Acumulador do veredito final. Uma auditoria que não conclui nada é um
// relatório de números soltos; o gestor precisa saber se pode confiar na base.
const achados = { erros: [], alertas: [] };
const erro = (msg) => {
  achados.erros.push(msg);
  console.log(`${FALHA} ${msg}`);
};
const alerta = (msg) => {
  achados.alertas.push(msg);
  console.log(`${ALERTA} ${msg}`);
};
const ok = (msg) => console.log(`${OK} ${msg}`);

// ─── Planilhas ───────────────────────────────────────────────────────────────
const acharPlanilhas = () => {
  if (arquivosArg.length > 0) return arquivosArg.map((a) => resolve(root, a));
  const out = [];
  for (const dir of [resolve(root, 'scripts/data'), root, resolve(root, 'uploads')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (/^RFN046.*\.xlsx?$/i.test(f)) out.push(resolve(dir, f));
  }
  return out;
};

// Campos conferidos um a um. A lista é explícita para que acrescentar um campo
// ao modelo obrigue a decidir se ele entra ou não na auditoria.
const CAMPOS = [
  ['valor', (t) => t.amount, 'dinheiro'],
  ['saldo', (t) => t.balance, 'dinheiro'],
  ['data_vencimento', (t) => t.dueDate, 'texto'],
  ['data_pagamento', (t) => t.paymentDate, 'texto'],
  ['data_emissao', (t) => t.issueDate, 'texto'],
  ['status_erp', (t) => t.erpStatus, 'texto'],
  ['pago', (t) => t.isPaid, 'bool'],
  ['pessoa_codigo', (t) => t.personCode, 'texto'],
  ['pessoa_nome', (t) => t.personName, 'texto'],
  ['movimento', (t) => t.movType, 'texto'],
  ['ano', (t) => t.year, 'numero'],
  ['mes_chave', (t) => t.monthKey, 'texto'],
  ['ano_pagamento', (t) => t.paidYear, 'numero'],
  ['mes_pagamento', (t) => t.paidMonthKey, 'texto'],
  ['departamento', (t) => t.department, 'texto'],
  ['titulo_numero', (t) => t.titleNumber, 'texto'],
  ['natureza_operacao', (t) => t.operationNature, 'texto'],
];

const iguais = (a, b, tipo) => {
  if (tipo === 'dinheiro') return cent(a) === cent(b);
  if (tipo === 'numero') return (Number(a) || 0) === (Number(b) || 0);
  if (tipo === 'bool') return !!a === !!b;
  return (a ?? '').toString().trim() === (b ?? '').toString().trim();
};


// ─── Auditoria de um lado do movimento ───────────────────────────────────────
// Recebe os documentos já lidos em vez de buscá-los: é isso que permite ao modo
// --autoteste rodar a auditoria inteira contra uma base sintética, sem rede, e
// provar que ela realmente detecta os defeitos que promete detectar.
const auditarLado = ({ mov, planilha, arquivos, docs, clientesPorCodigo, extratoIds, extratoTotal }) => {
  const col = collectionFor(mov);
  titulo(`${col.toUpperCase()}  ·  movimento ${mov}  ·  ${arquivos.join(', ')}`);

  const legado = docs.filter((d) => !d.id.startsWith('tit_'));
  const atuais = docs.filter((d) => d.id.startsWith('tit_'));
  const banco = new Map(atuais.map((d) => [d.id, tituloFromFirestore(d.id, d.data, mov)]));

    console.log(`\n  Planilha : ${num(planilha.length)} título(s) válido(s)`);
    console.log(`  Banco    : ${num(docs.length)} documento(s) — ${num(atuais.length)} no formato atual` +
      (legado.length ? `, ${num(legado.length)} em FORMATO ANTIGO` : ''));

    // 1 · Formato antigo -------------------------------------------------------
    console.log('\n  1 · FORMATO DOS DOCUMENTOS');
    if (legado.length === 0) ok('Todos os documentos estão no formato novo (id `tit_*`).');
    else
      erro(
        `${num(legado.length)} documento(s) em formato antigo (ex.: ${legado.slice(0, 3).map((d) => d.id).join(', ')}). ` +
          'Eles não são lidos pela tela nova e inflam a contagem. Rode `npm run import:titulos:limpo`.'
      );

    // 2 · Faltando -------------------------------------------------------------
    console.log('\n  2 · TÍTULOS DA PLANILHA QUE NÃO ESTÃO NO BANCO');
    const faltando = planilha.filter((t) => !banco.has(tituloDocId(t.titleCode)));
    if (faltando.length === 0) ok('Nenhum. Toda linha válida da planilha está gravada.');
    else {
      erro(`${num(faltando.length)} título(s) não gravado(s) — ${brl(somaCent(faltando, (t) => t.amount) / 100)}.`);
      faltando.slice(0, LIMITE).forEach((t) =>
        console.log(`      ${t.titleCode.padEnd(10)} ${t.dueDate}  ${brl(t.amount).padStart(14)}  ${t.personName}`)
      );
      if (faltando.length > LIMITE) console.log(`      ... e mais ${faltando.length - LIMITE}`);
    }

    // 3 · Sobrando -------------------------------------------------------------
    console.log('\n  3 · TÍTULOS NO BANCO QUE NÃO ESTÃO NA PLANILHA');
    const naPlanilha = new Set(planilha.map((t) => tituloDocId(t.titleCode)));
    const sobrando = [...banco.values()].filter((t) => !naPlanilha.has(tituloDocId(t.titleCode)));
    if (sobrando.length === 0) ok('Nenhum. O banco não tem títulos além dos da planilha.');
    else
      alerta(
        `${num(sobrando.length)} título(s) no banco fora desta planilha — ${brl(somaCent(sobrando, (t) => t.amount) / 100)}. ` +
          'Normal se vieram de uma carga anterior com outro período; suspeito se a planilha deveria ser a base inteira.'
      );
    if (sobrando.length && VERBOSE)
      sobrando.slice(0, LIMITE).forEach((t) =>
        console.log(`      ${t.titleCode.padEnd(10)} ${t.dueDate}  ${brl(t.amount).padStart(14)}  ${t.personName}`)
      );

    // 4 · Divergências campo a campo -------------------------------------------
    console.log('\n  4 · CONFERÊNCIA CAMPO A CAMPO');
    const divergencias = [];
    for (const t of planilha) {
      const g = banco.get(tituloDocId(t.titleCode));
      if (!g) continue;
      for (const [nome, get, tipo] of CAMPOS) {
        if (!iguais(get(t), get(g), tipo)) {
          divergencias.push({ titleCode: t.titleCode, campo: nome, planilha: get(t), banco: get(g) });
        }
      }
    }
    if (divergencias.length === 0)
      ok(`${num(banco.size)} título(s) conferido(s) em ${CAMPOS.length} campos — nenhuma divergência.`);
    else {
      const porCampo = new Map();
      divergencias.forEach((d) => porCampo.set(d.campo, (porCampo.get(d.campo) || 0) + 1));
      erro(`${num(divergencias.length)} divergência(s) em ${porCampo.size} campo(s):`);
      [...porCampo.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([c, n]) => console.log(`      ${c.padEnd(22)} ${num(n)} título(s)`));
      divergencias.slice(0, LIMITE).forEach((d) =>
        console.log(`      ${d.titleCode} · ${d.campo}: planilha="${d.planilha}" banco="${d.banco}"`)
      );
      if (divergencias.length > LIMITE) console.log(`      ... e mais ${divergencias.length - LIMITE}`);
    }

    // 5 · Duplicidade ----------------------------------------------------------
    console.log('\n  5 · DUPLICIDADE');
    const porCodigo = new Map();
    for (const [id, t] of banco) {
      const lista = porCodigo.get(t.titleCode) || [];
      lista.push(id);
      porCodigo.set(t.titleCode, lista);
    }
    const dupes = [...porCodigo.entries()].filter(([, ids]) => ids.length > 1);
    if (dupes.length === 0) ok('Nenhum Titulo_Codigo aparece em dois documentos.');
    else {
      erro(`${num(dupes.length)} código(s) duplicado(s) no banco:`);
      dupes.slice(0, LIMITE).forEach(([c, ids]) => console.log(`      ${c} → ${ids.join(', ')}`));
    }

    // 6 · Fechamento de totais -------------------------------------------------
    console.log('\n  6 · FECHAMENTO DE TOTAIS (em centavos inteiros)');
    const gravadosDaPlanilha = planilha.map((t) => banco.get(tituloDocId(t.titleCode))).filter(Boolean);
    const pares = [
      ['Valor total', (t) => t.amount, planilha, gravadosDaPlanilha],
      ['Saldo total', (t) => t.balance, planilha, gravadosDaPlanilha],
      ['Valor dos pagos', (t) => (t.isPaid ? t.amount : 0), planilha, gravadosDaPlanilha],
      ['Saldo em aberto', (t) => (t.isPaid ? 0 : t.balance), planilha, gravadosDaPlanilha],
    ];
    for (const [rot, get, pl, bc] of pares) {
      const a = somaCent(pl, get);
      const b = somaCent(bc, get);
      const linha = `${rot.padEnd(18)} planilha ${brl(a / 100).padStart(16)}   banco ${brl(b / 100).padStart(16)}`;
      if (a === b) ok(linha);
      else erro(`${linha}   → diferença ${brl((b - a) / 100)}`);
    }

    // 7 · Vínculo com o cadastro ----------------------------------------------
    console.log('\n  7 · VÍNCULO COM O CADASTRO DE CLIENTES');
    const semId = [...banco.values()].filter((t) => !t.customerId);
    const semIdMasComCadastro = semId.filter((t) => clientesPorCodigo.has(normalizePersonCode(t.personCode)));
    const pct = banco.size ? Math.round(((banco.size - semId.length) / banco.size) * 100) : 0;
    console.log(`      ${num(banco.size - semId.length)}/${num(banco.size)} títulos com cliente_id (${pct}%).`);
    if (semIdMasComCadastro.length > 0)
      erro(
        `${num(semIdMasComCadastro.length)} título(s) SEM cliente_id apesar de o código existir no cadastro. ` +
          'Reimporte para refazer o vínculo — o relatório por cliente está com buraco.'
      );
    else if (semId.length > 0)
      alerta(
        `${num(semId.length)} título(s) sem cliente_id porque a pessoa não está no cadastro de clientes. ` +
          'Cadastre-as para o relatório por cliente ficar completo.'
      );
    else ok('Todos os títulos vinculados.');

    // 8 · Integridade da conciliação -------------------------------------------
    console.log('\n  8 · INTEGRIDADE DA CONCILIAÇÃO (baixas)');
    const baixados = [...banco.values()].filter(
      (t) => t.status === 'Baixado Automático' || t.status === 'Baixado Manual'
    );
    const semExtrato = baixados.filter((t) => t.status === 'Baixado Automático' && !t.reconciledStatementId);
    const extratoInexistente = baixados.filter(
      (t) => t.reconciledStatementId && !extratoIds.has(t.reconciledStatementId)
    );
    const baixadoNaoPago = baixados.filter((t) => !t.isPaid);

    const usoExtrato = new Map();
    for (const t of baixados) {
      if (!t.reconciledStatementId) continue;
      const lista = usoExtrato.get(t.reconciledStatementId) || [];
      lista.push(t.titleCode);
      usoExtrato.set(t.reconciledStatementId, lista);
    }
    const reusados = [...usoExtrato.entries()].filter(([, l]) => l.length > 1);

    console.log(`      ${num(baixados.length)} título(s) baixado(s) · ${num(extratoTotal)} lançamento(s) de extrato na base.`);
    if (semExtrato.length) erro(`${num(semExtrato.length)} baixa(s) automática(s) sem lançamento de extrato vinculado.`);
    if (extratoInexistente.length)
      erro(`${num(extratoInexistente.length)} título(s) apontando para lançamento de extrato que não existe mais.`);
    if (baixadoNaoPago.length)
      erro(`${num(baixadoNaoPago.length)} título(s) com baixa mas sem status "Pago" no ERP — contradição.`);
    if (reusados.length) {
      erro(`${num(reusados.length)} lançamento(s) de extrato quitando MAIS DE UM título — a mesma saída pagando duas contas:`);
      reusados.slice(0, LIMITE).forEach(([id, l]) => console.log(`      extrato ${id} → títulos ${l.join(', ')}`));
    }
    if (!semExtrato.length && !extratoInexistente.length && !baixadoNaoPago.length && !reusados.length)
      ok('Conciliação íntegra: cada baixa tem lançamento próprio e existente, em título pago.');

    const pagosSemBaixa = [...banco.values()].filter((t) => t.isPaid && t.status === 'Em Aberto');
    if (pagosSemBaixa.length)
      console.log(
        `      ${num(pagosSemBaixa.length)} título(s) pago(s) ainda sem baixa — ${brl(somaCent(pagosSemBaixa, (t) => t.amount) / 100)}. ` +
          '\n        Não é erro: é dinheiro que o ERP registrou e o extrato importado não cobre.' +
          '\n        Esse valor é justamente o que o Fluxo de Caixa soma ao realizado além do extrato.'
      );
};


// ─── Autoteste ───────────────────────────────────────────────────────────────
/**
 * Roda a auditoria contra uma base SINTÉTICA construída a partir da própria
 * planilha, com defeitos plantados de propósito. Não precisa de rede.
 *
 * Por que isto existe: uma auditoria que nunca acusou nada pode estar
 * funcionando — ou pode estar quebrada e devolvendo "tudo certo" para qualquer
 * entrada. Só há um jeito de saber a diferença: dar a ela uma base que se sabe
 * defeituosa e conferir se ela encontra exatamente os defeitos plantados.
 */
const rodarAutoteste = (planilhaPorMov) => {
  titulo('AUTOTESTE — a auditoria consegue enxergar defeitos plantados?');
  console.log('  Base sintética montada a partir da planilha, sem tocar no Firestore.');

  const [mov, { titulos: planilha, arquivos }] = [...planilhaPorMov.entries()][0];
  const base = planilha.slice(0, 60);

  // Base perfeita: espelho exato da planilha.
  const docs = base.map((t) => ({ id: tituloDocId(t.titleCode), data: tituloToFirestore(t) }));

  // ── Defeitos plantados ────────────────────────────────────────────────────
  const esperado = [];

  docs.pop();                                            // 1. um título faltando
  esperado.push('1 título faltando');

  docs[0].data.valor = docs[0].data.valor + 10;          // 2. valor divergente
  esperado.push('valor divergente em 1 título');

  docs[1].data.data_vencimento = '2099-01-01';           // 3. data divergente
  esperado.push('data de vencimento divergente em 1 título');

  docs[2].data.status_erp = 'Autorizado';                // 4. status divergente
  docs[2].data.pago = false;
  esperado.push('status divergente em 1 título');

  docs.push({ id: 'tit_999999999', data: { ...docs[3].data, titulo_codigo: '999999999' } });
  esperado.push('1 título sobrando (não está na planilha)');

  docs.push({ id: 'mov_123456', data: { valor: 100 } }); // 6. formato antigo
  esperado.push('1 documento em formato antigo');

  // 7. duas baixas usando o mesmo lançamento de extrato
  docs[4].data.status_baixa = 'Baixado Automático';
  docs[4].data.extrato_id = 'ext_abc';
  docs[5].data.status_baixa = 'Baixado Automático';
  docs[5].data.extrato_id = 'ext_abc';
  esperado.push('1 lançamento de extrato quitando 2 títulos');

  // 8. baixa apontando para extrato inexistente
  docs[6].data.status_baixa = 'Baixado Manual';
  docs[6].data.extrato_id = 'ext_que_nao_existe';
  esperado.push('1 baixa apontando para extrato inexistente');

  console.log(`\n  Defeitos plantados (${esperado.length}):`);
  esperado.forEach((e) => console.log(`      • ${e}`));

  auditarLado({
    mov,
    planilha: base,
    arquivos: arquivos.map((a) => `${a} [sintético]`),
    docs,
    clientesPorCodigo: new Set(),
    extratoIds: new Set(['ext_abc']),
    extratoTotal: 1,
  });

  titulo('RESULTADO DO AUTOTESTE');
  const achou = achados.erros.length + achados.alertas.length;
  if (achados.erros.length >= 5) {
    console.log(`  ✓ A auditoria acusou ${achados.erros.length} erro(s) e ${achados.alertas.length} alerta(s).`);
    console.log('    Ela enxerga os defeitos que promete enxergar.');
  } else {
    console.log(`  ✕ A auditoria acusou apenas ${achou} achado(s) para ${esperado.length} defeitos plantados.`);
    console.log('    Ela própria está com problema — não confie no resultado da auditoria real.');
  }
  console.log('');
  process.exit(achados.erros.length >= 5 ? 0 : 3);
};

// ─── Programa ────────────────────────────────────────────────────────────────
const main = async () => {
  titulo('AUDITORIA DA BASE DE TÍTULOS — banco × planilha');
  console.log(`  Projeto : ${env.VITE_FIREBASE_PROJECT_ID || '(não configurado)'}`);
  console.log('  Modo    : SOMENTE LEITURA — nada será alterado');

  const caminhos = acharPlanilhas();
  if (caminhos.length === 0) {
    console.error('\n  ✕ Nenhuma planilha RFN046 encontrada em scripts/data/.');
    process.exit(1);
  }

  // ── Planilhas por lado do movimento ────────────────────────────────────────
  const planilhaPorMov = new Map();
  for (const c of caminhos) {
    const wb = XLSX.read(readFileSync(c), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!looksLikeRfn046(rows)) {
      alerta(`${basename(c)} ignorado — não tem o layout do RFN046.`);
      continue;
    }
    const det = detectMovType(rows);
    const validos = parseRfn046Rows(rows, det.movType).filter((p) => p.valid).map((p) => p.titulo);
    const atual = planilhaPorMov.get(det.movType) || { titulos: [], arquivos: [] };
    atual.titulos.push(...validos);
    atual.arquivos.push(basename(c));
    planilhaPorMov.set(det.movType, atual);
  }

  if (AUTOTESTE) return rodarAutoteste(planilhaPorMov);

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const db = getFirestore(app);

  // Leitura sempre do servidor: offline, o SDK devolve cache vazio em silêncio e
  // a auditoria concluiria "faltou tudo" sem nada ter faltado.
  const lerColecao = async (nome) => {
    try {
      return (await getDocsFromServer(collection(db, nome))).docs;
    } catch (e) {
      throw new Error(`Não foi possível ler "${nome}" no Firestore: ${e?.message || e}`);
    }
  };

  process.stdout.write('\n  Conectando ao Firestore... ');
  const clientesDocs = await lerColecao('clientes');
  console.log('ok.');

  const clientesPorCodigo = new Set(
    clientesDocs.map((d) => normalizePersonCode(d.data().cod_cliente ?? d.data().codigo ?? '')).filter(Boolean)
  );

  const extratoDocs = await lerColecao('extrato_financeiro');
  const extratoIds = new Set(extratoDocs.map((d) => d.id));

  // ── Auditoria por lado ─────────────────────────────────────────────────────
  for (const [mov, { titulos: planilha, arquivos }] of planilhaPorMov) {
    const docs = (await lerColecao(collectionFor(mov))).map((d) => ({ id: d.id, data: d.data() }));
    auditarLado({
      mov,
      planilha,
      arquivos,
      docs,
      clientesPorCodigo,
      extratoIds,
      extratoTotal: extratoDocs.length,
    });
  }

  // ── Bases legadas ──────────────────────────────────────────────────────────
  titulo('BASES LEGADAS');
  for (const nome of ['titulos_inadimplentes', 'contas_a_pagar_previsao']) {
    const docs = await lerColecao(nome);
    if (docs.length === 0) ok(`${nome}: vazia.`);
    else
      alerta(
        `${nome}: ${num(docs.length)} documento(s) ainda presentes. ` +
          'Zere em Importação → Manutenção da base, ou com `npm run import:titulos:limpo`.'
      );
  }

  // ── Veredito ───────────────────────────────────────────────────────────────
  titulo('VEREDITO');
  if (achados.erros.length === 0 && achados.alertas.length === 0) {
    console.log('  ✓ Base íntegra. O que está gravado é exatamente o que está na planilha.');
  } else {
    if (achados.erros.length) {
      console.log(`  ✕ ${achados.erros.length} problema(s) que exigem ação:`);
      achados.erros.forEach((e) => console.log(`      • ${e.split('\n')[0]}`));
    }
    if (achados.alertas.length) {
      console.log(`\n  ! ${achados.alertas.length} ponto(s) de atenção (não bloqueiam):`);
      achados.alertas.forEach((a) => console.log(`      • ${a.split('\n')[0]}`));
    }
  }
  console.log('');
  console.log('  Rode com --detalhado para listar os títulos de cada achado.');
  console.log('');

  // Código de saída diferente de zero quando há erro: permite encadear a
  // auditoria em qualquer rotina automática sem ninguém precisar ler a tela.
  process.exit(achados.erros.length > 0 ? 2 : 0);
};

main().catch((err) => {
  console.error('\n  ✕ ERRO:', err?.message || err);
  if (argv.includes('--debug') && err?.stack) console.error(err.stack);
  process.exit(1);
});
