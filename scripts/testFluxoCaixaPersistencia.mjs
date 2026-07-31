/**
 * Conferência da persistência do Fluxo de Caixa (src/utils/cashFlowPersistence.ts).
 *
 * Roda com: node scripts/testFluxoCaixaPersistencia.mjs
 *
 * Este teste existe por causa de um bug real e caro: valores digitados nos
 * campos de recebimento, pagamento e saldo inicial "voltavam" ao número antigo
 * depois de sair e voltar na tela. A causa era `setDoc(..., { merge: true })`
 * combinado com semanas gravadas sem todos os campos — o Firestore faz DEEP
 * MERGE em mapas aninhados e preservava o valor velho de todo campo ausente.
 *
 * O caso central aqui é o do ROUND-TRIP: gravar → ler → tem que voltar
 * IDÊNTICO, inclusive os zeros. Zero é uma informação ("esta semana não entrou
 * nada"), não é ausência de informação. Se algum dia alguém reintroduzir merge
 * ou tirar a normalização, o round-trip quebra e este teste avisa.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import Module from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const load = (relPath) => {
  const source = readFileSync(resolve(root, relPath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(relPath);
  m._compile(js, resolve(root, relPath));
  return m.exports;
};

const {
  toMoney, normalizeWeek, normalizeWeeks, normalizePlan,
  planSignature, isPlanDirty, planToFirestore, planFromFirestore,
  emptyPlanFor, CASHFLOW_WEEKS,
} = load('src/utils/cashFlowPersistence.ts');

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  ✗ ${name}\n      esperado: ${JSON.stringify(expected)}\n      obtido:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
};

console.log('\n── Saneamento de valores ────────────────────────────────────────');
{
  check('número simples', toMoney(1234.567), 1234.57);
  check('string pt-BR', toMoney('7.016,87'), 7016.87);
  check('string simples', toMoney('7016.87'), 7016.87);
  check('vazio vira zero', toMoney(''), 0);
  check('undefined vira zero', toMoney(undefined), 0);
  check('null vira zero', toMoney(null), 0);
  check('NaN vira zero', toMoney(NaN), 0);
  check('negativo preservado (desembolso)', toMoney(-4321.005), -4321);
  check('zero continua zero', toMoney(0), 0);
}

console.log('\n── Semana sempre completa ───────────────────────────────────────');
{
  // O caso que quebrava a gravação: semana vinda do banco sem alguns campos.
  const parcial = normalizeWeek({ recebimentos: 100 });
  check('semana parcial ganha os 5 campos', Object.keys(parcial).sort(), [
    'aportes', 'desembRealizado', 'desembolsos', 'recebRealizado', 'recebimentos',
  ]);
  check('campo ausente vira 0, nunca undefined', parcial.aportes, 0);
  check('nenhum undefined sobra', Object.values(parcial).some((v) => v === undefined), false);

  const todas = normalizeWeeks({ sem01: { recebimentos: 1 } });
  check('as 5 semanas existem', Object.keys(todas).sort(), [...CASHFLOW_WEEKS].sort());
  check('semana nao informada vem zerada', todas.sem05.recebimentos, 0);
}

console.log('\n── Round-trip: gravar → ler → idêntico ──────────────────────────');
{
  const digitado = normalizePlan({
    id: '2026_jul',
    year: 2026,
    monthKey: 'jul',
    saldoInicial: 15300.45,
    useSaldoAutomatico: false,
    realizadoManual: true,
    weeks: {
      sem01: { recebimentos: 50000, desembolsos: -32000, aportes: 0, recebRealizado: 48750.9, desembRealizado: -31200.15 },
      sem02: { recebimentos: 42000, desembolsos: -28000, aportes: 5000, recebRealizado: 0, desembRealizado: 0 },
      sem03: { recebimentos: 0, desembolsos: 0, aportes: 0, recebRealizado: 0, desembRealizado: 0 },
      sem04: { recebimentos: 61000, desembolsos: -45000, aportes: 0, recebRealizado: 0, desembRealizado: 0 },
      sem05: { recebimentos: 0, desembolsos: -8000, aportes: 0, recebRealizado: 0, desembRealizado: 0 },
    },
    pendencias: [{ descricao: 'Pró-labore', valor: 12000 }],
    contasCaixa: [{ nome: 'Bradesco', saldo: 8300.2 }],
    posicaoData: '2026-07-31',
    horizonteAporteDias: 30,
    notes: 'fechamento conferido',
  });

  const doc = planToFirestore(digitado, '2026-07-31T12:00:00.000Z');
  const lido = planFromFirestore('2026_jul', doc);

  check('round-trip preserva a assinatura inteira', planSignature(lido), planSignature(digitado));
  check('saldo inicial digitado sobrevive', lido.saldoInicial, 15300.45);
  check('recebimento previsto sobrevive', lido.weeks.sem01.recebimentos, 50000);
  check('recebimento realizado sobrevive', lido.weeks.sem01.recebRealizado, 48750.9);
  check('pagamento realizado sobrevive (negativo)', lido.weeks.sem01.desembRealizado, -31200.15);
  check('aporte sobrevive', lido.weeks.sem02.aportes, 5000);
  check('pendencia sobrevive', lido.pendencias, [{ descricao: 'Pró-labore', valor: 12000 }]);
  check('conta de caixa sobrevive', lido.contasCaixa, [{ nome: 'Bradesco', saldo: 8300.2 }]);
  check('documento nao carrega undefined', JSON.stringify(doc).includes('undefined'), false);
}

console.log('\n── O bug original: zerar um valor tem que zerar no banco ────────');
{
  // Antes: o gestor apagava um recebimento, salvava, e o merge do Firestore
  // devolvia o número antigo na leitura seguinte.
  const antes = normalizePlan({
    id: '2026_ago', year: 2026, monthKey: 'ago', saldoInicial: 9000,
    weeks: { sem01: { recebimentos: 80000, recebRealizado: 79000 } },
  });
  const depois = normalizePlan({ ...antes, weeks: { ...antes.weeks, sem01: { ...antes.weeks.sem01, recebimentos: 0, recebRealizado: 0 } } });

  const docDepois = planToFirestore(depois, '2026-08-31T10:00:00.000Z');
  check('o zero vai para o documento como 0', docDepois.semanas.sem01.recebimentos, 0);
  check('o zero do realizado tambem vai', docDepois.semanas.sem01.recebRealizado, 0);

  const relido = planFromFirestore('2026_ago', docDepois);
  check('o valor antigo NAO volta na leitura', relido.weeks.sem01.recebimentos, 0);
  check('o realizado antigo NAO volta', relido.weeks.sem01.recebRealizado, 0);

  // Saldo inicial zerado de propósito.
  const zerado = normalizePlan({ ...depois, saldoInicial: 0 });
  const docZerado = planToFirestore(zerado, '2026-08-31T10:00:00.000Z');
  check('saldo inicial zerado vai como 0', docZerado.saldo_inicial, 0);
  check('saldo inicial zerado nao volta ao antigo', planFromFirestore('x', docZerado).saldoInicial, 0);
}

console.log('\n── Documento legado (gravado no formato antigo) ─────────────────');
{
  // Doc como o merge antigo deixava: semanas incompletas, sem realizado_manual.
  const legado = {
    ano: 2025, mes: 'mar', saldo_inicial: 1200,
    semanas: { sem01: { recebimentos: 500 }, sem03: { desembolsos: -300 } },
  };
  const lido = planFromFirestore('2025_mar', legado);
  check('legado: semanas completadas', Object.keys(lido.weeks).sort(), [...CASHFLOW_WEEKS].sort());
  check('legado: campo ausente vira 0', lido.weeks.sem01.aportes, 0);
  check('legado: valor existente preservado', lido.weeks.sem01.recebimentos, 500);
  check('legado: desembolso preservado', lido.weeks.sem03.desembolsos, -300);
  check('legado: realizadoManual assume true', lido.realizadoManual, true);

  // Regravar um legado tem que produzir documento completo e sem undefined.
  const doc = planToFirestore(lido, '2025-03-31T00:00:00.000Z');
  check('regravacao completa as 5 semanas', Object.keys(doc.semanas).sort(), [...CASHFLOW_WEEKS].sort());
  check('regravacao sem undefined', Object.values(doc.semanas.sem02).every((v) => typeof v === 'number'), true);
}

console.log('\n── Detecção de alterações não salvas ────────────────────────────');
{
  const salvo = normalizePlan({
    id: '2026_set', year: 2026, monthKey: 'set', saldoInicial: 1000,
    weeks: { sem01: { recebimentos: 200 } },
  });

  check('igual ao salvo → limpo', isPlanDirty(salvo, salvo), false);

  const mexido = { ...salvo, weeks: { ...salvo.weeks, sem01: { ...salvo.weeks.sem01, recebimentos: 201 } } };
  check('1 centavo de diferença → sujo', isPlanDirty(mexido, salvo), true);

  const saldoMexido = { ...salvo, saldoInicial: 1000.01 };
  check('saldo inicial alterado → sujo', isPlanDirty(saldoMexido, salvo), true);

  const soCarimbo = { ...salvo, updatedAt: '2030-01-01T00:00:00.000Z' };
  check('só o carimbo mudou → continua limpo', isPlanDirty(soCarimbo, salvo), false);

  const novoVazio = emptyPlanFor(2026, 'out');
  check('mês novo em branco → não acusa pendência', isPlanDirty(novoVazio, undefined), false);

  const novoDigitado = { ...novoVazio, saldoInicial: 50 };
  check('mês novo com saldo digitado → sujo', isPlanDirty(novoDigitado, undefined), true);
}

console.log('\n── Encadeamento em centavos ─────────────────────────────────────');
{
  // O saldo é encadeado: resíduo da semana 1 é carregado até dezembro.
  const p = normalizePlan({
    id: '2026_nov', year: 2026, monthKey: 'nov', saldoInicial: 0.1,
    weeks: {
      sem01: { recebimentos: 0.2 }, sem02: { recebimentos: 0.1 },
      sem03: { recebimentos: 0.1 }, sem04: { recebimentos: 0.1 }, sem05: { recebimentos: 0.1 },
    },
  });
  const total = CASHFLOW_WEEKS.reduce((a, w) => a + p.weeks[w].recebimentos, p.saldoInicial);
  check('soma de dízimas fecha em 2 casas', toMoney(total), 0.7);
}

console.log(
  failures === 0
    ? '\n✅ Persistência do fluxo de caixa: gravação absoluta confirmada.\n'
    : `\n❌ ${failures} cenário(s) divergente(s).\n`
);
process.exit(failures === 0 ? 0 : 1);
