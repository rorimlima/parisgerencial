/**
 * testMovimentoDiario.mjs — Testa o motor do Movimento Diário.
 *
 *     npm run test:diario
 *
 * Não precisa de rede nem de Firebase: carrega `src/utils/dailyLedger.ts` e
 * exercita as regras contra títulos construídos à mão. Os casos foram
 * escolhidos pelos lugares onde este tipo de relatório costuma mentir:
 *
 *   • título que o ERP diz "pago" mas que ninguém baixou (não pode somar);
 *   • baixa sem data de pagamento (não tem dia para cair);
 *   • data inválida no calendário ('2026-02-30' — o `new Date` aceita calado);
 *   • intervalo invertido e intervalo gigante (denial of service na tela);
 *   • pagamento parcial (o que andou é a diferença, não o valor do título);
 *   • resíduo de ponto flutuante somando muitos centavos;
 *   • injeção de fórmula vinda do cadastro do ERP para dentro do Excel;
 *   • caractere bidirecional escondido no nome do fornecedor.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const tsCache = new Map();
const SOMENTE_NAVEGADOR = new Set(['jspdf', 'jspdf-autotable', 'html2canvas', 'react', 'lucide-react']);
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

const D = loadTs('src/utils/dailyLedger.ts');

let passou = 0;
let falhou = 0;
const eq = (nome, obtido, esperado) => {
  const okay = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (okay) {
    passou += 1;
    console.log(`  ✓ ${nome}`);
  } else {
    falhou += 1;
    console.log(`  ✕ ${nome}\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(obtido)}`);
  }
};
const secao = (t) => {
  console.log('');
  console.log('─'.repeat(72));
  console.log(`  ${t}`);
  console.log('─'.repeat(72));
};

/** Fábrica de título com valores padrão sensatos. */
let seq = 0;
const titulo = (p = {}) => {
  seq += 1;
  return {
    id: `t${seq}`,
    dedupeKey: `K${seq}`,
    titleCode: `C${seq}`,
    movType: 'P',
    companyCode: '1',
    companyName: 'PARIS DAKAR',
    titleNumber: `NF${seq}`,
    parcela: '1/1',
    titleType: 'DUPLICATA',
    personCode: `P${seq}`,
    personName: `FORNECEDOR ${seq}`,
    issueDate: '2026-07-01',
    entryDate: '2026-07-01',
    dueDate: '2026-07-10',
    paymentDate: '2026-07-10',
    year: 2026,
    monthKey: 'jul',
    paidYear: 2026,
    paidMonthKey: 'jul',
    amount: 1000,
    balance: 0,
    penaltyAmount: 0,
    erpStatus: 'Pago',
    isPaid: true,
    invoiceCode: '',
    fiscalNoteCode: '',
    linkedFiscalNoteCode: '',
    nossoNumero: '',
    observation: '',
    managementAccount: '',
    launchClass: '',
    departmentCode: '',
    department: '',
    batchCode: '',
    batchDescription: '',
    collectionAgentCode: '',
    collectionAgent: 'BRADESCO',
    collectionTypeCode: '',
    collectionType: '',
    operationNatureCode: '',
    operationNature: '',
    status: 'Baixado Automático',
    ...p,
  };
};

const julho = D.clampRange('2026-07-01', '2026-07-31', { year: 2026, month: 7 });

// ─── Validação de data ───────────────────────────────────────────────────────
secao('VALIDAÇÃO DE DATA (o calendário de verdade, não só o formato)');
eq('data normal', D.isIsoDate('2026-07-15'), true);
eq('31 de fevereiro é rejeitado', D.isIsoDate('2026-02-30'), false);
eq('29/02 em ano comum é rejeitado', D.isIsoDate('2026-02-29'), false);
eq('29/02 em ano bissexto é aceito', D.isIsoDate('2024-02-29'), true);
eq('mês 13 é rejeitado', D.isIsoDate('2026-13-01'), false);
eq('dia 00 é rejeitado', D.isIsoDate('2026-07-00'), false);
eq('formato brasileiro é rejeitado', D.isIsoDate('15/07/2026'), false);
eq('ano fora da faixa é rejeitado', D.isIsoDate('1899-01-01'), false);
eq('número não é data', D.isIsoDate(20260715), false);
eq('objeto não é data', D.isIsoDate({}), false);
eq('null não é data', D.isIsoDate(null), false);
eq('data com hora é rejeitada', D.isIsoDate('2026-07-15T10:00:00'), false);

// ─── Intervalo com teto ──────────────────────────────────────────────────────
secao('INTERVALO: inversão, lixo e teto de dias');
eq('julho inteiro tem 31 dias', julho.days, 31);
const invertido = D.clampRange('2026-07-31', '2026-07-01', { year: 2026, month: 7 });
eq('datas invertidas são trocadas', [invertido.start, invertido.end, invertido.swapped], ['2026-07-01', '2026-07-31', true]);
const lixo = D.clampRange('<script>', '', { year: 2026, month: 2 });
eq('lixo cai no mês de referência', [lixo.start, lixo.end], ['2026-02-01', '2026-02-28']);
const gigante = D.clampRange('2000-01-01', '2100-12-31', { year: 2026, month: 7 });
eq('intervalo gigante é limitado', [gigante.days, gigante.truncated], [D.MAX_RANGE_DAYS, true]);
eq('limite não deixa passar do teto', gigante.days <= D.MAX_RANGE_DAYS, true);
eq('um dia só conta como 1', D.clampRange('2026-07-10', '2026-07-10', { year: 2026, month: 7 }).days, 1);
eq('virada de ano conta certo', D.daysBetweenInclusive('2025-12-30', '2026-01-02'), 4);
eq('virada do horário de verão não perde dia', D.daysBetweenInclusive('2026-10-17', '2026-10-19'), 3);

// ─── A regra da baixa ────────────────────────────────────────────────────────
secao('REGRA DA BAIXA: sem baixa não contabiliza');
eq('baixado automático + data = conta', D.isSettled(titulo()), true);
eq('baixado manual + data = conta', D.isSettled(titulo({ status: 'Baixado Manual' })), true);
eq('ERP pago mas EM ABERTO não conta', D.isSettled(titulo({ status: 'Em Aberto' })), false);
eq('CONFERIR não conta', D.isSettled(titulo({ status: 'Conferir' })), false);
eq('baixado sem data de pagamento não conta', D.isSettled(titulo({ paymentDate: '' })), false);
eq('baixado com data inválida não conta', D.isSettled(titulo({ paymentDate: '2026-02-30' })), false);
eq('em aberto pago no ERP vira pendência', D.isPendingSettlement(titulo({ status: 'Em Aberto' })), true);
eq('conferir vira pendência', D.isPendingSettlement(titulo({ status: 'Conferir' })), true);
eq('baixado não é pendência', D.isPendingSettlement(titulo()), false);

// ─── Valor movimentado ───────────────────────────────────────────────────────
secao('VALOR MOVIMENTADO (quitação total, parcial e base inconsistente)');
eq('quitado: valor cheio', D.settledAmount(titulo({ amount: 1000, balance: 0 })), 1000);
eq('parcial: valor menos saldo', D.settledAmount(titulo({ amount: 1000, balance: 300 })), 700);
eq('parcial é sinalizado', D.isPartial(titulo({ amount: 1000, balance: 300 })), true);
eq('quitado não é parcial', D.isPartial(titulo({ amount: 1000, balance: 0 })), false);
eq('saldo igual ao valor: base inconsistente, vale o cheio', D.settledAmount(titulo({ amount: 1000, balance: 1000 })), 1000);
eq('valor zero não movimenta', D.settledAmount(titulo({ amount: 0 })), 0);
eq('valor negativo não movimenta', D.settledAmount(titulo({ amount: -50 })), 0);
eq('centavos: 0,79 sobrevive', D.settledAmount(titulo({ amount: 426610.79, balance: 0 })), 426610.79);

// ─── Agregação por dia ───────────────────────────────────────────────────────
secao('AGREGAÇÃO POR DIA');
const receber = [
  titulo({ movType: 'R', paymentDate: '2026-07-01', amount: 1500 }),
  titulo({ movType: 'R', paymentDate: '2026-07-01', amount: 500 }),
  titulo({ movType: 'R', paymentDate: '2026-07-15', amount: 2000 }),
  titulo({ movType: 'R', paymentDate: '2026-07-20', amount: 999, status: 'Em Aberto' }), // não conta
  titulo({ movType: 'R', paymentDate: '2026-08-05', amount: 777 }),                      // fora do período
];
const pagar = [
  titulo({ movType: 'P', paymentDate: '2026-07-01', amount: 300 }),
  titulo({ movType: 'P', paymentDate: '2026-07-15', amount: 2500 }),
  titulo({ movType: 'P', paymentDate: '2026-07-15', amount: 100, balance: 40 }),          // parcial: 60
];
const L = D.buildDailyLedger(receber, pagar, julho);

eq('uma linha por dia do mês', L.rows.length, 31);
eq('dia 01 recebeu 2.000', L.rows[0].receber.total, 2000);
eq('dia 01 pagou 300', L.rows[0].pagar.total, 300);
eq('dia 01 saldo 1.700', L.rows[0].net, 1700);
eq('dia 02 é zerado', [L.rows[1].receber.total, L.rows[1].pagar.total], [0, 0]);
eq('dia 15 pagou 2.560 (parcial contado como 60)', L.rows[14].pagar.total, 2560);
eq('total recebido do período', L.receber.total, 4000);
eq('total pago do período', L.pagar.total, 2860);
eq('saldo do período', L.net, 1140);
eq('acumulado no último dia = saldo do período', L.rows[30].accumulated, 1140);
eq('dias com movimento', L.activeDays, 2);
eq('título em aberto virou pendência, não total', L.pendenteReceber.total, 999);
eq('título de agosto ficou fora do período', L.foraDoPeriodo.receber, 1);
eq('quantidade de baixas contadas', [L.receber.count, L.pagar.count], [3, 3]);

const semVazios = D.buildDailyLedger(receber, pagar, julho, { hideEmptyDays: true });
eq('ocultar dias sem movimento deixa só 2 linhas', semVazios.rows.length, 2);
eq('ocultar dias não altera o total', semVazios.net, L.net);

const filtrado = D.buildDailyLedger(receber, pagar, julho, { search: 'BRADESCO' });
eq('busca por agente mantém tudo', filtrado.receber.count, 3);
const filtradoNada = D.buildDailyLedger(receber, pagar, julho, { search: 'INEXISTENTE' });
eq('busca sem resultado zera os totais', [filtradoNada.receber.total, filtradoNada.pagar.total], [0, 0]);

// ─── Precisão em base grande ─────────────────────────────────────────────────
secao('PRECISÃO MONETÁRIA EM VOLUME');
const muitos = Array.from({ length: 1000 }, () => titulo({ movType: 'R', paymentDate: '2026-07-10', amount: 0.79 }));
const LP = D.buildDailyLedger(muitos, [], julho);
eq('mil títulos de 0,79 somam exatamente 790', LP.receber.total, 790);
const centavos = Array.from({ length: 3 }, () => titulo({ movType: 'R', paymentDate: '2026-07-10', amount: 0.1 }));
eq('0,1 + 0,1 + 0,1 = 0,3 (não 0,30000000000000004)', D.buildDailyLedger(centavos, [], julho).receber.total, 0.3);

// ─── Higienização e injeção ──────────────────────────────────────────────────
secao('SEGURANÇA: injeção de fórmula e caracteres escondidos');
eq('fórmula do Excel é neutralizada', D.csvSafe('=HYPERLINK("http://mal.co","x")'), "'=HYPERLINK(\"http://mal.co\",\"x\")");
eq('+ também é fórmula', D.csvSafe('+1+1'), "'+1+1");
eq('- também é fórmula', D.csvSafe('-2+3'), "'-2+3");
eq('@ também é fórmula', D.csvSafe('@SUM(A1)'), "'@SUM(A1)");
eq('texto normal passa intacto', D.csvSafe('AUTO PECAS LTDA'), 'AUTO PECAS LTDA');
eq('caractere bidirecional é removido', D.safeText('FORNECEDOR‮ABC'), 'FORNECEDORABC');
eq('zero-width é removido', D.safeText('AUTO​PECAS'), 'AUTOPECAS');
eq('quebra de linha vira espaço', D.safeText('LINHA1\nLINHA2'), 'LINHA1 LINHA2');
eq('NUL vira espaço e some', D.safeText('A B'), 'A B');
eq('texto longo é truncado', D.safeText('X'.repeat(300), 20).length, 20);
eq('null vira string vazia', D.safeText(null), '');

const linhaComVeneno = D.toDetailSheetRows([
  ...D.flattenEntries(D.buildDailyLedger([titulo({ movType: 'R', personName: '=cmd|calc' })], [], julho).rows, 'receber'),
]);
eq('nome venenoso sai neutralizado na planilha', linhaComVeneno[0].Pessoa, "'=cmd|calc");

// ─── Concentração por pessoa ─────────────────────────────────────────────────
secao('CONCENTRAÇÃO POR PESSOA');
const mesmaPessoa = [
  titulo({ movType: 'R', paymentDate: '2026-07-01', amount: 600, personCode: 'X1', personName: 'CLIENTE A' }),
  titulo({ movType: 'R', paymentDate: '2026-07-05', amount: 400, personCode: 'X1', personName: 'CLIENTE A.' }),
  titulo({ movType: 'R', paymentDate: '2026-07-06', amount: 1000, personCode: 'X2', personName: 'CLIENTE B' }),
];
const roll = D.rollupByPerson(D.buildDailyLedger(mesmaPessoa, [], julho).rows, 'receber');
eq('agrupa pelo código, não pelo nome', roll.length, 2);
eq('soma do agrupado', roll.find((p) => p.code === 'X1').total, 1000);
eq('participação percentual', roll.find((p) => p.code === 'X1').share, 50);

// ─── Casos degenerados ───────────────────────────────────────────────────────
secao('ENTRADA DEGENERADA (não pode explodir)');
eq('listas vazias', D.buildDailyLedger([], [], julho).net, 0);
eq('null no lugar da lista', D.buildDailyLedger(null, undefined, julho).net, 0);
eq('item null dentro da lista', D.buildDailyLedger([null, titulo({ movType: 'R' })], [], julho).receber.count, 1);
eq('mês de fevereiro bissexto tem 29 linhas', D.buildDailyLedger([], [], D.clampRange('2024-02-01', '2024-02-29', { year: 2024, month: 2 })).rows.length, 29);
eq('mês de referência de fevereiro comum', D.monthRange(2026, 2).end, '2026-02-28');
eq('mês fora da faixa é clampado', D.monthRange(2026, 99).start, '2026-12-01');

// ─── Resultado ───────────────────────────────────────────────────────────────
console.log('');
console.log('─'.repeat(72));
console.log(`  ${passou} passou · ${falhou} falhou`);
console.log('─'.repeat(72));
process.exit(falhou > 0 ? 1 : 0);
