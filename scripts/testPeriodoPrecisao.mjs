/**
 * testPeriodoPrecisao.mjs — Testa o filtro de período e a precisão monetária.
 *
 *     npm run test:periodo
 *
 * Não precisa de rede nem de Firebase: carrega `src/utils/periodFilter.ts` e
 * exercita as regras contra casos construídos à mão, incluindo os que já deram
 * número errado no passado (virada de mês, ano bissexto, fuso, resíduo de
 * ponto flutuante).
 *
 * O último bloco roda as somas contra as PLANILHAS REAIS e confere que o total
 * em centavos inteiros bate exatamente com o total do relatório do ERP — que é
 * a prova que interessa.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

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

const P = loadTs('src/utils/periodFilter.ts');
const { parseRfn046Rows, detectMovType } = loadTs('src/utils/rfn046Parser.ts');

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

// ─── Aritmética de datas ─────────────────────────────────────────────────────
secao('ARITMÉTICA DE DATAS (sem fuso)');
eq('addDays soma dentro do mês', P.addDaysIso('2026-07-10', 5), '2026-07-15');
eq('addDays atravessa o mês', P.addDaysIso('2026-07-30', 5), '2026-08-04');
eq('addDays atravessa o ano', P.addDaysIso('2025-12-30', 5), '2026-01-04');
eq('addDays negativo', P.addDaysIso('2026-01-03', -5), '2025-12-29');
eq('addDays em fevereiro bissexto', P.addDaysIso('2024-02-28', 1), '2024-02-29');
eq('addDays em fevereiro comum', P.addDaysIso('2026-02-28', 1), '2026-03-01');
eq('diffDays simples', P.diffDaysIso('2026-07-01', '2026-07-31'), 30);
eq('diffDays na virada de ano', P.diffDaysIso('2025-12-30', '2026-01-02'), 3);
// Outubro tem a virada do horário de verão no Brasil — a conta em UTC ignora.
eq('diffDays na virada do horário de verão', P.diffDaysIso('2026-10-17', '2026-10-19'), 2);
eq('último dia de fevereiro bissexto', P.lastDayOfMonthIso(2024, 2), '2024-02-29');
eq('último dia de fevereiro comum', P.lastDayOfMonthIso(2026, 2), '2026-02-28');
eq('último dia de abril', P.lastDayOfMonthIso(2026, 4), '2026-04-30');

// ─── Semana do mês ───────────────────────────────────────────────────────────
secao('SEMANA DO MÊS');
eq('dia 1 → S1', P.weekOfMonthIso('2026-07-01'), 'sem01');
eq('dia 7 → S1', P.weekOfMonthIso('2026-07-07'), 'sem01');
eq('dia 8 → S2', P.weekOfMonthIso('2026-07-08'), 'sem02');
eq('dia 28 → S4', P.weekOfMonthIso('2026-07-28'), 'sem04');
eq('dia 29 → S5', P.weekOfMonthIso('2026-07-29'), 'sem05');
eq('dia 31 → S5', P.weekOfMonthIso('2026-07-31'), 'sem05');
eq('rótulo S1 de julho', P.weekRangeLabel(2026, 7, 'sem01'), '01–07');
eq('rótulo S5 de julho (3 dias)', P.weekRangeLabel(2026, 7, 'sem05'), '29–31');
eq('rótulo S5 de fevereiro comum (0 dias)', P.weekRangeLabel(2026, 2, 'sem05'), '—');
eq('rótulo S5 de fevereiro bissexto (1 dia)', P.weekRangeLabel(2024, 2, 'sem05'), '29–29');

// ─── Presets de período ──────────────────────────────────────────────────────
secao('PRESETS DE PERÍODO');
const base = { ...P.defaultPeriodFilter(2026), year: 2026 };
const r = (patch) => P.resolvePeriod({ ...base, ...patch });
eq('exercício inteiro', [r({}).start, r({}).end], ['2026-01-01', '2026-12-31']);
eq('mês de fevereiro', [r({ preset: 'mes', month: 2 }).start, r({ preset: 'mes', month: 2 }).end], ['2026-02-01', '2026-02-28']);
eq('2º trimestre', [r({ preset: 'trimestre', quarter: 2 }).start, r({ preset: 'trimestre', quarter: 2 }).end], ['2026-04-01', '2026-06-30']);
eq('2º semestre', [r({ preset: 'semestre', semester: 2 }).start, r({ preset: 'semestre', semester: 2 }).end], ['2026-07-01', '2026-12-31']);
{
  const p30 = r({ preset: 'ultimos30' });
  // "Últimos 30 dias" tem que somar 30 dias contando hoje, não 31.
  eq('últimos 30 dias cobrem 30 dias', P.diffDaysIso(p30.start, p30.end) + 1, 30);
}
eq('personalizado', [r({ preset: 'personalizado', startDate: '2026-03-05', endDate: '2026-03-20' }).start,
                     r({ preset: 'personalizado', startDate: '2026-03-05', endDate: '2026-03-20' }).end],
   ['2026-03-05', '2026-03-20']);

// ─── Intervalo fechado dos dois lados ────────────────────────────────────────
secao('INTERVALO FECHADO (o último dia entra)');
const junho = r({ preset: 'mes', month: 6 });
eq('primeiro dia do mês entra', P.isInPeriod('2026-06-01', junho), true);
eq('último dia do mês entra', P.isInPeriod('2026-06-30', junho), true);
eq('dia anterior fica fora', P.isInPeriod('2026-05-31', junho), false);
eq('dia seguinte fica fora', P.isInPeriod('2026-07-01', junho), false);
eq('data vazia fica fora', P.isInPeriod('', junho), false);

// ─── Data-base ───────────────────────────────────────────────────────────────
secao('DATA-BASE — o mesmo título em três meses diferentes');
const titulo = { dueDate: '2026-06-30', paymentDate: '2026-07-03', issueDate: '2026-05-20' };
const julho = r({ preset: 'mes', month: 7 });
const maio = r({ preset: 'mes', month: 5 });
eq('por vencimento cai em junho', P.isInPeriod(P.dateForBasis(titulo, 'vencimento'), junho), true);
eq('por vencimento NÃO cai em julho', P.isInPeriod(P.dateForBasis(titulo, 'vencimento'), julho), false);
eq('por pagamento cai em julho', P.isInPeriod(P.dateForBasis(titulo, 'pagamento'), julho), true);
eq('por emissão cai em maio', P.isInPeriod(P.dateForBasis(titulo, 'emissao'), maio), true);
{
  const aberto = { dueDate: '2026-06-30', paymentDate: '', issueDate: '2026-05-20' };
  // Comportamento correto e contraintuitivo: filtrando por pagamento, título em
  // aberto desaparece — ele ainda não tem data de pagamento.
  eq('título em aberto some ao filtrar por pagamento', P.isInPeriod(P.dateForBasis(aberto, 'pagamento'), junho), false);
}

// ─── Precisão monetária ──────────────────────────────────────────────────────
secao('PRECISÃO MONETÁRIA');
eq('0.1 + 0.2 com round2', P.round2(0.1 + 0.2), 0.3);
eq('soma ingênua tem resíduo', 0.1 + 0.2 === 0.3, false);
eq('sumMoney de três décimos', P.sumMoney([0.1, 0.2]), 0.3);
eq('sumMoney de centavos repetidos', P.sumMoney(Array(10).fill(0.07)), 0.7);
{
  // Cem mil lançamentos de 1 centavo devem dar exatamente R$ 1.000,00.
  const mil = Array(100000).fill(0.01);
  const ingenua = mil.reduce((a, b) => a + b, 0);
  eq('100.000 × R$0,01 com sumMoney', P.sumMoney(mil), 1000);
  eq('a soma ingênua erra', ingenua === 1000, false);
  console.log(`      soma ingênua devolveu ${ingenua} — resíduo de ${(ingenua - 1000).toExponential(2)}`);
}
eq('sumBy soma campo de objetos', P.sumBy([{ v: 1.1 }, { v: 2.2 }, { v: 3.3 }], (x) => x.v), 6.6);
eq('sumMoney ignora nulos', P.sumMoney([1.5, null, undefined, 2.5]), 4);

// ─── Contra as planilhas reais ───────────────────────────────────────────────
secao('CONTRA AS PLANILHAS REAIS DO ERP');
const dir = resolve(root, 'scripts/data');
const arquivos = existsSync(dir) ? readdirSync(dir).filter((f) => /^RFN046.*\.xlsx?$/i.test(f)) : [];
if (arquivos.length === 0) {
  console.log('  (nenhuma planilha em scripts/data — bloco ignorado)');
} else {
  for (const f of arquivos) {
    const wb = XLSX.read(readFileSync(resolve(dir, f)), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const mov = detectMovType(rows).movType;
    const titulos = parseRfn046Rows(rows, mov).filter((p) => p.valid).map((p) => p.titulo);

    // Referência independente: soma em centavos direto da célula da planilha.
    const refCent = rows.reduce((a, x) => a + Math.round((Number(x['Titulo_Valor']) || 0) * 100), 0);
    const comSumBy = P.sumBy(titulos, (t) => t.amount);
    const ingenua = titulos.reduce((a, t) => a + t.amount, 0);

    console.log(`\n  ${f}  (movimento ${mov}, ${titulos.length} títulos)`);
    eq(`    total com sumBy bate no centavo`, Math.round(comSumBy * 100), refCent);
    console.log(`      sumBy   : ${comSumBy}`);
    console.log(`      ingênua : ${ingenua}${ingenua === comSumBy ? '' : '   ← resíduo de ponto flutuante'}`);

    // Recorte por período: as partes têm que somar o todo.
    const anos = [...new Set(titulos.map((t) => t.year))].filter(Boolean);
    for (const ano of anos) {
      const cheio = P.filterByPeriod(titulos, P.resolvePeriod({ ...P.defaultPeriodFilter(ano), preset: 'ano', year: ano }));
      let soma = 0;
      for (let m = 1; m <= 12; m++) {
        soma += Math.round(
          P.sumBy(
            P.filterByPeriod(titulos, P.resolvePeriod({ ...P.defaultPeriodFilter(ano), preset: 'mes', year: ano, month: m })),
            (t) => t.amount
          ) * 100
        );
      }
      eq(`    ${ano}: os 12 meses somam o ano inteiro`, soma, Math.round(P.sumBy(cheio, (t) => t.amount) * 100));

      let contagem = 0;
      for (let m = 1; m <= 12; m++) {
        contagem += P.filterByPeriod(
          titulos,
          P.resolvePeriod({ ...P.defaultPeriodFilter(ano), preset: 'mes', year: ano, month: m })
        ).length;
      }
      eq(`    ${ano}: nenhum título cai em dois meses nem some`, contagem, cheio.length);
    }

    // Trocar a data-base tem que mudar o conjunto — se não muda, o filtro não
    // está observando a coluna que diz observar.
    const anoRef = anos[0];
    const porVenc = P.filterByPeriod(titulos, P.resolvePeriod({ ...P.defaultPeriodFilter(anoRef), preset: 'mes', year: anoRef, month: 7, basis: 'vencimento' }));
    const porPgto = P.filterByPeriod(titulos, P.resolvePeriod({ ...P.defaultPeriodFilter(anoRef), preset: 'mes', year: anoRef, month: 7, basis: 'pagamento' }));
    console.log(`      julho/${anoRef}: ${porVenc.length} por vencimento × ${porPgto.length} por pagamento`);
    eq('    as duas bases devolvem conjuntos diferentes', porVenc.length === porPgto.length, false);
  }
}

// ─── Resultado ───────────────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(72));
console.log(`  ${passou} teste(s) passaram · ${falhou} falharam`);
console.log('═'.repeat(72));
console.log('');
process.exit(falhou > 0 ? 1 : 0);
