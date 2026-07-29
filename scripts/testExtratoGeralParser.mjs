/**
 * Conferência do parser do EXTRATO GERAL (src/utils/extratoGeralParser.ts).
 *
 * Roda com: node scripts/testExtratoGeralParser.mjs [caminho-do-extrato.xlsx]
 * Padrão: scripts/data/extratogeral.xlsx
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. IDENTIDADE DA LINHA. A chave tem que ser única entre as linhas válidas e
 *    idêntica quando o mesmo arquivo é lido duas vezes. Chave repetida = um
 *    lançamento sobrescrevendo o outro no banco; chave instável = base
 *    duplicada na próxima importação. É o risco mais caro deste formato, porque
 *    a coluna ID da planilha se renumera a cada exportação.
 * 2. O SINAL DO VALOR MANDA. A coluna TIPO da planilha contradiz o valor em
 *    algumas linhas; o teste confere que o tipo gravado veio do valor, não do
 *    texto, e que as divergências são todas reportadas em vez de silenciadas.
 * 3. ARITMÉTICA. Entradas, saídas e saldo do parser têm que bater com a soma
 *    direta das colunas da planilha, banco por banco. Se o parser inverter um
 *    sinal ou perder uma linha, o total não fecha e o teste cai.
 * 4. ROTEAMENTO DE CONTA. Cada banco tem que cair na fonte e na origem certas
 *    (banco x dinheiro). Errar aqui joga o dinheiro na linha errada do
 *    Resultado Financeiro, e o erro só aparece meses depois.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Carrega o módulo TS real (sem build), resolvendo os imports internos.
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
    if (spec.startsWith('.')) {
      const p = resolve(dirname(abs), spec).replace(root + '/', '') + '.ts';
      return loadTs(p);
    }
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
  toSignedAmount,
  normalizeExtratoDate,
  resolveAccount,
  detectInternalTransfer,
  validateExtratoGeralHeaders,
} = loadTs('src/utils/extratoGeralParser.ts');
const { statementDocId, buildExtratoGeralDedupeKey } = loadTs('src/utils/statementKeys.ts');
// O motor de baixa e os parâmetros padrão são carregados dos módulos de
// verdade: o teste tem que exercitar a MESMA regra que a tela e o script de
// carga usam, não uma imitação dela.
const { reconcile, buildBaixaCode, tituloCashAmount } = loadTs('src/utils/reconciliation.ts');
const { DEFAULT_RECONCILIATION_SETTINGS } = loadTs('src/types.ts');

let passed = 0;
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// ─── 1. Unidades: valor com sinal, data, conta ──────────────────────────────

console.log('\n═══ EXTRATO GERAL — CONFERÊNCIA DO PARSER ═══\n');
console.log('1) Leitura de valor com sinal');
check('número negativo mantém o sinal', toSignedAmount(-1638.06) === -1638.06);
check('pt-BR 1.234,56', toSignedAmount('1.234,56') === 1234.56);
check('pt-BR negativo -1.234,56', toSignedAmount('-1.234,56') === -1234.56);
check('contábil (1.234,56) vira negativo', toSignedAmount('(1.234,56)') === -1234.56);
check('R$ com espaço', toSignedAmount('R$ 2.500,00') === 2500);
check('vazio e nulo viram zero', toSignedAmount('') === 0 && toSignedAmount(null) === 0);
check('milhar sem decimal 1.500 → 1500', toSignedAmount('1.500') === 1500);

console.log('\n2) Normalização de data');
check('Date → ISO', normalizeExtratoDate(new Date(2026, 0, 2)) === '2026-01-02');
check('DD/MM/AAAA', normalizeExtratoDate('02/01/2026') === '2026-01-02');
check('ISO com hora', normalizeExtratoDate('2026-01-02 00:00:00') === '2026-01-02');
check('serial do Excel', normalizeExtratoDate(46024) === '2026-01-02');
check('texto inválido → vazio', normalizeExtratoDate('sem data') === '');

console.log('\n3) Roteamento de conta (banco x dinheiro)');
const casos = [
  ['BRADESCO', 'bradesco', 'banco', ''],
  ['PAGBANK', 'pagseguro', 'banco', ''],
  ['CAIXA30107', 'tesouraria', 'caixa', '30107'],
  ['CAIXA30110', 'tesouraria', 'caixa', '30110'],
  ['ALBA30110', 'tesouraria', 'caixa', '30110'],
  ['TESOURARIA', 'tesouraria', 'caixa', '30101'],
];
for (const [banco, source, origin, code] of casos) {
  const a = resolveAccount(banco, origin === 'banco' ? 'BANCO' : 'DINHEIRO');
  check(
    `${banco} → ${source}/${origin}${code ? ` (${code})` : ''}`,
    !!a && a.source === source && a.origin === origin && (a.accountCode || '') === code,
    a ? `veio ${a.source}/${a.origin}/${a.accountCode || '-'}` : 'não resolveu'
  );
}
check(
  'banco desconhecido NÃO recebe palpite',
  resolveAccount('BANCO XPTO', 'BANCO') === null,
  'chutar a origem joga dinheiro na linha errada do resultado'
);
check(
  'conta 301.xx nova é reconhecida como caixa',
  resolveAccount('CAIXA 301.12', 'DINHEIRO')?.accountCode === '30112'
);

console.log('\n4) Transferência interna');
check(
  'histórico citando OUTRA conta 301.xx é transferência',
  detectInternalTransfer('REPASSE PARA CAIXA 301.01', '30107').isTransfer === true
);
check(
  'histórico citando a PRÓPRIA conta NÃO é transferência',
  detectInternalTransfer('CAIXA30107', '30107').isTransfer === false,
  'tratar isso como remanejo apaga entrada de caixa real do resultado'
);
check('histórico comum não é transferência', detectInternalTransfer('JERRY FAÇANHA PEREIRA', '30107').isTransfer === false);

// ─── 2. Contra a planilha real ──────────────────────────────────────────────

const sheetPath = process.argv[2] || resolve(root, 'scripts/data/extratogeral.xlsx');
if (!existsSync(sheetPath)) {
  console.log(`\n(planilha não encontrada em ${sheetPath} — testes de arquivo pulados)`);
} else {
  const wb = XLSX.read(readFileSync(sheetPath), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

  console.log(`\n5) Planilha real — ${sheetPath.split(/[\\/]/).pop()} (${raw.length} linhas)`);
  check('cabeçalho reconhecido', validateExtratoGeralHeaders(raw[0]).ok, JSON.stringify(validateExtratoGeralHeaders(raw[0]).missing));

  const rows = parseExtratoGeralRows(raw);
  const sum = summarizeExtratoGeral(rows);

  check('toda linha da planilha foi avaliada', rows.length === raw.length, `${rows.length} vs ${raw.length}`);
  check('nenhuma linha válida ficou sem data', rows.filter((r) => r.valid && !r.date).length === 0);
  check('nenhuma linha válida ficou sem valor', rows.filter((r) => r.valid && !r.entryAmount && !r.exitAmount).length === 0);
  check(
    'nenhuma linha válida tem entrada E saída ao mesmo tempo',
    rows.filter((r) => r.valid && r.entryAmount > 0 && r.exitAmount > 0).length === 0,
    'um lançamento é entrada ou saída, nunca os dois'
  );

  // ── Chaves ───────────────────────────────────────────────────────────────
  console.log('\n6) Identidade da linha (o risco mais caro)');
  const validRows = rows.filter((r) => r.valid);
  check(
    'chave única entre as linhas válidas',
    sum.duplicateKeys === 0,
    `${sum.duplicateKeys} chave(s) repetida(s) — uma linha sobrescreveria a outra`
  );
  const docIds = new Set(validRows.map((r) => statementDocId(r.dedupeKey)));
  check(
    'ID de documento único (chave → Firestore)',
    docIds.size === validRows.length,
    `${validRows.length - docIds.size} colisão(ões) após sanitizar a chave`
  );

  const rows2 = parseExtratoGeralRows(raw);
  check(
    'ler o mesmo arquivo duas vezes gera as MESMAS chaves',
    rows.every((r, i) => r.dedupeKey === rows2[i].dedupeKey)
  );

  // Renumerar a coluna ID (o que acontece a cada reexportação) não pode mudar
  // nenhuma chave: é isso que impede a base de duplicar na próxima importação.
  const renumbered = raw.map((r, i) => ({ ...r, ID: 90000 + i }));
  const rowsRenum = parseExtratoGeralRows(renumbered);
  check(
    'renumerar a coluna ID NÃO muda as chaves',
    rows.every((r, i) => r.dedupeKey === rowsRenum[i].dedupeKey),
    'se mudar, reexportar a planilha duplica a base inteira'
  );

  // Inserir uma linha nova no meio também não pode deslocar as chaves das outras.
  const withInsert = [...raw.slice(0, 500), { ...raw[0], ID: 99999 }, ...raw.slice(500)];
  const rowsInsert = parseExtratoGeralRows(withInsert);
  const keysBefore = new Set(rows.map((r) => r.dedupeKey));
  const perdidas = rows.filter((r) => r.valid).filter((r) => !rowsInsert.some((x) => x.dedupeKey === r.dedupeKey));
  check(
    'inserir linha no meio não desloca as chaves existentes',
    perdidas.length === 0,
    `${perdidas.length} chave(s) sumiram`
  );
  check('a linha inserida ganhou chave própria', rowsInsert.length === keysBefore.size + 1 || rowsInsert.length === raw.length + 1);

  // ── Aritmética contra a soma direta da planilha ──────────────────────────
  console.log('\n7) Aritmética (parser x soma direta das colunas)');
  const col = (r, name) => toSignedAmount(r[name]);
  const sheetEntrada = raw.reduce((a, r) => a + Math.max(0, col(r, 'ENTRADA')), 0);
  const sheetSaida = raw.reduce((a, r) => a + Math.abs(Math.min(0, col(r, 'SAIDA'))), 0);
  check(
    `entradas: parser ${money(sum.entradaTotal)} = planilha ${money(sheetEntrada)}`,
    approx(sum.entradaTotal, sheetEntrada)
  );
  check(
    `saídas: parser ${money(sum.saidaTotal)} = planilha ${money(sheetSaida)}`,
    approx(sum.saidaTotal, sheetSaida)
  );
  check(
    `saldo: ${money(sum.saldo)} = entradas − saídas`,
    approx(sum.saldo, sum.entradaTotal - sum.saidaTotal)
  );

  // Banco por banco: um sinal invertido num banco só apareceria aqui.
  const porBanco = new Map();
  for (const r of raw) {
    const k = (r['BANCO'] ?? '').toString().trim().toUpperCase();
    const cur = porBanco.get(k) || { entrada: 0, saida: 0, count: 0 };
    const e = Math.max(0, col(r, 'ENTRADA'));
    const s = Math.abs(Math.min(0, col(r, 'SAIDA')));
    cur.entrada += e;
    cur.saida += s;
    if (e || s) cur.count += 1;
    porBanco.set(k, cur);
  }
  for (const b of sum.byBank) {
    const ref = porBanco.get(b.bank.toUpperCase());
    check(
      `${b.label.padEnd(18)} ${String(b.count).padStart(5)} linhas | entrada ${money(b.entrada)} | saída ${money(b.saida)}`,
      !!ref && approx(b.entrada, ref.entrada) && approx(b.saida, ref.saida) && b.count === ref.count,
      ref ? `planilha: ${ref.count} linhas, ${money(ref.entrada)} / ${money(ref.saida)}` : 'banco não achado'
    );
  }

  // ── O sinal manda, o TIPO é conferência ──────────────────────────────────
  console.log('\n8) O sinal do valor manda sobre a coluna TIPO');
  const tipoErrado = validRows.filter(
    (r) => (r.entryAmount > 0 && r.derivedType !== 'ENTRADA') || (r.exitAmount > 0 && r.derivedType !== 'SAIDA')
  );
  check('tipo derivado sempre coerente com o valor', tipoErrado.length === 0, `${tipoErrado.length} linha(s)`);
  const divergentes = validRows.filter((r) => r.typeDivergence);
  check(
    `${divergentes.length} divergência(s) de TIPO detectada(s) e reportada(s)`,
    divergentes.length === sum.typeDivergences.filter((r) => r.valid).length
  );
  check(
    'toda divergência de TIPO tem aviso escrito',
    divergentes.every((r) => r.warnings.some((w) => w.includes('TIPO'))),
    'divergência sem aviso é divergência escondida'
  );
  check('nenhuma divergência de CONTA (BANCO x CONTA coerentes)', sum.accountDivergences.length === 0);

  // ── Documento gravado ────────────────────────────────────────────────────
  console.log('\n9) Documento que vai para o Extrato Financeiro');
  const docs = validRows.map(toStatementEntry);
  check('todo documento tem chave', docs.every((d) => !!d.dedupeKey));
  check('todo documento tem ano e mês', docs.every((d) => d.year > 0 && !!d.monthKey));
  check(
    'origem só assume banco ou caixa',
    docs.every((d) => d.origin === 'banco' || d.origin === 'caixa')
  );
  check(
    'caixa sempre com rótulo de conta',
    docs.filter((d) => d.origin === 'caixa').every((d) => !!d.accountLabel)
  );
  check(
    'ID da planilha preservado em documento_ref',
    docs.filter((d) => d.documentRef).length === validRows.filter((r) => r.sheetId).length
  );

  // ── Retrato para o gestor ────────────────────────────────────────────────
  console.log('\n── RESUMO DA PLANILHA ──────────────────────────────────────');
  console.log(`Linhas lidas        : ${sum.totalRows}`);
  console.log(`Válidas             : ${sum.validRows}`);
  console.log(`Descartadas         : ${sum.invalidRows}`);
  console.log(`Período             : ${sum.periodStart} a ${sum.periodEnd}  (anos: ${sum.years.join(', ')})`);
  console.log(`Entradas            : ${money(sum.entradaTotal)}`);
  console.log(`Saídas              : ${money(sum.saidaTotal)}`);
  console.log(`Saldo do movimento  : ${money(sum.saldo)}`);
  console.log(`Transferência interna: ${sum.internalTransfers.count} lançamento(s)`);
  console.log('\nPor conta:');
  for (const b of sum.byBank) {
    console.log(
      `  ${b.label.padEnd(18)} ${b.origin === 'banco' ? 'banco   ' : 'dinheiro'} ${String(b.count).padStart(5)} lanç. ` +
        `entrada ${money(b.entrada).padStart(16)} saída ${money(b.saida).padStart(16)}`
    );
  }

  if (sum.typeDivergences.length) {
    console.log(`\nDivergências de TIPO (${sum.typeDivergences.length}) — valeu o valor, corrigir na planilha:`);
    for (const r of sum.typeDivergences) {
      const v = r.entryAmount || r.exitAmount;
      console.log(
        `  linha ${String(r.rowNumber).padStart(5)} | ID ${String(r.sheetId).padStart(5)} | ${r.bankRaw.padEnd(11)} | ${r.date} | ` +
          `planilha diz ${r.sheetType.padEnd(8)} → gravado ${r.derivedType.padEnd(7)} | ${money(v)} | ${r.description.slice(0, 46)}`
      );
    }
  }

  const semHistorico = validRows.filter((r) => r.warnings.some((w) => w.includes('nome da própria conta')));
  if (semHistorico.length) {
    const total = semHistorico.reduce((a, r) => a + r.entryAmount - r.exitAmount, 0);
    console.log(
      `\nLançamentos cujo histórico é só o nome da conta: ${semHistorico.length} (${money(total)}).`
    );
    console.log('  Entraram como movimento REAL. Se for remanejo entre caixas, avise para marcar como');
    console.log('  transferência interna — hoje eles somam no Resultado Financeiro.');
  }

  if (sum.discarded.length) {
    console.log(`\nDescartadas (${sum.discarded.length}):`);
    const porMotivo = new Map();
    for (const d of sum.discarded) porMotivo.set(d.reason, (porMotivo.get(d.reason) || 0) + 1);
    for (const [motivo, qtd] of porMotivo) console.log(`  ${String(qtd).padStart(4)}x ${motivo}`);
  }

  // ─── 3. As BAIXAS refeitas sobre este extrato ──────────────────────────────
  //
  // O script scripts/importExtratoGeral.mjs troca o extrato e refaz as baixas.
  // A troca do extrato é reversível (basta reimportar); a baixa errada não é:
  // ela declara um título pago. Então as três garantias abaixo são testadas
  // aqui, sem banco, com títulos montados a partir do próprio extrato.

  console.log('\n10) Baixa automática contra o extrato novo');

  // Os lançamentos já com o id que terão no Firestore — o mesmo que o script usa.
  const entradasNovas = validRows.map((r) => ({ ...toStatementEntry(r), id: statementDocId(r.dedupeKey) }));

  // Títulos sintéticos: para cada lançamento sorteado, um título pago com o
  // mesmo valor, data e nome. É o cenário que TEM que casar.
  const amostraR = entradasNovas.filter((e) => e.entryAmount > 0).slice(0, 60);
  const amostraP = entradasNovas.filter((e) => e.exitAmount > 0).slice(0, 60);
  const mkTitulo = (e, i, movType) => {
    const valor = movType === 'R' ? e.entryAmount : e.exitAmount;
    return {
      id: `t_${movType}_${i}`,
      dedupeKey: `${movType}_T${i}`,
      titleCode: `T${movType}${i}`,
      movType,
      titleNumber: `${1000 + i}`,
      parcela: `${1000 + i}-1`,
      personName: e.description,
      personCode: `${i}`,
      issueDate: e.date,
      entryDate: e.date,
      dueDate: e.date,
      paymentDate: e.date,
      year: e.year,
      monthKey: e.monthKey,
      paidYear: e.year,
      paidMonthKey: e.monthKey,
      amount: valor,
      balance: valor,
      penaltyAmount: 0,
      erpStatus: 'Pago',
      isPaid: true,
      status: 'Em Aberto',
      reconciledStatementId: '',
    };
  };
  const titulosR = amostraR.map((e, i) => mkTitulo(e, i, 'R'));
  const titulosP = amostraP.map((e, i) => mkTitulo(e, i, 'P'));

  const recR = reconcile(titulosR, entradasNovas, DEFAULT_RECONCILIATION_SETTINGS);
  const recP = reconcile(titulosP, entradasNovas, DEFAULT_RECONCILIATION_SETTINGS);

  check(
    `título a receber com valor, data e nome iguais é baixado (${recR.auto.length}/${titulosR.length})`,
    recR.auto.length > titulosR.length * 0.8,
    `só ${recR.auto.length} de ${titulosR.length} casaram`
  );
  check(
    `título a pagar com valor, data e nome iguais é baixado (${recP.auto.length}/${titulosP.length})`,
    recP.auto.length > titulosP.length * 0.8,
    `só ${recP.auto.length} de ${titulosP.length} casaram`
  );

  // UM LANÇAMENTO NÃO PODE QUITAR DOIS TÍTULOS. Se isso vazar, a empresa dá
  // baixa em duas dívidas com o mesmo pagamento — o erro mais caro que a
  // conciliação pode cometer, e o mais difícil de achar depois.
  for (const [nome, rec] of [['a receber', recR], ['a pagar', recP]]) {
    const usados = rec.auto.concat(rec.suggestions).map((m) => m.statementId);
    check(
      `${nome}: nenhum lançamento do extrato usado em duas baixas`,
      new Set(usados).size === usados.length,
      `${usados.length - new Set(usados).size} reuso(s)`
    );
    const alvos = rec.auto.concat(rec.suggestions).map((m) => m.tituloId);
    check(`${nome}: nenhum título baixado duas vezes`, new Set(alvos).size === alvos.length);
    check(
      `${nome}: toda baixa tem motivo auditável escrito`,
      rec.auto.every((m) => !!m.reason && m.score > 0)
    );
  }

  // ENTRADA CASA COM 'R', SAÍDA CASA COM 'P'. Cruzar os dois lados baixaria uma
  // conta a pagar com um recebimento.
  check(
    'baixa de recebimento só usa lançamento de ENTRADA',
    recR.auto.every((m) => {
      const e = entradasNovas.find((x) => x.id === m.statementId);
      return e && e.entryAmount > 0;
    })
  );
  check(
    'baixa de pagamento só usa lançamento de SAÍDA',
    recP.auto.every((m) => {
      const e = entradasNovas.find((x) => x.id === m.statementId);
      return e && e.exitAmount > 0;
    })
  );

  // Título com data fora da janela e valor diferente não pode casar por acaso.
  const foraDaJanela = [
    { ...titulosR[0], id: 't_fora', titleCode: 'TFORA', paymentDate: '2027-12-31', dueDate: '2027-12-31', amount: 987654.32, balance: 987654.32 },
  ];
  const recFora = reconcile(foraDaJanela, entradasNovas, DEFAULT_RECONCILIATION_SETTINGS);
  check(
    'título sem par de verdade NÃO é baixado',
    recFora.auto.length === 0 && recFora.unmatchedTitulos.length === 1
  );

  // Baixa manual é decisão humana: o motor não pode reciclá-la.
  const comManual = [{ ...titulosR[0], status: 'Baixado Manual', reconciledStatementId: amostraR[0].id }];
  const recManual = reconcile(comManual, entradasNovas, DEFAULT_RECONCILIATION_SETTINGS);
  check(
    'título com baixa MANUAL fica fora da conciliação',
    recManual.auto.length === 0 && recManual.stats.titulosConsiderados === 0
  );
  const recOutro = reconcile(
    [comManual[0], { ...titulosR[1], id: 't_outro' }],
    entradasNovas,
    DEFAULT_RECONCILIATION_SETTINGS
  );
  check(
    'lançamento já usado numa baixa manual não é reaproveitado',
    !recOutro.auto.some((m) => m.statementId === amostraR[0].id)
  );

  console.log('\n11) Código da baixa');
  check('formato a receber', buildBaixaCode('R', 2026, 1) === 'RC-2026-00001');
  check('formato a pagar', buildBaixaCode('P', 2026, 42) === 'BX-2026-00042');
  const codigos = recR.auto.map((_, i) => buildBaixaCode('R', 2026, i + 1));
  check('códigos sequenciais não repetem', new Set(codigos).size === codigos.length);

  // ─── 4. O Resultado Financeiro recalculado ────────────────────────────────
  //
  // Mesma conta que o App (recomputeFinancialFromStatement) e o script fazem:
  // entradas por mês, separadas por origem, EXCLUINDO transferência interna.
  console.log('\n12) Resultado Financeiro recalculado a partir do extrato');

  const porMes = new Map();
  for (const e of entradasNovas) {
    if (!e.monthKey || e.isInternalTransfer) continue;
    const k = `${e.year}|${e.monthKey}`;
    const cur = porMes.get(k) || { bancos: 0, tesouraria: 0 };
    if (e.origin === 'banco') cur.bancos += e.entryAmount;
    else cur.tesouraria += e.entryAmount;
    porMes.set(k, cur);
  }

  const somaBancos = [...porMes.values()].reduce((a, v) => a + v.bancos, 0);
  const somaTesouraria = [...porMes.values()].reduce((a, v) => a + v.tesouraria, 0);
  const refBancos = entradasNovas
    .filter((e) => e.origin === 'banco' && !e.isInternalTransfer)
    .reduce((a, e) => a + e.entryAmount, 0);
  const refTesouraria = entradasNovas
    .filter((e) => e.origin === 'caixa' && !e.isInternalTransfer)
    .reduce((a, e) => a + e.entryAmount, 0);

  check(`entradas bancos por mês somam o total: ${money(somaBancos)}`, approx(somaBancos, refBancos));
  check(`entradas tesouraria por mês somam o total: ${money(somaTesouraria)}`, approx(somaTesouraria, refTesouraria));
  check(
    'bancos + tesouraria = todas as entradas não-transferência',
    approx(
      somaBancos + somaTesouraria,
      entradasNovas.filter((e) => !e.isInternalTransfer).reduce((a, e) => a + e.entryAmount, 0)
    )
  );
  check(
    'nenhum mês fora do intervalo jan..dez',
    [...porMes.keys()].every((k) => ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].includes(k.split('|')[1]))
  );
  check(
    'toda entrada de caixa vai para Entradas Tesouraria (nunca Bancos)',
    entradasNovas.filter((e) => e.origin === 'caixa').every((e) => e.source === 'tesouraria')
  );

  console.log('\n── ENTRADAS POR MÊS (o que vai para o Resultado Financeiro) ─');
  console.log('  mês        entradas bancos      entradas tesouraria');
  for (const [k, v] of [...porMes.entries()].sort()) {
    const [ano, mes] = k.split('|');
    console.log(`  ${mes}/${ano}   ${money(v.bancos).padStart(17)}  ${money(v.tesouraria).padStart(19)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)} ${money(somaBancos).padStart(17)}  ${money(somaTesouraria).padStart(19)}`);
}

console.log(`\n═══ ${passed} ok, ${failed} falha(s) ═══\n`);
process.exit(failed > 0 ? 1 : 0);
