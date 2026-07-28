/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DailyMovementView — MOVIMENTO DIÁRIO: o caixa realizado, dia a dia.
 *
 * O QUE ESTA TELA É (E O QUE ELA NÃO É)
 * =====================================
 * É o extrato gerencial do que JÁ ACONTECEU: para cada dia do período, quanto
 * entrou (contas a receber baixadas) e quanto saiu (contas a pagar baixadas),
 * lado a lado, com o saldo do dia e o acumulado.
 *
 * NÃO é previsão. O Fluxo de Caixa e a aba de Previsão do Contas a Pagar já
 * respondem "o que vai vencer". Aqui só entra dinheiro com lastro: título com
 * status de baixa conciliado E data de pagamento. Sem baixa, não contabiliza —
 * essa é a regra inteira, e ela está isolada em `dailyLedger.isSettled` para
 * não existir uma segunda versão dela espalhada pelo componente.
 *
 * COMO O PERÍODO FUNCIONA
 * -----------------------
 * A tela abre no MÊS DE REFERÊNCIA atual (01 até o último dia do mês corrente),
 * porque é a pergunta que se faz todo dia. Os campos de data início/fim ficam
 * visíveis ao lado, já preenchidos com esse mês: mudar qualquer um deles muda o
 * recorte na hora, sem botão de "aplicar". Os atalhos (mês anterior, últimos 7
 * dias, hoje) são só formas rápidas de escrever nesses dois campos — não existe
 * um segundo estado de período escondido atrás deles.
 *
 * A data-base é FIXA em pagamento, e isso é intencional: a pergunta desta tela
 * é de caixa. Quem precisa de competência (vencimento) tem a tela de Contas a
 * Receber/Pagar, que oferece as três bases.
 *
 * SEGURANÇA APLICADA AQUI
 * -----------------------
 *  • Nenhum `dangerouslySetInnerHTML`, nenhum `eval`, nenhuma URL montada com
 *    dado do ERP. Todo texto exibido passa por `safeText` no motor.
 *  • As datas dos inputs vão para `clampRange` antes de qualquer cálculo:
 *    `<input type="date">` não é validação, é conveniência.
 *  • A exportação passa por `csvSafe` (injeção de fórmula em Excel).
 *  • Render limitado: `MAX_VISIBLE_ROWS` no dia a dia e `MAX_DETAIL_ROWS` no
 *    detalhe, para uma base grande não travar a aba do navegador.
 *  • `analista` não exporta (dado financeiro consolidado sai do sistema em
 *    arquivo; quem pode tirar isso de dentro é decisão de papel, não de tela).
 */

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Scale,
  Search,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';

import { TituloFinanceiro, UserRole } from '../types';
import { formatCurrency, exportReportToExcel } from '../utils/exportUtils';
import {
  DayRow,
  LedgerEntry,
  MAX_RANGE_DAYS,
  buildDailyLedger,
  clampRange,
  currentMonthRef,
  flattenEntries,
  monthRange,
  rollupByPerson,
  toDetailSheetRows,
  toSheetRows,
  addDays,
} from '../utils/dailyLedger';
import { MONTH_LABELS, formatIsoBr, todayIso } from '../utils/periodFilter';

/** Teto de linhas de dia renderizadas de uma vez. Acima disso, o botão "ver mais". */
const MAX_VISIBLE_ROWS = 120;

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface DailyMovementViewProps {
  /** Títulos de ENTRADA já carregados pelo App (contas_a_receber). */
  receivables: TituloFinanceiro[];
  /** Títulos de SAÍDA já carregados pelo App (contas_a_pagar). */
  payables: TituloFinanceiro[];
  selectedYear: number;
  userRole: UserRole | string;
}

// ─── Peças visuais ───────────────────────────────────────────────────────────

const Kpi: React.FC<{
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone: 'entrada' | 'saida' | 'neutro' | 'alerta';
  sub?: string;
}> = ({ label, value, hint, icon: Icon, tone, sub }) => {
  const tones: Record<string, string> = {
    entrada: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    saida: 'text-rose-700 bg-rose-50 border-rose-100',
    neutro: 'text-[#2D2A26] bg-[#F9F7F2] border-[#EAE6DF]',
    alerta: 'text-amber-700 bg-amber-50 border-amber-100',
  };
  return (
    <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs" title={hint}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B]">{label}</span>
        <span className={`p-1.5 rounded-lg border ${tones[tone]}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      <p className="mt-2 text-xl font-black tabular-nums text-[#2D2A26] break-all">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[#8B7D6B]">{sub}</p>}
    </div>
  );
};

/** Barra proporcional — leitura de relevância sem precisar comparar números. */
const Bar: React.FC<{ value: number; max: number; tone: 'entrada' | 'saida' }> = ({ value, max, tone }) => {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full bg-[#F3F1ED] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${tone === 'entrada' ? 'bg-emerald-500' : 'bg-rose-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

/** Lista de títulos de um lado dentro do dia aberto. */
const EntryList: React.FC<{ entries: LedgerEntry[]; tone: 'entrada' | 'saida'; emptyLabel: string }> = ({
  entries,
  tone,
  emptyLabel,
}) => {
  if (entries.length === 0) {
    return <p className="text-[11px] text-[#B5AA99] italic py-2">{emptyLabel}</p>;
  }
  return (
    <div className="divide-y divide-[#F3F1ED]">
      {entries.map((e) => (
        <div key={`${e.movType}-${e.id}`} className="py-2 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-[#2D2A26] truncate">{e.personName}</p>
            <p className="text-[10px] text-[#8B7D6B] truncate">
              {e.titleNumber || e.titleCode}
              {e.parcela ? ` · ${e.parcela}` : ''}
              {e.titleType ? ` · ${e.titleType}` : ''}
              {e.collectionAgent ? ` · ${e.collectionAgent}` : ''}
            </p>
            <p className="text-[10px] text-[#B5AA99]">
              Venc. {formatIsoBr(e.dueDate)}
              {e.delayDays > 0 && <span className="text-amber-700 font-bold"> · {e.delayDays}d de atraso</span>}
              {e.delayDays < 0 && <span className="text-emerald-700 font-bold"> · {Math.abs(e.delayDays)}d adiantado</span>}
              {e.partial && <span className="text-amber-700 font-bold"> · parcial</span>}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-xs font-black tabular-nums ${tone === 'entrada' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatCurrency(e.settled)}
            </p>
            <p className="text-[10px] text-[#B5AA99]">{e.status}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Tela ────────────────────────────────────────────────────────────────────

export const DailyMovementView: React.FC<DailyMovementViewProps> = ({
  receivables,
  payables,
  selectedYear,
  userRole,
}) => {
  const podeExportar = userRole === 'admin' || userRole === 'gestor';

  // O mês de referência ancora tudo. Começa no mês corrente; se o exercício
  // selecionado no topo do sistema não for o ano corrente, ancora em janeiro
  // desse exercício — mostrar "julho/2026" com a base de 2025 carregada seria
  // uma tela vazia sem explicação.
  const hojeRef = currentMonthRef();
  const anoBase = Number(selectedYear) || hojeRef.year;
  const mesBase = anoBase === hojeRef.year ? hojeRef.month : 1;

  const [refYear, setRefYear] = useState<number>(anoBase);
  const [refMonth, setRefMonth] = useState<number>(mesBase);

  const inicial = monthRange(anoBase, mesBase);
  const [startInput, setStartInput] = useState<string>(inicial.start);
  const [endInput, setEndInput] = useState<string>(inicial.end);

  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [search, setSearch] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState(MAX_VISIBLE_ROWS);

  // Trocar o exercício no topo do sistema recarrega outra base: o período tem
  // de acompanhar, senão a tela fica mostrando um mês que não existe nos dados.
  useEffect(() => {
    const ano = Number(selectedYear) || hojeRef.year;
    const mes = ano === hojeRef.year ? hojeRef.month : 1;
    const r = monthRange(ano, mes);
    setRefYear(ano);
    setRefMonth(mes);
    setStartInput(r.start);
    setEndInput(r.end);
    setOpenDay(null);
    setVisibleRows(MAX_VISIBLE_ROWS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  /** Escrever no mês de referência reescreve os dois campos de data. */
  const aplicarMesRef = useCallback((ano: number, mes: number) => {
    const r = monthRange(ano, mes);
    setRefYear(ano);
    setRefMonth(mes);
    setStartInput(r.start);
    setEndInput(r.end);
    setOpenDay(null);
    setVisibleRows(MAX_VISIBLE_ROWS);
  }, []);

  const aplicarIntervalo = useCallback((ini: string, fim: string) => {
    setStartInput(ini);
    setEndInput(fim);
    setOpenDay(null);
    setVisibleRows(MAX_VISIBLE_ROWS);
  }, []);

  // TODA data que entra no cálculo passa por aqui. Ver `clampRange`.
  const range = useMemo(
    () => clampRange(startInput, endInput, { year: refYear, month: refMonth }),
    [startInput, endInput, refYear, refMonth]
  );

  // A busca é adiada: digitar remonta o livro inteiro, e sem `useDeferredValue`
  // cada tecla trava a digitação numa base grande.
  const buscaAdiada = useDeferredValue(search);

  const ledger = useMemo(
    () => buildDailyLedger(receivables, payables, range, { hideEmptyDays, search: buscaAdiada }),
    [receivables, payables, range, hideEmptyDays, buscaAdiada]
  );

  const maxDia = useMemo(
    () => Math.max(1, ...ledger.rows.map((r) => Math.max(r.receber.total, r.pagar.total))),
    [ledger.rows]
  );

  const topReceber = useMemo(() => rollupByPerson(ledger.rows, 'receber', 6), [ledger.rows]);
  const topPagar = useMemo(() => rollupByPerson(ledger.rows, 'pagar', 6), [ledger.rows]);

  const linhasVisiveis = ledger.rows.slice(0, visibleRows);
  const restante = ledger.rows.length - linhasVisiveis.length;

  const exportar = useCallback(
    (modo: 'resumo' | 'detalhe') => {
      if (!podeExportar) return;
      const sufixo = `${range.start}_a_${range.end}`;
      if (modo === 'resumo') {
        const linhas = toSheetRows(ledger);
        if (linhas.length === 0) return;
        exportReportToExcel(linhas, 'Movimento diario', `Movimento_Diario_${sufixo}.xlsx`);
      } else {
        const linhas = toDetailSheetRows(flattenEntries(ledger.rows, 'ambos'));
        if (linhas.length === 0) return;
        exportReportToExcel(linhas, 'Titulos baixados', `Movimento_Diario_Detalhe_${sufixo}.xlsx`);
      }
    },
    [ledger, podeExportar, range.start, range.end]
  );

  const inputCls =
    'px-2.5 py-1.5 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#2D2A26] focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40 tabular-nums';
  const btnCls =
    'px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-[#EAE6DF] bg-[#F9F7F2] text-[#433E37] hover:bg-[#F3F1ED] transition-colors';

  const hoje = todayIso();
  const pendenciaTotal = ledger.pendenteReceber.total + ledger.pendentePagar.total;

  return (
    <div className="space-y-6">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#2D2A26] flex items-center gap-2">
            <Wallet className="w-6 h-6 text-[#C19A6B]" />
            Movimento Diário
          </h1>
          <p className="text-sm text-[#8B7D6B] mt-0.5">
            Caixa realizado dia a dia — só títulos <b>baixados</b> (conciliados com extrato/caixa).
            Sem baixa, não contabiliza.
          </p>
        </div>

        {podeExportar && (
          <div className="flex items-center gap-2">
            <button onClick={() => exportar('resumo')} className={btnCls} title="Uma linha por dia, com os totais">
              <Download className="w-3.5 h-3.5 inline mr-1" />
              Resumo por dia
            </button>
            <button onClick={() => exportar('detalhe')} className={btnCls} title="Um título por linha, com valores e status de baixa">
              <Download className="w-3.5 h-3.5 inline mr-1" />
              Detalhe dos títulos
            </button>
          </div>
        )}
      </div>

      {/* ── Barra de período ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-[#EAE6DF]">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B] mr-1">
            <CalendarDays className="w-3.5 h-3.5" />
            Mês de referência
          </span>

          <select
            value={refMonth}
            onChange={(e) => aplicarMesRef(refYear, Number(e.target.value))}
            className={inputCls}
          >
            {MONTH_KEYS.map((k, i) => (
              <option key={k} value={i + 1}>
                {MONTH_LABELS[k]}
              </option>
            ))}
          </select>

          <select
            value={refYear}
            onChange={(e) => aplicarMesRef(Number(e.target.value), refMonth)}
            className={inputCls}
          >
            {Array.from({ length: 6 }, (_, i) => anoBase - 3 + i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <div className="w-px h-6 bg-[#EAE6DF] mx-1 hidden md:block" />

          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B]">De</span>
          <input
            type="date"
            value={startInput}
            onChange={(e) => aplicarIntervalo(e.target.value, endInput)}
            className={inputCls}
          />
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B]">até</span>
          <input
            type="date"
            value={endInput}
            onChange={(e) => aplicarIntervalo(startInput, e.target.value)}
            className={inputCls}
          />

          <div className="flex items-center gap-1 ml-1">
            <button className={btnCls} onClick={() => aplicarIntervalo(hoje, hoje)} title="Só o dia de hoje">
              Hoje
            </button>
            <button
              className={btnCls}
              onClick={() => aplicarIntervalo(addDays(hoje, -6), hoje)}
              title="Sete dias contando hoje"
            >
              7 dias
            </button>
            <button
              className={btnCls}
              onClick={() => aplicarMesRef(refMonth === 1 ? refYear - 1 : refYear, refMonth === 1 ? 12 : refMonth - 1)}
              title="Fecha o mês anterior inteiro"
            >
              Mês anterior
            </button>
            <button
              className={btnCls}
              onClick={() => aplicarMesRef(hojeRef.year, hojeRef.month)}
              title="Volta ao mês corrente"
            >
              Mês atual
            </button>
          </div>

          <div className="flex-1" />

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8B7D6B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              maxLength={80}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, fornecedor, nº do título…"
              className={`${inputCls} pl-8 w-56 font-medium`}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B7D6B] hover:text-[#2D2A26]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#433E37] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideEmptyDays}
              onChange={(e) => setHideEmptyDays(e.target.checked)}
              className="accent-[#C19A6B]"
            />
            Ocultar dias sem movimento
          </label>
        </div>

        {/* Resumo textual do recorte — para quem imprime ou tira print da tela */}
        <div className="px-4 py-2 bg-[#F9F7F2] rounded-b-xl flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#8B7D6B]">
          <span>
            Mostrando <b className="text-[#2D2A26]">{formatIsoBr(range.start)}</b> a{' '}
            <b className="text-[#2D2A26]">{formatIsoBr(range.end)}</b> ({range.days} dia{range.days === 1 ? '' : 's'}) por{' '}
            <b className="text-[#2D2A26]">data de pagamento</b>.
          </span>
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3" />
            Só entram títulos com baixa conciliada — o que o ERP diz &quot;pago&quot; mas ninguém baixou fica no bloco de
            pendências abaixo.
          </span>
          <span>
            <b className="text-[#2D2A26] tabular-nums">{ledger.activeDays}</b> de {range.days} dia(s) com movimento.
          </span>
          {(ledger.foraDoPeriodo.receber > 0 || ledger.foraDoPeriodo.pagar > 0) && (
            <span>
              {ledger.foraDoPeriodo.receber + ledger.foraDoPeriodo.pagar} título(s) baixado(s) fora deste período.
            </span>
          )}
          {range.notice && <span className="text-amber-700 font-bold">{range.notice}</span>}
          {range.days >= MAX_RANGE_DAYS && (
            <span className="text-amber-700 font-bold">Limite de {MAX_RANGE_DAYS} dias por consulta.</span>
          )}
        </div>
      </div>

      {/* ── KPIs do período ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Recebido no período"
          value={formatCurrency(ledger.receber.total)}
          sub={`${ledger.receber.count} título(s) baixado(s)`}
          hint="Soma dos títulos de entrada com baixa conciliada e data de pagamento dentro do período."
          icon={ArrowDownCircle}
          tone="entrada"
        />
        <Kpi
          label="Pago no período"
          value={formatCurrency(ledger.pagar.total)}
          sub={`${ledger.pagar.count} título(s) baixado(s)`}
          hint="Soma dos títulos de saída com baixa conciliada e data de pagamento dentro do período."
          icon={ArrowUpCircle}
          tone="saida"
        />
        <Kpi
          label="Saldo do período"
          value={formatCurrency(ledger.net)}
          sub={ledger.net >= 0 ? 'Entrou mais do que saiu' : 'Saiu mais do que entrou'}
          hint="Recebido menos pago, no recorte inteiro. É a geração de caixa comprovada do período."
          icon={Scale}
          tone={ledger.net >= 0 ? 'entrada' : 'saida'}
        />
        <Kpi
          label="Média por dia com movimento"
          value={formatCurrency(ledger.receber.avgPerActiveDay - ledger.pagar.avgPerActiveDay)}
          sub={`Recebe ${formatCurrency(ledger.receber.avgPerActiveDay)} · Paga ${formatCurrency(ledger.pagar.avgPerActiveDay)}`}
          hint="Média calculada só sobre os dias que tiveram movimento — dia zerado não dilui o número."
          icon={TrendingUp}
          tone="neutro"
        />
      </div>

      {/* ── Pendência de baixa ────────────────────────────────────────────── */}
      {pendenciaTotal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-black text-amber-900">
                {formatCurrency(pendenciaTotal)} fora do fluxo por falta de baixa
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Títulos que o ERP marca como pagos (ou que têm data de pagamento) mas cuja baixa ainda não foi
                conciliada com o extrato. Enquanto estiverem assim, eles <b>não entram</b> nos totais acima — e o
                fluxo de caixa está incompleto nesse valor.
              </p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white/70 rounded-lg p-2.5 border border-amber-200">
                  <p className="text-[10px] uppercase font-bold text-amber-800">A receber sem baixa</p>
                  <p className="text-sm font-black tabular-nums text-amber-900">
                    {formatCurrency(ledger.pendenteReceber.total)}{' '}
                    <span className="text-[11px] font-bold">({ledger.pendenteReceber.count} título(s))</span>
                  </p>
                  <p className="text-[10px] text-amber-800 mt-0.5">
                    {Object.entries(ledger.pendenteReceber.porStatus)
                      .map(([k, v]) => `${k}: ${v.count}`)
                      .join(' · ') || '—'}
                  </p>
                </div>
                <div className="bg-white/70 rounded-lg p-2.5 border border-amber-200">
                  <p className="text-[10px] uppercase font-bold text-amber-800">A pagar sem baixa</p>
                  <p className="text-sm font-black tabular-nums text-amber-900">
                    {formatCurrency(ledger.pendentePagar.total)}{' '}
                    <span className="text-[11px] font-bold">({ledger.pendentePagar.count} título(s))</span>
                  </p>
                  <p className="text-[10px] text-amber-800 mt-0.5">
                    {Object.entries(ledger.pendentePagar.porStatus)
                      .map(([k, v]) => `${k}: ${v.count}`)
                      .join(' · ') || '—'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-amber-800 mt-2">
                Para resolver: abra <b>Contas a Receber</b> / <b>Contas a Pagar</b> → aba <b>Conciliação</b> e rode a
                baixa automática contra o extrato do período.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabela dia a dia ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EAE6DF] flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-[#2D2A26]">Somatório por dia</h2>
          <span className="text-[11px] text-[#8B7D6B]">Clique na linha para ver os títulos baixados do dia</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F9F7F2] text-[10px] uppercase tracking-wider text-[#8B7D6B]">
              <tr>
                <th className="px-4 py-2 text-left font-bold w-8"> </th>
                <th className="px-2 py-2 text-left font-bold">Dia</th>
                <th className="px-2 py-2 text-right font-bold">Qtd</th>
                <th className="px-2 py-2 text-right font-bold text-emerald-700">Recebido</th>
                <th className="px-2 py-2 text-left font-bold w-24 hidden lg:table-cell"> </th>
                <th className="px-2 py-2 text-right font-bold">Qtd</th>
                <th className="px-2 py-2 text-right font-bold text-rose-700">Pago</th>
                <th className="px-2 py-2 text-left font-bold w-24 hidden lg:table-cell"> </th>
                <th className="px-2 py-2 text-right font-bold">Saldo do dia</th>
                <th className="px-4 py-2 text-right font-bold">Acumulado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F1ED]">
              {linhasVisiveis.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[#8B7D6B] text-sm">
                    Nenhum título baixado neste período.
                    {ledger.pendenteReceber.count + ledger.pendentePagar.count > 0
                      ? ' Há títulos pagos aguardando conciliação — veja o bloco de pendências acima.'
                      : ' Verifique o período e o exercício selecionado.'}
                  </td>
                </tr>
              )}

              {linhasVisiveis.map((r: DayRow) => {
                const aberto = openDay === r.date;
                const semMovimento = r.receber.count === 0 && r.pagar.count === 0;
                const ehHoje = r.date === hoje;
                return (
                  <React.Fragment key={r.date}>
                    <tr
                      onClick={() => setOpenDay(aberto ? null : r.date)}
                      className={`cursor-pointer transition-colors ${
                        aberto ? 'bg-[#F9F7F2]' : semMovimento ? 'bg-white' : 'hover:bg-[#FBFAF7]'
                      } ${r.weekend ? 'text-[#B5AA99]' : ''}`}
                    >
                      <td className="px-4 py-2 text-[#8B7D6B]">
                        {aberto ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className={`font-bold tabular-nums ${ehHoje ? 'text-[#C19A6B]' : 'text-[#2D2A26]'}`}>
                          {r.date.slice(8, 10)}/{r.date.slice(5, 7)}
                        </span>
                        <span className="ml-1.5 text-[10px] uppercase text-[#8B7D6B]">{r.weekday}</span>
                        {ehHoje && (
                          <span className="ml-1.5 text-[9px] uppercase font-black text-[#C19A6B] tracking-wider">hoje</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-[11px] tabular-nums text-[#8B7D6B]">
                        {r.receber.count || '—'}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold text-emerald-700">
                        {r.receber.total > 0 ? formatCurrency(r.receber.total) : <span className="text-[#D5CEC3]">—</span>}
                      </td>
                      <td className="px-2 py-2 hidden lg:table-cell">
                        <Bar value={r.receber.total} max={maxDia} tone="entrada" />
                      </td>
                      <td className="px-2 py-2 text-right text-[11px] tabular-nums text-[#8B7D6B]">
                        {r.pagar.count || '—'}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold text-rose-700">
                        {r.pagar.total > 0 ? formatCurrency(r.pagar.total) : <span className="text-[#D5CEC3]">—</span>}
                      </td>
                      <td className="px-2 py-2 hidden lg:table-cell">
                        <Bar value={r.pagar.total} max={maxDia} tone="saida" />
                      </td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums font-black ${
                          r.net > 0 ? 'text-emerald-700' : r.net < 0 ? 'text-rose-700' : 'text-[#D5CEC3]'
                        }`}
                      >
                        {r.net !== 0 ? formatCurrency(r.net) : '—'}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums font-bold ${
                          r.accumulated >= 0 ? 'text-[#2D2A26]' : 'text-rose-700'
                        }`}
                      >
                        {formatCurrency(r.accumulated)}
                      </td>
                    </tr>

                    {aberto && (
                      <tr>
                        <td colSpan={10} className="px-4 py-4 bg-[#FBFAF7] border-t border-[#EAE6DF]">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <h3 className="text-[11px] uppercase tracking-wider font-black text-emerald-700 flex items-center gap-1.5">
                                  <ArrowDownCircle className="w-3.5 h-3.5" />
                                  Recebimentos de {formatIsoBr(r.date)}
                                </h3>
                                <span className="text-xs font-black tabular-nums text-emerald-700">
                                  {formatCurrency(r.receber.total)}
                                </span>
                              </div>
                              <EntryList
                                entries={r.receber.entries}
                                tone="entrada"
                                emptyLabel="Nenhum recebimento baixado neste dia."
                              />
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <h3 className="text-[11px] uppercase tracking-wider font-black text-rose-700 flex items-center gap-1.5">
                                  <ArrowUpCircle className="w-3.5 h-3.5" />
                                  Pagamentos de {formatIsoBr(r.date)}
                                </h3>
                                <span className="text-xs font-black tabular-nums text-rose-700">
                                  {formatCurrency(r.pagar.total)}
                                </span>
                              </div>
                              <EntryList
                                entries={r.pagar.entries}
                                tone="saida"
                                emptyLabel="Nenhum pagamento baixado neste dia."
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>

            {ledger.rows.length > 0 && (
              <tfoot className="bg-[#F9F7F2] border-t-2 border-[#EAE6DF]">
                <tr className="text-sm">
                  <td className="px-4 py-3" />
                  <td className="px-2 py-3 font-black text-[#2D2A26] uppercase text-[11px] tracking-wider">
                    Total do período
                  </td>
                  <td className="px-2 py-3 text-right text-[11px] tabular-nums font-bold text-[#8B7D6B]">
                    {ledger.receber.count}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums font-black text-emerald-700">
                    {formatCurrency(ledger.receber.total)}
                  </td>
                  <td className="hidden lg:table-cell" />
                  <td className="px-2 py-3 text-right text-[11px] tabular-nums font-bold text-[#8B7D6B]">
                    {ledger.pagar.count}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums font-black text-rose-700">
                    {formatCurrency(ledger.pagar.total)}
                  </td>
                  <td className="hidden lg:table-cell" />
                  <td
                    className={`px-2 py-3 text-right tabular-nums font-black ${
                      ledger.net >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {formatCurrency(ledger.net)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-black text-[#2D2A26]">
                    {formatCurrency(ledger.net)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {restante > 0 && (
          <div className="px-4 py-3 border-t border-[#EAE6DF] text-center">
            <button onClick={() => setVisibleRows((v) => v + MAX_VISIBLE_ROWS)} className={btnCls}>
              Mostrar mais {Math.min(restante, MAX_VISIBLE_ROWS)} dia(s) — restam {restante}
            </button>
          </div>
        )}
      </div>

      {/* ── Concentração por pessoa ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {([
          { titulo: 'Maiores recebimentos do período', dados: topReceber, tone: 'entrada' as const, total: ledger.receber.total },
          { titulo: 'Maiores pagamentos do período', dados: topPagar, tone: 'saida' as const, total: ledger.pagar.total },
        ]).map((bloco) => (
          <div key={bloco.titulo} className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs">
            <div className="px-4 py-3 border-b border-[#EAE6DF] flex items-center justify-between">
              <h2 className="text-sm font-black text-[#2D2A26]">{bloco.titulo}</h2>
              <span className={`text-xs font-black tabular-nums ${bloco.tone === 'entrada' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatCurrency(bloco.total)}
              </span>
            </div>
            <div className="p-4 space-y-2.5">
              {bloco.dados.length === 0 && <p className="text-[11px] text-[#B5AA99] italic">Sem movimento no período.</p>}
              {bloco.dados.map((p) => (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-bold text-[#2D2A26] truncate">{p.name}</span>
                    <span className="text-xs font-black tabular-nums text-[#2D2A26] shrink-0">
                      {formatCurrency(p.total)}
                      <span className="ml-1.5 text-[10px] font-bold text-[#8B7D6B]">{p.share.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="mt-1">
                    <Bar value={p.total} max={bloco.dados[0]?.total || 1} tone={bloco.tone} />
                  </div>
                  <p className="text-[10px] text-[#B5AA99] mt-0.5">
                    {p.count} título(s){p.code ? ` · cód. ${p.code}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DailyMovementView;
