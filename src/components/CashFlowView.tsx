/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CashFlowView — "Fluxo de Caixa" (Planejamento Semanal Previsto x Realizado)
 *
 * Cada mês é dividido em Semanas 01–05, com as linhas Recebimentos,
 * Desembolsos, Geração de Caixa, Aportes e Saldo de Caixa. Para cada semana há
 * TRÊS colunas:
 *
 *   PREV.   — planejamento manual do gestor (o que se espera do mês).
 *   AUTOM.  — o que o sistema já sabe sozinho: recebimentos lançados no
 *             Extrato Financeiro, desembolsos lançados no Extrato e, nas
 *             semanas futuras, os títulos a vencer da Previsão de Pagamento
 *             (RFN046). É coluna de CONFERÊNCIA: não entra em nenhum cálculo
 *             de resultado.
 *   REAL.   — digitada pelo gestor. É a única fonte dos números que fecham o
 *             mês: geração de caixa, saldo encadeado, acurácia e os PDFs.
 *
 * POR QUE O REALIZADO É DIGITADO E NÃO CALCULADO
 * ----------------------------------------------
 * O automático é um bom palpite, não uma verdade: o extrato pode estar
 * incompleto no dia da conferência, ter transferência interna classificada
 * como entrada, ou um pagamento lançado em duplicidade. Quem responde pelo
 * número é o gestor. Por isso o AUTOM. fica ao lado, com um botão que copia o
 * valor para o REAL. — sugestão a um clique de distância, nunca imposição.
 *
 * DUPLA CONTAGEM (a armadilha que este desenho evita)
 * ---------------------------------------------------
 * Um título pago aparece no Extrato (saída) e sairia de novo pela Previsão se
 * a base RFN046 não fosse depurada. Por isso a previsão só soma títulos EM
 * ABERTO (saldo > 0 e sem data de pagamento), e a importação do RFN006 quita
 * automaticamente na previsão os títulos que passaram a ser pagos.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CornerRightDown,
  Download,
  Info,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  CashFlowConta,
  CashFlowPendencia,
  CashFlowPlan,
  CashFlowWeekKey,
  FinancialStatementEntry,
  PayableForecastTitle,
} from '../types';
import {
  exportCashFlowPdfGeral,
  exportCashFlowPdfMensal,
  exportReportToExcel,
  formatCurrency,
} from '../utils/exportUtils';
import {
  addDaysIso,
  forecastByWeek,
  forecastInRange,
  formatIsoBr,
  isOpenForecast,
  sumForecast,
  todayIso,
} from '../utils/payableForecast';
import { PdfExportMenu } from './PdfExportMenu';

interface CashFlowViewProps {
  plans: CashFlowPlan[];
  statementEntries: FinancialStatementEntry[];
  /** Títulos a vencer (RFN046) — alimentam a previsão da coluna AUTOM. */
  payableForecasts?: PayableForecastTitle[];
  selectedYear: number;
  onSavePlan: (plan: CashFlowPlan) => Promise<void> | void;
  userRole: string;
}

const MONTHS: { key: string; label: string }[] = [
  { key: 'jan', label: 'Janeiro' }, { key: 'fev', label: 'Fevereiro' }, { key: 'mar', label: 'Março' },
  { key: 'abr', label: 'Abril' }, { key: 'mai', label: 'Maio' }, { key: 'jun', label: 'Junho' },
  { key: 'jul', label: 'Julho' }, { key: 'ago', label: 'Agosto' }, { key: 'set', label: 'Setembro' },
  { key: 'out', label: 'Outubro' }, { key: 'nov', label: 'Novembro' }, { key: 'dez', label: 'Dezembro' },
];

const WEEKS: CashFlowWeekKey[] = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];
const WEEK_LABELS: Record<CashFlowWeekKey, string> = {
  sem01: 'Semana 1', sem02: 'Semana 2', sem03: 'Semana 3', sem04: 'Semana 4', sem05: 'Semana 5',
};

// Mapeia uma data (YYYY-MM-DD) para a semana do mês (0..4 → sem01..sem05).
// Dias 1–7 → S1, 8–14 → S2, 15–21 → S3, 22–28 → S4, 29–31 → S5.
const weekOfMonth = (iso: string): CashFlowWeekKey => {
  const day = parseInt((iso || '').slice(8, 10), 10);
  if (isNaN(day)) return 'sem01';
  const idx = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
  return WEEKS[idx];
};

// Classifica um recebimento por tipo, a partir do documento/descrição do extrato.
const categorizeReceipt = (e: FinancialStatementEntry): string => {
  const t = `${e.documentType || ''} ${e.description || ''}`.toLowerCase();
  if (t.includes('pix')) return 'PIX';
  if (t.includes('boleto')) return 'BOLETO';
  if (t.includes('cart') || t.includes('cred') || t.includes('deb')) return 'CARTÃO';
  if (t.includes('cheque')) return 'CHEQUE';
  if (t.includes('dinheiro') || t.includes('espéc') || t.includes('espec') || t.includes('caixa')) return 'ESPÉCIE';
  if (t.includes('ordem') || t.includes(' os ') || t.startsWith('os')) return 'OS';
  if (t.includes('ted') || t.includes('doc') || t.includes('transf')) return 'TRANSFERÊNCIA';
  return 'OUTROS';
};

const emptyWeekPlan = () => ({ recebimentos: 0, desembolsos: 0, aportes: 0 });
const emptyPlan = (year: number, monthKey: string): CashFlowPlan => ({
  id: `${year}_${monthKey}`,
  year,
  monthKey,
  saldoInicial: 0,
  useSaldoAutomatico: false,
  realizadoManual: true,
  weeks: {
    sem01: emptyWeekPlan(), sem02: emptyWeekPlan(), sem03: emptyWeekPlan(),
    sem04: emptyWeekPlan(), sem05: emptyWeekPlan(),
  },
  pendencias: [],
});

const sumWeeks = (fn: (w: CashFlowWeekKey) => number): number =>
  WEEKS.reduce((acc, w) => acc + fn(w), 0);

export const CashFlowView: React.FC<CashFlowViewProps> = ({
  plans,
  statementEntries,
  payableForecasts = [],
  selectedYear,
  onSavePlan,
  userRole,
}) => {
  const now = new Date();
  const defaultMonth = MONTHS[Math.min(11, now.getMonth())].key;
  const [monthKey, setMonthKey] = useState<string>(defaultMonth);
  const [draft, setDraft] = useState<CashFlowPlan>(emptyPlan(selectedYear, defaultMonth));
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Somar os títulos a vencer na coluna automática. Ligado por padrão: sem
  // isso, as semanas futuras aparecem com desembolso zero, que é o número mais
  // otimista e mais falso que o fluxo de caixa pode mostrar.
  const [includeForecast, setIncludeForecast] = useState(true);
  const [prefilledHint, setPrefilledHint] = useState(false);
  const [pendingPrefill, setPendingPrefill] = useState(true);

  // ── Buffer de digitação dos campos numéricos ─────────────────────────────
  //
  // Todo campo de valor aqui é um input controlado cujo `value` vem do número
  // já convertido em `draft`. Sem este buffer, digitar "1," dispara o
  // onChange, `parseInput` converte para o número 1 (a vírgula não faz parte
  // de nenhum número), e o input re-renderiza mostrando "1" — a vírgula
  // desaparece antes de dar tempo de digitar a casa decimal, e "1.234,56"
  // nunca sai do chão.
  //
  // A correção mantém, por campo, o TEXTO EXATO que a pessoa está digitando
  // (rawEdits). Enquanto o campo está em edição, o input mostra esse texto,
  // não o número. O valor numérico em `draft` já é atualizado a cada tecla
  // (os cálculos da tela continuam ao vivo), mas a caixa de texto não é
  // reformatada até o campo perder o foco — aí sim o buffer é descartado e o
  // input volta a mostrar o número final, já formatado.
  const [rawEdits, setRawEdits] = useState<Record<string, string>>({});
  const editKey = (...parts: (string | number)[]) => parts.join('__');
  const displayValue = (key: string, numeric: number): string =>
    rawEdits[key] !== undefined ? rawEdits[key] : numeric || '';
  const beginEdit = (key: string, raw: string, apply: (raw: string) => void) => {
    setRawEdits((r) => ({ ...r, [key]: raw }));
    apply(raw);
  };
  const endEdit = (key: string) => {
    setRawEdits((r) => {
      if (!(key in r)) return r;
      const { [key]: _discard, ...rest } = r;
      return rest;
    });
  };

  const canEdit = userRole !== 'analista';

  const planForMonth = useMemo(
    () => plans.find((p) => p.monthKey === monthKey && p.year === selectedYear),
    [plans, monthKey, selectedYear]
  );

  // ── REALIZADO AUTOMÁTICO: agregação a partir do Extrato Financeiro ────────
  const realized = useMemo(() => {
    const weeks: Record<CashFlowWeekKey, { receb: number; desemb: number }> = {
      sem01: { receb: 0, desemb: 0 }, sem02: { receb: 0, desemb: 0 }, sem03: { receb: 0, desemb: 0 },
      sem04: { receb: 0, desemb: 0 }, sem05: { receb: 0, desemb: 0 },
    };
    const recebByType: Record<string, Record<CashFlowWeekKey, number>> = {};
    const desembBySource: Record<string, Record<CashFlowWeekKey, number>> = {};

    for (const e of statementEntries) {
      if (e.year !== selectedYear || e.monthKey !== monthKey) continue;
      const wk = weekOfMonth(e.date);
      if (e.entryAmount > 0) {
        weeks[wk].receb += e.entryAmount;
        const cat = categorizeReceipt(e);
        if (!recebByType[cat]) recebByType[cat] = { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 };
        recebByType[cat][wk] += e.entryAmount;
      }
      if (e.exitAmount > 0) {
        weeks[wk].desemb += e.exitAmount;
        const src = e.sourceLabel || 'Outros';
        if (!desembBySource[src]) desembBySource[src] = { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 };
        desembBySource[src][wk] += e.exitAmount;
      }
    }
    return { weeks, recebByType, desembBySource };
  }, [statementEntries, selectedYear, monthKey]);

  // ── PREVISÃO FUTURA: títulos a vencer (RFN046) por semana do mês ──────────
  const forecastWeeks = useMemo(
    () => forecastByWeek(payableForecasts, selectedYear, monthKey),
    [payableForecasts, selectedYear, monthKey]
  );
  const totalForecast = WEEKS.reduce((a, w) => a + forecastWeeks[w], 0);

  // Sincroniza o rascunho editável com o plano salvo quando muda o mês/ano.
  //
  // MIGRAÇÃO SUAVE: nos meses gravados na versão antiga (realizado vinha do
  // extrato e não havia campo digitado), a coluna REAL. apareceria zerada e o
  // saldo do mês desmoronaria na tela. Nesses casos o rascunho já abre
  // pré-preenchido com o realizado do extrato — apenas em memória, com aviso
  // visível; só vira número oficial quando o gestor conferir e salvar.
  useEffect(() => {
    setDraft(
      planForMonth
        ? { ...planForMonth, weeks: { ...planForMonth.weeks }, realizadoManual: true }
        : emptyPlan(selectedYear, monthKey)
    );
    setPendingPrefill(true);
    setPrefilledHint(false);
    setSavedMsg(null);
    setSaveError(null);
    // Ao trocar de mês, qualquer texto em digitação pertence ao mês anterior —
    // sem isso, um campo que estivesse com "1.234," no meio da digitação
    // continuaria mostrando esse texto por cima dos valores do mês novo.
    setRawEdits({});
  }, [planForMonth, monthKey, selectedYear]);

  // O pré-preenchimento vive num efeito separado porque o extrato costuma
  // chegar depois da tela (carga assíncrona). Se ele estivesse junto do efeito
  // acima, a chegada tardia do extrato reescreveria o que o gestor já tivesse
  // digitado. Aqui ele só age uma vez por mês aberto, e só enquanto não houver
  // nenhum valor digitado.
  useEffect(() => {
    if (!pendingPrefill) return;
    const hasExtrato = WEEKS.some((w) => realized.weeks[w].receb > 0 || realized.weeks[w].desemb > 0);
    if (!hasExtrato) return; // extrato ainda não chegou: continua aguardando

    const hasTyped = WEEKS.some(
      (w) => (draft.weeks[w]?.recebRealizado || 0) !== 0 || (draft.weeks[w]?.desembRealizado || 0) !== 0
    );
    if (!hasTyped) {
      setDraft((d) => {
        const weeks = { ...d.weeks };
        for (const w of WEEKS) {
          weeks[w] = {
            ...weeks[w],
            recebRealizado: realized.weeks[w].receb,
            desembRealizado: -realized.weeks[w].desemb,
          };
        }
        return { ...d, weeks };
      });
      setPrefilledHint(true);
    }
    setPendingPrefill(false);
    // `draft` é lido intencionalmente sem entrar nas dependências: o efeito só
    // dispara na abertura do mês (pendingPrefill) ou quando o extrato chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrefill, realized]);

  // ── Cálculo das linhas (previsto, automático e realizado) ─────────────────
  const rows = useMemo(() => {
    const prevReceb = (w: CashFlowWeekKey) => draft.weeks[w]?.recebimentos || 0;
    const prevDesemb = (w: CashFlowWeekKey) => draft.weeks[w]?.desembolsos || 0; // já negativo
    const aporte = (w: CashFlowWeekKey) => draft.weeks[w]?.aportes || 0;

    // AUTOMÁTICO — só conferência. Recebimentos: entradas do extrato.
    // Desembolsos: saídas do extrato + títulos a vencer da semana (previsão).
    const autoReceb = (w: CashFlowWeekKey) => realized.weeks[w].receb;
    const autoDesemb = (w: CashFlowWeekKey) =>
      -(realized.weeks[w].desemb + (includeForecast ? forecastWeeks[w] : 0));

    // REALIZADO — exclusivamente o que foi digitado. É o que fecha o mês.
    const realReceb = (w: CashFlowWeekKey) => draft.weeks[w]?.recebRealizado || 0;
    const realDesemb = (w: CashFlowWeekKey) => draft.weeks[w]?.desembRealizado || 0;

    const prevGer = (w: CashFlowWeekKey) => prevReceb(w) + prevDesemb(w);
    const autoGer = (w: CashFlowWeekKey) => autoReceb(w) + autoDesemb(w);
    const realGer = (w: CashFlowWeekKey) => realReceb(w) + realDesemb(w);

    // Saldo encadeado semana a semana, em cada uma das três visões.
    const prevSaldo: Record<CashFlowWeekKey, number> = {} as any;
    const autoSaldo: Record<CashFlowWeekKey, number> = {} as any;
    const realSaldo: Record<CashFlowWeekKey, number> = {} as any;
    let accPrev = draft.saldoInicial || 0;
    let accAuto = draft.saldoInicial || 0;
    let accReal = draft.saldoInicial || 0;
    for (const w of WEEKS) {
      accPrev += prevGer(w) + aporte(w);
      accAuto += autoGer(w) + aporte(w);
      accReal += realGer(w) + aporte(w);
      prevSaldo[w] = accPrev;
      autoSaldo[w] = accAuto;
      realSaldo[w] = accReal;
    }

    return {
      prevReceb, prevDesemb, aporte,
      autoReceb, autoDesemb, autoGer, autoSaldo,
      realReceb, realDesemb, prevGer, realGer, prevSaldo, realSaldo,
    };
  }, [draft, realized, forecastWeeks, includeForecast]);

  // Saldo final realizado do mês anterior (para herança automática)
  const previousMonthFinalSaldo = useMemo(() => {
    const idx = MONTHS.findIndex((m) => m.key === monthKey);
    if (idx <= 0) return null;
    const prevKey = MONTHS[idx - 1].key;
    const prevPlan = plans.find((p) => p.monthKey === prevKey && p.year === selectedYear);
    if (!prevPlan) return null;

    // Prioriza o realizado DIGITADO do mês anterior — é o número que o gestor
    // conferiu. Só cai para o extrato quando aquele mês nunca foi digitado.
    const typed = WEEKS.reduce(
      (acc, w) => acc + (prevPlan.weeks[w]?.recebRealizado || 0) + (prevPlan.weeks[w]?.desembRealizado || 0),
      0
    );
    const hasTyped = WEEKS.some(
      (w) => (prevPlan.weeks[w]?.recebRealizado || 0) !== 0 || (prevPlan.weeks[w]?.desembRealizado || 0) !== 0
    );

    let acc = prevPlan.saldoInicial || 0;
    if (hasTyped) {
      acc += typed;
    } else {
      for (const e of statementEntries) {
        if (e.year !== selectedYear || e.monthKey !== prevKey) continue;
        acc += (e.entryAmount || 0) - (e.exitAmount || 0);
      }
    }
    acc += WEEKS.reduce((a, w) => a + (prevPlan.weeks[w]?.aportes || 0), 0);
    return acc;
  }, [plans, statementEntries, monthKey, selectedYear]);

  // ── Edição de células ────────────────────────────────────────────────────
  // Aceita tanto formato pt-BR ("7.016,87") quanto plano ("7016.87" / "7016").
  const parseInput = (v: string): number => {
    if (!v) return 0;
    let s = v.toString().trim().replace(/[^0-9.,\-]/g, '');
    if (s.includes(',')) {
      // pt-BR: ponto = milhar, vírgula = decimal
      s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };
  const setWeekValue = (
    w: CashFlowWeekKey,
    field: 'recebimentos' | 'desembolsos' | 'aportes' | 'recebRealizado' | 'desembRealizado',
    raw: string
  ) => {
    setDraft((d) => ({
      ...d,
      weeks: { ...d.weeks, [w]: { ...d.weeks[w], [field]: parseInput(raw) } },
    }));
  };

  /**
   * Desembolso é saída: guarda-se negativo, porque a geração de caixa é
   * recebimentos + desembolsos. Digitar "112.139,46" em vez de "-112.139,46"
   * inverteria o resultado do mês e ninguém perceberia olhando a célula. Ao
   * sair do campo, o valor é normalizado para negativo — durante a digitação
   * nada é mexido, para não brigar com quem está escrevendo.
   */
  const normalizeDesembolso = (
    w: CashFlowWeekKey,
    field: 'desembolsos' | 'desembRealizado'
  ) => {
    setDraft((d) => {
      const current = d.weeks[w]?.[field] || 0;
      if (current <= 0) return d;
      return { ...d, weeks: { ...d.weeks, [w]: { ...d.weeks[w], [field]: -current } } };
    });
  };

  // Copia o automático de UMA semana para o realizado digitado.
  const copyWeekAutoToReal = (w: CashFlowWeekKey) => {
    if (!canEdit) return;
    setDraft((d) => ({
      ...d,
      weeks: {
        ...d.weeks,
        [w]: { ...d.weeks[w], recebRealizado: rows.autoReceb(w), desembRealizado: rows.autoDesemb(w) },
      },
    }));
    setPrefilledHint(true);
  };

  // Copia o mês inteiro de uma vez.
  const copyMonthAutoToReal = () => {
    if (!canEdit) return;
    setDraft((d) => {
      const weeks = { ...d.weeks };
      for (const w of WEEKS) {
        weeks[w] = { ...weeks[w], recebRealizado: rows.autoReceb(w), desembRealizado: rows.autoDesemb(w) };
      }
      return { ...d, weeks };
    });
    setPrefilledHint(true);
  };

  // ── Pendências (obrigações em aberto) ────────────────────────────────────
  const pendencias = draft.pendencias || [];
  const totalPendencias = pendencias.reduce((a, p) => a + (Number(p.valor) || 0), 0);
  const setPendencia = (idx: number, field: keyof CashFlowPendencia, raw: string) => {
    setDraft((d) => {
      const list = [...(d.pendencias || [])];
      list[idx] = { ...list[idx], [field]: field === 'valor' ? parseInput(raw) : raw };
      return { ...d, pendencias: list };
    });
  };
  const addPendencia = () => setDraft((d) => ({ ...d, pendencias: [...(d.pendencias || []), { descricao: '', valor: 0 }] }));
  const removePendencia = (idx: number) => setDraft((d) => ({ ...d, pendencias: (d.pendencias || []).filter((_, i) => i !== idx) }));

  // ── POSIÇÃO DE CAIXA E NECESSIDADE DE APORTE ─────────────────────────────
  //
  // O saldo encadeado da grade é uma PROJEÇÃO: parte de um saldo inicial
  // digitado e vai somando o que aconteceu. Ele responde "como o mês está
  // andando", mas não responde a pergunta que decide o dia: TENHO DINHEIRO
  // PARA PAGAR O QUE ESTÁ VENCENDO?
  //
  // Esta seção responde essa. De um lado, o dinheiro que EXISTE agora, contado
  // conta por conta. Do outro, os compromissos do horizonte escolhido: títulos
  // a vencer (RFN046, incluindo os já vencidos e não pagos) e as pendências
  // digitadas. A diferença negativa não é um detalhe do relatório — é o
  // tamanho exato do aporte que precisa entrar.
  const hojeIso = todayIso();
  const contas: CashFlowConta[] = draft.contasCaixa && draft.contasCaixa.length > 0
    ? draft.contasCaixa
    : [
        { nome: 'Tesouraria (dinheiro)', saldo: 0 },
        { nome: 'Bradesco', saldo: 0 },
        { nome: 'PagBank', saldo: 0 },
      ];
  const horizonteDias = draft.horizonteAporteDias || 30;
  const posicaoData = draft.posicaoData || hojeIso;

  const setConta = (idx: number, field: keyof CashFlowConta, raw: string) => {
    setDraft((d) => {
      const list = [...(d.contasCaixa && d.contasCaixa.length > 0 ? d.contasCaixa : contas)];
      list[idx] = { ...list[idx], [field]: field === 'saldo' ? parseInput(raw) : raw };
      return { ...d, contasCaixa: list, posicaoData: d.posicaoData || hojeIso };
    });
  };
  const addConta = () =>
    setDraft((d) => ({
      ...d,
      contasCaixa: [...(d.contasCaixa && d.contasCaixa.length > 0 ? d.contasCaixa : contas), { nome: '', saldo: 0 }],
    }));
  const removeConta = (idx: number) =>
    setDraft((d) => ({
      ...d,
      contasCaixa: (d.contasCaixa && d.contasCaixa.length > 0 ? d.contasCaixa : contas).filter((_, i) => i !== idx),
    }));

  const disponivelHoje = contas.reduce((a, c) => a + (Number(c.saldo) || 0), 0);

  // Compromissos do horizonte: tudo o que está em aberto vencendo de hoje até
  // hoje + N dias, MAIS o que já venceu e não foi pago (atraso não deixa de ser
  // dívida por ter passado a data).
  const titulosAbertos = useMemo(() => payableForecasts.filter(isOpenForecast), [payableForecasts]);
  const titulosNoHorizonte = useMemo(
    () => forecastInRange(titulosAbertos, '1900-01-01', addDaysIso(hojeIso, horizonteDias)),
    [titulosAbertos, hojeIso, horizonteDias]
  );
  const compromissosTitulos = sumForecast(titulosNoHorizonte);
  const titulosVencidos = sumForecast(titulosNoHorizonte.filter((t) => t.dueDate < hojeIso));
  const compromissosTotal = compromissosTitulos + totalPendencias;

  const saldoProjetado = disponivelHoje - compromissosTotal;
  const necessidadeAporte = saldoProjetado < 0 ? Math.abs(saldoProjetado) : 0;
  const cobertura = compromissosTotal > 0 ? (disponivelHoje / compromissosTotal) * 100 : 100;

  // Semana do mês em que a necessidade deve ser lançada como aporte.
  const semanaAtual: CashFlowWeekKey =
    monthKey === MONTHS[new Date().getMonth()].key && selectedYear === new Date().getFullYear()
      ? weekOfMonth(hojeIso)
      : 'sem01';

  const lancarAporte = () => {
    if (!canEdit || necessidadeAporte <= 0) return;
    setDraft((d) => ({
      ...d,
      weeks: {
        ...d.weeks,
        [semanaAtual]: {
          ...d.weeks[semanaAtual],
          aportes: (d.weeks[semanaAtual]?.aportes || 0) + necessidadeAporte,
        },
      },
    }));
  };

  // Divergência entre o caixa contado e o saldo que a grade projeta para a
  // semana corrente. É o termômetro de confiança do fluxo: se dá diferença
  // grande, ou falta lançamento no realizado, ou o saldo inicial está errado.
  const saldoProjetadoGrade = rows.realSaldo[semanaAtual];
  const divergenciaGrade = disponivelHoje - saldoProjetadoGrade;

  const handleSave = async () => {
    if (!canEdit) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedMsg(null);
    try {
      // realizadoManual fica sempre true: a partir desta versão o realizado é o
      // que está digitado, e os relatórios em PDF precisam ler daí.
      await onSavePlan({
        ...draft,
        id: `${selectedYear}_${monthKey}`,
        year: selectedYear,
        monthKey,
        realizadoManual: true,
      });
      setSavedMsg('Planejamento salvo com sucesso.');
      setPrefilledHint(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Falha ao salvar. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const inheritSaldo = () => {
    if (previousMonthFinalSaldo == null) return;
    setDraft((d) => ({ ...d, saldoInicial: previousMonthFinalSaldo, useSaldoAutomatico: true }));
  };

  // ── Totais do mês ────────────────────────────────────────────────────────
  const totalPrevReceb = sumWeeks(rows.prevReceb);
  const totalPrevDesemb = sumWeeks(rows.prevDesemb);
  const totalAutoReceb = sumWeeks(rows.autoReceb);
  const totalAutoDesemb = sumWeeks(rows.autoDesemb);
  const totalRealReceb = sumWeeks(rows.realReceb);
  const totalRealDesemb = sumWeeks(rows.realDesemb);
  const totalAporte = sumWeeks(rows.aporte);
  const saldoFinalReal = rows.realSaldo.sem05;
  const saldoFinalPrev = rows.prevSaldo.sem05;
  const saldoFinalAuto = rows.autoSaldo.sem05;
  const acuracia = totalPrevReceb > 0 ? (totalRealReceb / totalPrevReceb) * 100 : 0;

  // Divergência entre o que o sistema calculou e o que foi digitado. É o alerta
  // de auditoria: diferença grande significa extrato incompleto ou digitação
  // equivocada — os dois merecem uma olhada antes de fechar o mês.
  const divReceb = totalRealReceb - totalAutoReceb;
  const divDesemb = totalRealDesemb - totalAutoDesemb;

  const monthLabel = MONTHS.find((m) => m.key === monthKey)?.label || monthKey;

  // ── Exportação ───────────────────────────────────────────────────────────
  const handleExport = () => {
    const data: any[] = [];
    const pushRow = (linha: string, get: (w: CashFlowWeekKey) => number) => {
      const row: any = { Linha: linha };
      WEEKS.forEach((w) => { row[WEEK_LABELS[w]] = get(w); });
      row['Total'] = sumWeeks(get);
      data.push(row);
    };
    data.push({ Linha: `SALDO INICIAL`, 'Semana 1': draft.saldoInicial });
    pushRow('Recebimentos (Previsto)', rows.prevReceb);
    pushRow('Recebimentos (Automático)', rows.autoReceb);
    pushRow('Recebimentos (Realizado digitado)', rows.realReceb);
    pushRow('Desembolsos (Previsto)', rows.prevDesemb);
    pushRow('Desembolsos (Automático)', rows.autoDesemb);
    pushRow('Desembolsos (Realizado digitado)', rows.realDesemb);
    pushRow('Títulos a vencer (Previsão RFN046)', (w) => forecastWeeks[w]);
    pushRow('Geração de Caixa (Previsto)', rows.prevGer);
    pushRow('Geração de Caixa (Automático)', rows.autoGer);
    pushRow('Geração de Caixa (Realizado digitado)', rows.realGer);
    pushRow('Aportes', rows.aporte);
    pushRow('Saldo de Caixa (Previsto)', (w) => rows.prevSaldo[w]);
    pushRow('Saldo de Caixa (Automático)', (w) => rows.autoSaldo[w]);
    pushRow('Saldo de Caixa (Realizado digitado)', (w) => rows.realSaldo[w]);
    exportReportToExcel(data, `FLUXO_CAIXA_${monthLabel}_${selectedYear}`, `Fluxo_Caixa_${monthLabel}_${selectedYear}.xlsx`);
  };

  const handleExportGeralPdf = () => {
    exportCashFlowPdfGeral(plans, statementEntries, selectedYear);
  };

  const handleExportMensalPdf = (mKey: string) => {
    const targetPlan = plans.find((p) => p.monthKey === mKey && p.year === selectedYear) || (mKey === monthKey ? draft : undefined);
    exportCashFlowPdfMensal(targetPlan, statementEntries, selectedYear, mKey);
  };

  const receiptTypes = Object.keys(realized.recebByType).sort();
  const paymentSources = Object.keys(realized.desembBySource).sort();

  // Célula da coluna AUTOM.: valor + botão que joga o número no REAL.
  const autoCell = (value: number, tone: 'receb' | 'desemb' | 'neutro', w?: CashFlowWeekKey) => (
    <div className="flex items-center justify-end gap-1 px-1">
      <span
        className={`font-mono text-[11px] font-semibold ${
          tone === 'receb' ? 'text-emerald-600/90' : tone === 'desemb' ? 'text-rose-600/90' : 'text-[#8B7D6B]'
        }`}
      >
        {formatCurrency(value)}
      </span>
      {w && canEdit && (
        <button
          onClick={() => copyWeekAutoToReal(w)}
          title="Copiar o automático desta semana para a coluna REAL."
          className="p-0.5 rounded text-[#C19A6B] hover:bg-[#C19A6B] hover:text-white transition-colors flex-shrink-0"
        >
          <CornerRightDown className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              PLANEJAMENTO & REALIZADO
            </span>
            <span className="text-xs text-[#8B7D6B]">• Exercício: {selectedYear}</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Fluxo de Caixa Semanal — Previsto x Automático x Realizado</h2>
          <p className="text-xs text-[#8B7D6B]">
            <b>PREV.</b> é o seu planejamento. <b>AUTOM.</b> é o que o sistema já tem (extrato + títulos a vencer) — serve
            de conferência. <b>REAL.</b> é digitado por você e é a <b>única</b> base dos resultados, do saldo e dos PDFs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs font-bold text-[#2D2A26] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#C19A6B]"
          >
            {MONTHS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>

          <PdfExportMenu
            selectedYear={selectedYear}
            currentMonthKey={monthKey}
            onExportGeral={handleExportGeralPdf}
            onExportMensal={handleExportMensalPdf}
          />

          <button
            onClick={handleExport}
            className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-2 border border-[#EAE6DF]"
          >
            <Download className="w-4 h-4 text-[#8B7D6B]" />
            <span>Exportar Excel</span>
          </button>
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2.5 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {isSaving ? (
                <svg className="animate-spin w-4 h-4 text-[#C19A6B]" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" fill="currentColor" className="opacity-75" />
                </svg>
              ) : (
                <Save className="w-4 h-4 text-[#C19A6B]" />
              )}
              <span>{isSaving ? 'Salvando...' : 'Salvar Planejamento'}</span>
            </button>
          )}
        </div>
      </div>

      {savedMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-bold">{savedMsg}</p>
        </div>
      )}
      {saveError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <p className="text-xs font-bold">{saveError}</p>
        </div>
      )}
      {prefilledHint && canEdit && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-semibold">
            A coluna <b>REAL.</b> está preenchida com valores sugeridos pelo automático, mas ainda <b>não salvos</b>.
            Confira número por número e clique em <b>Salvar Planejamento</b> — os resultados só usam o que estiver salvo.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider flex items-center gap-1">
            <Wallet className="w-3.5 h-3.5 text-[#C19A6B]" /> Saldo Inicial
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(draft.saldoInicial)}</p>
          <span className="text-[10px] text-[#8B7D6B]">{monthLabel}/{selectedYear}</span>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5" /> Recebido (Real. digitado)
          </span>
          <p className="text-lg font-black text-emerald-800 mt-1">{formatCurrency(totalRealReceb)}</p>
          <span className="text-[10px] text-emerald-700">
            Automático: {formatCurrency(totalAutoReceb)} • Previsto: {formatCurrency(totalPrevReceb)}
          </span>
        </div>
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5" /> Pago (Real. digitado)
          </span>
          <p className="text-lg font-black text-rose-800 mt-1">{formatCurrency(Math.abs(totalRealDesemb))}</p>
          <span className="text-[10px] text-rose-700">
            Automático: {formatCurrency(Math.abs(totalAutoDesemb))} • Previsto: {formatCurrency(Math.abs(totalPrevDesemb))}
          </span>
        </div>
        <div className={`p-4 rounded-xl shadow-xs border ${saldoFinalReal >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${saldoFinalReal >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
            <TrendingUp className="w-3.5 h-3.5" /> Saldo Final (Real. digitado)
          </span>
          <p className={`text-lg font-black mt-1 ${saldoFinalReal >= 0 ? 'text-blue-800' : 'text-amber-800'}`}>{formatCurrency(saldoFinalReal)}</p>
          <span className={`text-[10px] ${saldoFinalReal >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
            Automático: {formatCurrency(saldoFinalAuto)} • Previsto: {formatCurrency(saldoFinalPrev)}
          </span>
        </div>
      </div>

      {/* ── POSIÇÃO DE CAIXA HOJE x COMPROMISSOS = NECESSIDADE DE APORTE ───── */}
      <div className={`rounded-xl shadow-xs border overflow-hidden ${necessidadeAporte > 0 ? 'border-rose-300' : 'border-[#EAE6DF]'}`}>
        <div className={`p-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${necessidadeAporte > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-[#EAE6DF]'}`}>
          <div className="flex items-center gap-2">
            <Wallet className={`w-4 h-4 ${necessidadeAporte > 0 ? 'text-rose-600' : 'text-[#C19A6B]'}`} />
            <h3 className="text-sm font-bold text-[#2D2A26]">Posição de Caixa Hoje — Necessidade de Aporte</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-bold text-[#8B7D6B] uppercase">Data da posição</label>
            <input
              type="date"
              disabled={!canEdit}
              value={posicaoData}
              onChange={(e) => setDraft((d) => ({ ...d, posicaoData: e.target.value }))}
              className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
            />
            <label className="text-[10px] font-bold text-[#8B7D6B] uppercase ml-2">Compromissos em</label>
            <select
              disabled={!canEdit}
              value={horizonteDias}
              onChange={(e) => setDraft((d) => ({ ...d, horizonteAporteDias: parseInt(e.target.value, 10) }))}
              className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-2 py-1.5 text-[11px] font-bold focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
            >
              {[0, 7, 15, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d === 0 ? 'vencidos + hoje' : `${d} dias`}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-[#EAE6DF] bg-white">
          {/* Coluna 1 — dinheiro que existe */}
          <div className="p-4 space-y-2">
            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Dinheiro disponível (contado)</p>
            {contas.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={!canEdit}
                  value={c.nome}
                  onChange={(e) => setConta(idx, 'nome', e.target.value)}
                  placeholder="Conta (ex: Bradesco)"
                  className="flex-1 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-2.5 py-1.5 text-[11px] text-[#433E37] focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!canEdit}
                  value={displayValue(editKey('conta', idx), c.saldo)}
                  onChange={(e) => beginEdit(editKey('conta', idx), e.target.value, (raw) => setConta(idx, 'saldo', raw))}
                  onBlur={() => endEdit(editKey('conta', idx))}
                  placeholder="0,00"
                  className="w-32 bg-emerald-50/60 border border-[#EAE6DF] rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-right text-emerald-800 font-semibold focus:outline-none focus:border-emerald-400 disabled:opacity-60"
                />
                {canEdit && (
                  <button
                    onClick={() => removeConta(idx)}
                    className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white transition-colors"
                    title="Remover conta"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                onClick={addConta}
                className="px-2.5 py-1.5 text-[10px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF] flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-[#C19A6B]" /> Adicionar conta
              </button>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-dashed border-[#EAE6DF]">
              <span className="text-[11px] font-bold text-[#433E37]">Total disponível</span>
              <span className="text-sm font-black font-mono text-emerald-700">{formatCurrency(disponivelHoje)}</span>
            </div>
          </div>

          {/* Coluna 2 — o que precisa sair */}
          <div className="p-4 space-y-2">
            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">
              Compromissos até {formatIsoBr(addDaysIso(hojeIso, horizonteDias))}
            </p>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#433E37]">Títulos a vencer (RFN046)</span>
              <span className="font-mono font-semibold text-rose-700">{formatCurrency(compromissosTitulos - titulosVencidos)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#433E37]">Títulos vencidos e não pagos</span>
              <span className="font-mono font-semibold text-rose-800">{formatCurrency(titulosVencidos)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#433E37]">Pendências digitadas</span>
              <span className="font-mono font-semibold text-rose-700">{formatCurrency(totalPendencias)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-dashed border-[#EAE6DF]">
              <span className="text-[11px] font-bold text-[#433E37]">Total a pagar</span>
              <span className="text-sm font-black font-mono text-rose-700">{formatCurrency(compromissosTotal)}</span>
            </div>
            <p className="text-[10px] text-[#8B7D6B] pt-1">
              {titulosNoHorizonte.length} título(s) do RFN046
              {totalPendencias > 0 && ` + ${pendencias.length} pendência(s) digitada(s)`}.
              O que não estiver importado nem digitado aqui, o sistema não tem como saber.
            </p>
          </div>

          {/* Coluna 3 — o veredicto */}
          <div className={`p-4 flex flex-col justify-center gap-2 ${necessidadeAporte > 0 ? 'bg-rose-50/60' : 'bg-emerald-50/40'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#433E37]">Saldo após compromissos</span>
              <span className={`text-lg font-black font-mono ${saldoProjetado >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatCurrency(saldoProjetado)}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#EAE6DF] overflow-hidden">
              <div
                className={`h-full ${cobertura >= 100 ? 'bg-emerald-500' : cobertura >= 80 ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${Math.min(100, Math.max(0, cobertura))}%` }}
              />
            </div>
            <p className="text-[10px] text-[#8B7D6B]">
              Cobertura: <b>{cobertura.toFixed(1)}%</b> dos compromissos têm dinheiro correspondente.
            </p>

            {necessidadeAporte > 0 ? (
              <div className="bg-white border border-rose-300 rounded-lg p-3 space-y-2">
                <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Necessidade de aporte
                </p>
                <p className="text-xl font-black font-mono text-rose-700">{formatCurrency(necessidadeAporte)}</p>
                <p className="text-[10px] text-[#8B7D6B]">
                  {formatCurrency(compromissosTotal)} a pagar − {formatCurrency(disponivelHoje)} em caixa.
                </p>
                {canEdit && (
                  <button
                    onClick={lancarAporte}
                    className="w-full px-3 py-2 text-[11px] font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg flex items-center justify-center gap-1.5"
                    title={`Soma a necessidade ao campo Aportes de ${WEEK_LABELS[semanaAtual]} (revise e salve)`}
                  >
                    <Plus className="w-3.5 h-3.5 text-[#C19A6B]" />
                    Lançar como aporte em {WEEK_LABELS[semanaAtual]}
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white border border-emerald-200 rounded-lg p-3">
                <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Caixa cobre os compromissos
                </p>
                <p className="text-[10px] text-[#8B7D6B] mt-1">
                  Sobra de {formatCurrency(saldoProjetado)} depois de pagar tudo o que vence no horizonte.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Conferência: caixa contado x saldo projetado pela grade */}
        {disponivelHoje !== 0 && (
          <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#EAE6DF] text-[10px] text-[#8B7D6B] flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Grade (saldo realizado até {WEEK_LABELS[semanaAtual]}): <b className="font-mono">{formatCurrency(saldoProjetadoGrade)}</b>
            </span>
            <span>
              Caixa contado: <b className="font-mono text-emerald-700">{formatCurrency(disponivelHoje)}</b>
            </span>
            <span className={Math.abs(divergenciaGrade) > 1 ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>
              Divergência: {formatCurrency(divergenciaGrade)}
              {Math.abs(divergenciaGrade) > 1 && ' — falta lançamento no realizado ou o saldo inicial está errado'}
            </span>
            {canEdit && Math.abs(divergenciaGrade) > 1 && (
              <button
                onClick={() => setDraft((d) => ({ ...d, saldoInicial: (d.saldoInicial || 0) + divergenciaGrade, useSaldoAutomatico: false }))}
                className="px-2 py-1 text-[10px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded border border-[#EAE6DF]"
                title="Ajusta o saldo inicial do mês para que a grade termine exatamente no caixa contado"
              >
                Ajustar saldo inicial pela diferença
              </button>
            )}
          </div>
        )}
      </div>

      {/* Saldo inicial editável + controles do automático */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <label className="text-xs font-bold text-[#433E37] whitespace-nowrap">Saldo inicial de {monthLabel}:</label>
        <input
          type="text"
          disabled={!canEdit}
          value={displayValue(editKey('saldoInicial'), draft.saldoInicial)}
          onChange={(e) =>
            beginEdit(editKey('saldoInicial'), e.target.value, (raw) =>
              setDraft((d) => ({ ...d, saldoInicial: parseInput(raw), useSaldoAutomatico: false }))
            )
          }
          onBlur={() => endEdit(editKey('saldoInicial'))}
          placeholder="0,00"
          className="w-40 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-sm font-mono text-right focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
        />
        {previousMonthFinalSaldo != null && canEdit && (
          <button
            onClick={inheritSaldo}
            className="px-3 py-2 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF] flex items-center gap-1.5"
            title="Usar o saldo final realizado do mês anterior"
          >
            <RefreshCcw className="w-3.5 h-3.5 text-[#C19A6B]" />
            Herdar do mês anterior ({formatCurrency(previousMonthFinalSaldo)})
          </button>
        )}
        <div className="lg:ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] font-bold text-[#433E37] cursor-pointer select-none" title="Soma os títulos a vencer (RFN046) aos desembolsos da coluna automática, na semana do vencimento.">
            <input
              type="checkbox"
              checked={includeForecast}
              onChange={(e) => setIncludeForecast(e.target.checked)}
              className="accent-[#C19A6B] w-4 h-4"
            />
            Somar títulos a vencer no automático
            {totalForecast > 0 && (
              <span className="text-[10px] font-mono text-rose-700">({formatCurrency(totalForecast)})</span>
            )}
          </label>
          {canEdit && (
            <button
              onClick={copyMonthAutoToReal}
              className="px-3 py-2 text-[11px] font-bold bg-[#C19A6B]/15 text-[#8a6c45] hover:bg-[#C19A6B] hover:text-white rounded-lg border border-[#C19A6B]/30 flex items-center gap-1.5 transition-colors"
              title="Copia o automático de todas as semanas para a coluna REAL. (você ainda pode ajustar antes de salvar)"
            >
              <CornerRightDown className="w-3.5 h-3.5" />
              Copiar automático → realizado (mês)
            </button>
          )}
        </div>
      </div>

      {/* Grade principal Previsto x Automático x Realizado */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[1280px]">
            <thead>
              <tr className="bg-[#2D2A26] text-[#EAE6DF]">
                <th className="p-2.5 text-left sticky left-0 bg-[#2D2A26] z-10 min-w-[150px]">Linha</th>
                {WEEKS.map((w) => (
                  <th key={w} colSpan={3} className="p-2 text-center border-l border-[#3F3B35]">{WEEK_LABELS[w]}</th>
                ))}
                <th colSpan={3} className="p-2 text-center border-l border-[#C19A6B] bg-[#3F3B35]">TOTAL</th>
              </tr>
              <tr className="bg-[#3F3B35] text-[#EAE6DF]/80 text-[10px]">
                <th className="p-1.5 sticky left-0 bg-[#3F3B35] z-10"></th>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <th className="p-1.5 text-center border-l border-[#4a453d] font-semibold">PREV.</th>
                    <th className="p-1.5 text-center font-semibold text-[#9fb8c9]" title="Calculado pelo sistema: extrato + títulos a vencer. Não entra nos resultados.">AUTOM.</th>
                    <th className="p-1.5 text-center font-semibold text-[#C19A6B]" title="Digitado por você. É o que alimenta os resultados.">REAL.</th>
                  </React.Fragment>
                ))}
                <th className="p-1.5 text-center border-l border-[#C19A6B] font-semibold">PREV.</th>
                <th className="p-1.5 text-center font-semibold text-[#9fb8c9]">AUTOM.</th>
                <th className="p-1.5 text-center font-semibold text-[#C19A6B]">REAL.</th>
              </tr>
            </thead>
            <tbody className="text-[#433E37]">
              {/* Recebimentos */}
              <tr className="border-b border-[#EAE6DF] hover:bg-[#FDFBF7]">
                <td className="p-2 font-bold sticky left-0 bg-white z-10">Recebimentos</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className="p-1 border-l border-[#EAE6DF]">
                      <input
                        type="text" disabled={!canEdit}
                        value={displayValue(editKey('receb', w), draft.weeks[w].recebimentos)}
                        onChange={(e) => beginEdit(editKey('receb', w), e.target.value, (raw) => setWeekValue(w, 'recebimentos', raw))}
                        onBlur={() => endEdit(editKey('receb', w))}
                        placeholder="0"
                        className="w-full bg-emerald-50/40 border border-transparent hover:border-emerald-200 focus:border-emerald-400 rounded px-1.5 py-1 text-right font-mono text-[11px] focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="p-1 bg-[#F9F7F2]/60">{autoCell(rows.autoReceb(w), 'receb', w)}</td>
                    <td className="p-1">
                      <input
                        type="text" disabled={!canEdit}
                        value={displayValue(editKey('recebReal', w), draft.weeks[w].recebRealizado || 0)}
                        onChange={(e) => beginEdit(editKey('recebReal', w), e.target.value, (raw) => setWeekValue(w, 'recebRealizado', raw))}
                        onBlur={() => endEdit(editKey('recebReal', w))}
                        placeholder="0"
                        className="w-full bg-emerald-100/50 border border-transparent hover:border-emerald-300 focus:border-emerald-500 rounded px-1.5 py-1 text-right font-mono text-[11px] text-emerald-800 font-semibold focus:outline-none disabled:opacity-60"
                      />
                    </td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B]/40 bg-[#F9F7F2]">{formatCurrency(totalPrevReceb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-emerald-600/90 bg-[#F9F7F2]">{formatCurrency(totalAutoReceb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-emerald-700 bg-[#F9F7F2]">{formatCurrency(totalRealReceb)}</td>
              </tr>

              {/* Desembolsos */}
              <tr className="border-b border-[#EAE6DF] hover:bg-[#FDFBF7]">
                <td className="p-2 font-bold sticky left-0 bg-white z-10">Desembolsos</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className="p-1 border-l border-[#EAE6DF]">
                      <input
                        type="text" disabled={!canEdit}
                        value={displayValue(editKey('desemb', w), draft.weeks[w].desembolsos)}
                        onChange={(e) => beginEdit(editKey('desemb', w), e.target.value, (raw) => setWeekValue(w, 'desembolsos', raw))}
                        onBlur={() => { normalizeDesembolso(w, 'desembolsos'); endEdit(editKey('desemb', w)); }}
                        title="Saída de caixa — o valor é gravado negativo automaticamente"
                        placeholder="0"
                        className="w-full bg-rose-50/40 border border-transparent hover:border-rose-200 focus:border-rose-400 rounded px-1.5 py-1 text-right font-mono text-[11px] focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="p-1 bg-[#F9F7F2]/60">{autoCell(rows.autoDesemb(w), 'desemb', w)}</td>
                    <td className="p-1">
                      <input
                        type="text" disabled={!canEdit}
                        value={displayValue(editKey('desembReal', w), draft.weeks[w].desembRealizado || 0)}
                        onChange={(e) => beginEdit(editKey('desembReal', w), e.target.value, (raw) => setWeekValue(w, 'desembRealizado', raw))}
                        onBlur={() => { normalizeDesembolso(w, 'desembRealizado'); endEdit(editKey('desembReal', w)); }}
                        title="Saída de caixa — o valor é gravado negativo automaticamente"
                        placeholder="0"
                        className="w-full bg-rose-100/50 border border-transparent hover:border-rose-300 focus:border-rose-500 rounded px-1.5 py-1 text-right font-mono text-[11px] text-rose-800 font-semibold focus:outline-none disabled:opacity-60"
                      />
                    </td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B]/40 bg-[#F9F7F2]">{formatCurrency(totalPrevDesemb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-rose-600/90 bg-[#F9F7F2]">{formatCurrency(totalAutoDesemb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-rose-700 bg-[#F9F7F2]">{formatCurrency(totalRealDesemb)}</td>
              </tr>

              {/* Títulos a vencer (parcela de previsão dentro do automático) */}
              {totalForecast > 0 && (
                <tr className="border-b border-[#EAE6DF] bg-amber-50/40">
                  <td className="p-2 font-semibold text-[11px] sticky left-0 bg-amber-50 z-10 flex items-center gap-1">
                    <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Títulos a vencer</span>
                  </td>
                  {WEEKS.map((w) => (
                    <React.Fragment key={w}>
                      <td className="p-1.5 border-l border-[#EAE6DF] text-center text-[10px] text-[#B9AFA0]">—</td>
                      <td className="p-1.5 text-right font-mono text-[11px] text-amber-700 font-semibold bg-[#F9F7F2]/60">
                        {forecastWeeks[w] ? formatCurrency(forecastWeeks[w]) : '—'}
                      </td>
                      <td className="p-1.5 text-center text-[10px] text-[#B9AFA0]">—</td>
                    </React.Fragment>
                  ))}
                  <td className="p-1.5 border-l border-[#C19A6B]/40 bg-[#F9F7F2] text-center text-[10px] text-[#B9AFA0]">—</td>
                  <td className="p-1.5 text-right font-mono text-[11px] font-bold text-amber-700 bg-[#F9F7F2]">{formatCurrency(totalForecast)}</td>
                  <td className="p-1.5 bg-[#F9F7F2] text-center text-[10px] text-[#B9AFA0]">—</td>
                </tr>
              )}

              {/* Geração de Caixa */}
              <tr className="border-b-2 border-[#EAE6DF] bg-[#F9F7F2]/50">
                <td className="p-2 font-black sticky left-0 bg-[#F9F7F2] z-10">Geração de Caixa</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#EAE6DF] ${rows.prevGer(w) >= 0 ? 'text-[#2D2A26]' : 'text-rose-600'}`}>{formatCurrency(rows.prevGer(w))}</td>
                    <td className={`p-1.5 text-right font-mono text-[11px] ${rows.autoGer(w) >= 0 ? 'text-[#6b8fa3]' : 'text-rose-500'}`}>{formatCurrency(rows.autoGer(w))}</td>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-bold ${rows.realGer(w) >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatCurrency(rows.realGer(w))}</td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-black border-l border-[#C19A6B]/40 bg-[#EAE6DF]/50">{formatCurrency(totalPrevReceb + totalPrevDesemb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-[#6b8fa3] bg-[#EAE6DF]/50">{formatCurrency(totalAutoReceb + totalAutoDesemb)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-black bg-[#EAE6DF]/50">{formatCurrency(totalRealReceb + totalRealDesemb)}</td>
              </tr>

              {/* Aportes */}
              <tr className="border-b border-[#EAE6DF] hover:bg-[#FDFBF7]">
                <td className="p-2 font-bold sticky left-0 bg-white z-10">Aportes</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className="p-1 border-l border-[#EAE6DF]">
                      <input
                        type="text" disabled={!canEdit}
                        value={displayValue(editKey('aporte', w), draft.weeks[w].aportes)}
                        onChange={(e) => beginEdit(editKey('aporte', w), e.target.value, (raw) => setWeekValue(w, 'aportes', raw))}
                        onBlur={() => endEdit(editKey('aporte', w))}
                        placeholder="0"
                        className="w-full bg-[#C19A6B]/10 border border-transparent hover:border-[#C19A6B]/40 focus:border-[#C19A6B] rounded px-1.5 py-1 text-right font-mono text-[11px] focus:outline-none disabled:opacity-60"
                      />
                    </td>
                    <td className="p-1.5 text-right font-mono text-[11px] text-[#8B7D6B] bg-[#F9F7F2]/60">{formatCurrency(rows.aporte(w))}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] text-[#8B7D6B]">{formatCurrency(rows.aporte(w))}</td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B]/40 bg-[#F9F7F2]">{formatCurrency(totalAporte)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-[#8B7D6B] bg-[#F9F7F2]">{formatCurrency(totalAporte)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-[#8B7D6B] bg-[#F9F7F2]">{formatCurrency(totalAporte)}</td>
              </tr>

              {/* Saldo de Caixa */}
              <tr className="bg-[#2D2A26] text-[#EAE6DF]">
                <td className="p-2 font-black sticky left-0 bg-[#2D2A26] z-10">Saldo de Caixa</td>
                {WEEKS.map((w) => (
                  <React.Fragment key={w}>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#3F3B35] ${rows.prevSaldo[w] >= 0 ? 'text-[#EAE6DF]' : 'text-rose-300'}`}>{formatCurrency(rows.prevSaldo[w])}</td>
                    <td className={`p-1.5 text-right font-mono text-[11px] ${rows.autoSaldo[w] >= 0 ? 'text-[#9fb8c9]' : 'text-rose-300'}`}>{formatCurrency(rows.autoSaldo[w])}</td>
                    <td className={`p-1.5 text-right font-mono text-[11px] font-black ${rows.realSaldo[w] >= 0 ? 'text-[#C19A6B]' : 'text-rose-300'}`}>{formatCurrency(rows.realSaldo[w])}</td>
                  </React.Fragment>
                ))}
                <td className="p-1.5 text-right font-mono text-[11px] font-bold border-l border-[#C19A6B] bg-[#3F3B35]">{formatCurrency(saldoFinalPrev)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-bold text-[#9fb8c9] bg-[#3F3B35]">{formatCurrency(saldoFinalAuto)}</td>
                <td className="p-1.5 text-right font-mono text-[11px] font-black text-[#C19A6B] bg-[#3F3B35]">{formatCurrency(saldoFinalReal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#EAE6DF] text-[10px] text-[#8B7D6B] flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <b className="text-emerald-700">PREV.</b> e <b className="text-[#C19A6B]">REAL.</b> são digitáveis.
          </span>
          <span className="flex items-center gap-1">
            <Info className="w-3.5 h-3.5 text-[#6b8fa3]" />
            <b className="text-[#6b8fa3]">AUTOM.</b> vem do Extrato Financeiro
            {includeForecast && ' + títulos a vencer (Previsão de Pagamento)'} e não entra em nenhum cálculo de resultado.
          </span>
          <span className="flex items-center gap-1">
            <CornerRightDown className="w-3.5 h-3.5 text-[#C19A6B]" /> copia o valor da semana para o REAL.
          </span>
        </div>
      </div>

      {/* Divergência automático x digitado (alerta de conferência) */}
      {(Math.abs(divReceb) > 0.5 || Math.abs(divDesemb) > 0.5) && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#6b8fa3] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-[#2D2A26]">Recebimentos: digitado x automático</p>
              <p className={`text-sm font-black font-mono ${Math.abs(divReceb) > 0.5 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {divReceb >= 0 ? '+' : ''}{formatCurrency(divReceb)}
              </p>
              <p className="text-[10px] text-[#8B7D6B]">
                Diferença entre o que você digitou ({formatCurrency(totalRealReceb)}) e o extrato ({formatCurrency(totalAutoReceb)}).
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#6b8fa3] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-[#2D2A26]">Desembolsos: digitado x automático</p>
              <p className={`text-sm font-black font-mono ${Math.abs(divDesemb) > 0.5 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {divDesemb >= 0 ? '+' : ''}{formatCurrency(divDesemb)}
              </p>
              <p className="text-[10px] text-[#8B7D6B]">
                O automático inclui {includeForecast ? 'títulos a vencer, que ainda não saíram do caixa' : 'apenas o extrato'}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabelas de apoio */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recebimentos por tipo */}
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Recebimentos por Tipo (Extrato)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                <tr>
                  <th className="p-2 text-left">Tipo</th>
                  {WEEKS.map((w) => (<th key={w} className="p-2 text-right">{WEEK_LABELS[w].replace('Semana ', 'S')}</th>))}
                  <th className="p-2 text-right border-l border-[#EAE6DF]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {receiptTypes.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-[#8B7D6B]">Sem recebimentos no extrato deste mês.</td></tr>
                )}
                {receiptTypes.map((t) => {
                  const row = realized.recebByType[t];
                  const total = WEEKS.reduce((a, w) => a + row[w], 0);
                  return (
                    <tr key={t} className="hover:bg-[#FDFBF7]">
                      <td className="p-2 font-semibold text-[#433E37]">{t}</td>
                      {WEEKS.map((w) => (<td key={w} className="p-2 text-right font-mono text-[#433E37]">{row[w] ? formatCurrency(row[w]) : '—'}</td>))}
                      <td className="p-2 text-right font-mono font-bold text-emerald-700 border-l border-[#EAE6DF]">{formatCurrency(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Desembolsos por origem */}
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-rose-600" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Desembolsos por Origem (Extrato)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                <tr>
                  <th className="p-2 text-left">Origem</th>
                  {WEEKS.map((w) => (<th key={w} className="p-2 text-right">{WEEK_LABELS[w].replace('Semana ', 'S')}</th>))}
                  <th className="p-2 text-right border-l border-[#EAE6DF]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {paymentSources.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-[#8B7D6B]">Sem desembolsos no extrato deste mês.</td></tr>
                )}
                {paymentSources.map((s) => {
                  const row = realized.desembBySource[s];
                  const total = WEEKS.reduce((a, w) => a + row[w], 0);
                  return (
                    <tr key={s} className="hover:bg-[#FDFBF7]">
                      <td className="p-2 font-semibold text-[#433E37]">{s}</td>
                      {WEEKS.map((w) => (<td key={w} className="p-2 text-right font-mono text-[#433E37]">{row[w] ? formatCurrency(row[w]) : '—'}</td>))}
                      <td className="p-2 text-right font-mono font-bold text-rose-700 border-l border-[#EAE6DF]">{formatCurrency(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Previsão de desembolsos futuros por semana */}
      {totalForecast > 0 && (
        <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
          <div className="p-3 border-b border-[#EAE6DF] flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Previsão de Desembolsos — Títulos a Vencer em {monthLabel}</h3>
            <span className="text-[10px] text-[#8B7D6B]">— importados em Contas a Pagar → Previsão de Pagamento (RFN046)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                <tr>
                  <th className="p-2 text-left">Origem</th>
                  {WEEKS.map((w) => (<th key={w} className="p-2 text-right">{WEEK_LABELS[w].replace('Semana ', 'S')}</th>))}
                  <th className="p-2 text-right border-l border-[#EAE6DF]">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2 font-semibold text-[#433E37]">Títulos em aberto (por vencimento)</td>
                  {WEEKS.map((w) => (
                    <td key={w} className="p-2 text-right font-mono text-[#433E37]">
                      {forecastWeeks[w] ? formatCurrency(forecastWeeks[w]) : '—'}
                    </td>
                  ))}
                  <td className="p-2 text-right font-mono font-bold text-amber-700 border-l border-[#EAE6DF]">{formatCurrency(totalForecast)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#EAE6DF] text-[10px] text-[#8B7D6B]">
            Estes valores ainda <b>não saíram</b> do caixa. Entram na coluna AUTOM. como projeção e nunca no REAL. — quando
            o título é pago e aparece no RFN006, ele é quitado automaticamente na previsão e deixa de ser contado aqui.
          </div>
        </div>
      )}

      {/* Pendências (obrigações em aberto) */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-[#EAE6DF] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-[#C19A6B]" />
            <h3 className="text-sm font-bold text-[#2D2A26]">Pendências — Obrigações em Aberto</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#8B7D6B]">Total:</span>
            <span className="text-sm font-black text-rose-700">{formatCurrency(totalPendencias)}</span>
            {canEdit && (
              <button
                onClick={addPendencia}
                className="px-2.5 py-1.5 text-[11px] font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg border border-[#EAE6DF] flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5 text-[#C19A6B]" /> Adicionar
              </button>
            )}
          </div>
        </div>
        <div className="p-4">
          {pendencias.length === 0 ? (
            <p className="text-xs text-[#8B7D6B] text-center py-3">Nenhuma pendência registrada para {monthLabel}/{selectedYear}.</p>
          ) : (
            <div className="space-y-2">
              {pendencias.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={p.descricao}
                    onChange={(e) => setPendencia(idx, 'descricao', e.target.value)}
                    placeholder="Descrição (ex: PRÓ-LABORE REF JULHO/2026)"
                    className="flex-1 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs text-[#433E37] focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
                  />
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={displayValue(editKey('pendencia', idx), p.valor)}
                    onChange={(e) => beginEdit(editKey('pendencia', idx), e.target.value, (raw) => setPendencia(idx, 'valor', raw))}
                    onBlur={() => endEdit(editKey('pendencia', idx))}
                    placeholder="0,00"
                    className="w-36 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-mono text-right text-rose-700 font-semibold focus:outline-none focus:border-[#C19A6B] disabled:opacity-60"
                  />
                  {canEdit && (
                    <button
                      onClick={() => removePendencia(idx)}
                      className="p-2 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white transition-colors"
                      title="Remover pendência"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-[#8B7D6B] mt-3">
            Pendências são obrigações ainda não pagas que <b>não estão no RFN046</b> (pró-labore, aluguel, acordos,
            empréstimos). Não alteram o saldo realizado — mas <b>entram integralmente no cálculo da necessidade de
            aporte</b> lá em cima, junto com os títulos a vencer. É aqui que se digita o que o sistema não tem como
            adivinhar.
          </p>
        </div>
      </div>

      {/* Rodapé de acurácia */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-[#8B7D6B]">
          Acurácia do planejamento (Realizado digitado / Previsto de recebimentos):
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40 h-2 rounded-full bg-[#EAE6DF] overflow-hidden">
            <div
              className={`h-full ${acuracia >= 90 ? 'bg-emerald-500' : acuracia >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
              style={{ width: `${Math.min(100, acuracia)}%` }}
            />
          </div>
          <span className="text-sm font-black text-[#2D2A26]">{acuracia.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
};
