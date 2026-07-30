/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TitulosWorkspace — a tela de Contas a Receber E a de Contas a Pagar.
 *
 * POR QUE UMA SÓ TELA PARA OS DOIS LADOS
 * ======================================
 * Receber e pagar saem do mesmo relatório (RFN046), com as mesmas 34 colunas e
 * as mesmas perguntas: quanto entrou/saiu, quanto falta, o que está vencido,
 * o que já bateu com o extrato. Manter duas telas irmãs significa que toda
 * melhoria precisa ser feita duas vezes — e, na prática, é feita uma vez só,
 * até as duas divergirem e ninguém saber qual está certa.
 *
 * O componente recebe `movType` e muda três coisas: o vocabulário (recebido x
 * pago, cliente x fornecedor), a cor de acento (âmbar para entrada, ardósia
 * para saída) e o painel exclusivo de cada lado (Aging de cobrança no receber,
 * Previsão de desembolso no pagar). O resto — filtros, tabela, conciliação,
 * importação — é literalmente o mesmo código.
 *
 * AS QUATRO ABAS
 * --------------
 *   PAINEL       leitura executiva: KPIs, curva do mês, concentração por pessoa
 *   TÍTULOS      a base linha a linha, com busca, filtro e ordenação
 *   CONCILIAÇÃO  baixa automática contra o extrato, com régua ajustável
 *   IMPORTAR     prévia auditável do RFN046 antes de qualquer gravação
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  Info,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  TrendingUp,
  UploadCloud,
  Users,
  X,
  Plus,
} from 'lucide-react';

import {
  BaixaStatus,
  Customer,
  FinancialStatementEntry,
  ReconciliationMatch,
  ReconciliationSettings,
  TituloFinanceiro,
  TituloMovType,
  TituloPreviewRow,
} from '../types';
import { formatCurrency, exportReportToExcel, parseNumberPtBr } from '../utils/exportUtils';
import {
  detectMovType,
  looksLikeRfn046,
  missingRfn046Headers,
  parseRfn046Rows,
  summarizeTitulos,
} from '../utils/rfn046Parser';
import { reconcile } from '../utils/reconciliation';
import { buildCustomerIndex, normalizePersonCode } from '../utils/linking';
import {
  PAYMENT_ACCOUNTS,
  PAYMENT_ACCOUNT_BY_CODE,
  addCustomAccount,
  buildStatementIndex,
  getAllPaymentAccounts,
  getPaymentAccountByCode,
  resolveTituloOrigin,
  summarizeByOrigin,
  PaymentAccount,
  PaymentForm,
} from '../utils/paymentAccounts';
import {
  DATE_BASIS_LABEL,
  PeriodFilterState,
  addDaysIso,
  defaultPeriodFilter,
  filterByPeriod,
  diffDaysIso,
  formatIsoBr,
  resolvePeriod,
  round2,
  sumBy,
  todayIso,
  yearsFromItems,
} from '../utils/periodFilter';
import { PeriodFilterBar } from './PeriodFilterBar';

// ─── Vocabulário por lado do movimento ───────────────────────────────────────

interface MovTheme {
  title: string;
  subtitle: string;
  personLabel: string;
  personLabelPlural: string;
  paidLabel: string;
  openLabel: string;
  flowLabel: string;
  accent: string;      // classe de cor do acento
  accentBg: string;
  accentBorder: string;
  icon: React.ElementType;
  statementSide: string;
  /** Cabeçalho da coluna de conta: em Pagar o dinheiro sai, em Receber entra. */
  originLabel: string;
  originHint: string;
}

const THEME: Record<TituloMovType, MovTheme> = {
  R: {
    title: 'Contas a Receber',
    subtitle: 'Títulos de ENTRADA (RFN046 · Titulo_MovimentoFinanceiro = R)',
    personLabel: 'Cliente',
    personLabelPlural: 'Clientes',
    paidLabel: 'Recebido',
    openLabel: 'A receber',
    flowLabel: 'entrada',
    accent: 'text-emerald-700',
    accentBg: 'bg-emerald-50',
    accentBorder: 'border-emerald-200',
    icon: ArrowDownCircle,
    statementSide: 'crédito no extrato',
    originLabel: 'Conta de entrada',
    originHint: 'em qual conta o dinheiro entrou',
  },
  P: {
    title: 'Contas a Pagar',
    subtitle: 'Títulos de SAÍDA (RFN046 · Titulo_MovimentoFinanceiro = P)',
    personLabel: 'Fornecedor',
    personLabelPlural: 'Fornecedores',
    paidLabel: 'Pago',
    openLabel: 'A pagar',
    flowLabel: 'saída',
    accent: 'text-rose-700',
    accentBg: 'bg-rose-50',
    accentBorder: 'border-rose-200',
    icon: ArrowUpCircle,
    statementSide: 'débito no extrato',
    originLabel: 'Conta de origem',
    originHint: 'de qual conta o dinheiro saiu',
  },
};

type SubTab = 'painel' | 'titulos' | 'conciliacao' | 'importar';

const MONTH_LABEL: Record<string, string> = {
  jan: 'Jan', fev: 'Fev', mar: 'Mar', abr: 'Abr', mai: 'Mai', jun: 'Jun',
  jul: 'Jul', ago: 'Ago', set: 'Set', out: 'Out', nov: 'Nov', dez: 'Dez',
};
const MONTH_ORDER = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ─── Blocos visuais reutilizados ─────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white border border-[#EAE6DF] rounded-xl shadow-xs ${className}`}>{children}</div>
);

const Kpi: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutro' | 'bom' | 'alerta' | 'ruim' | 'destaque';
  icon?: React.ElementType;
}> = ({ label, value, hint, tone = 'neutro', icon: Icon }) => {
  const tones: Record<string, string> = {
    neutro: 'bg-white border-[#EAE6DF] text-[#2D2A26]',
    bom: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    alerta: 'bg-amber-50 border-amber-200 text-amber-900',
    ruim: 'bg-rose-50 border-rose-200 text-rose-900',
    destaque: 'bg-[#2D2A26] border-[#2D2A26] text-white',
  };
  return (
    <div className={`p-4 rounded-xl border shadow-xs ${tones[tone]}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 opacity-70" />}
        <p className="text-[10px] uppercase tracking-wider font-bold opacity-70">{label}</p>
      </div>
      <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
      {hint && <p className="text-[11px] mt-1 opacity-70">{hint}</p>}
    </div>
  );
};

const StatusPill: React.FC<{ status: BaixaStatus }> = ({ status }) => {
  const map: Record<BaixaStatus, string> = {
    'Em Aberto': 'bg-[#F3F1ED] text-[#8B7D6B] border-[#EAE6DF]',
    'Baixado Automático': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Baixado Manual': 'bg-blue-50 text-blue-700 border-blue-200',
    Conferir: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${map[status]}`}>
      {status}
    </span>
  );
};

const ErpPill: React.FC<{ titulo: TituloFinanceiro }> = ({ titulo }) => (
  <span
    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap ${
      titulo.isPaid ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-amber-100 text-amber-800 border-amber-300'
    }`}
    title={
      titulo.isPaid
        ? 'Titulo_Status = Pago — conta no REALIZADO do fluxo de caixa'
        : `Titulo_Status = ${titulo.erpStatus} — conta na PREVISÃO, não no realizado`
    }
  >
    {titulo.erpStatus || '—'}
  </span>
);

/** Barra de proporção — leitura de concentração sem precisar de gráfico. */
const Bar: React.FC<{ value: number; max: number; className?: string }> = ({ value, max, className = 'bg-[#C19A6B]' }) => (
  <div className="h-1.5 w-full bg-[#F3F1ED] rounded-full overflow-hidden">
    <div className={`h-full rounded-full ${className}`} style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
  </div>
);

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TitulosWorkspaceProps {
  movType: TituloMovType;
  titulos: TituloFinanceiro[];
  /** Extrato COMPLETO (todos os anos) — a conciliação depende disso. */
  statementEntries: FinancialStatementEntry[];
  customers: Customer[];
  selectedYear: number;
  settings: ReconciliationSettings;
  onSaveSettings: (s: ReconciliationSettings) => void;
  onImport: (titulos: TituloFinanceiro[]) => Promise<void>;
  onApplyMatches: (matches: ReconciliationMatch[], status: BaixaStatus) => Promise<void>;
  onManualBaixa: (id: string, statementId?: string, source?: string) => Promise<void>;
  /**
   * Grava a conta de origem apontada pelo gestor. `accountKey` vazio LIMPA a
   * escolha e devolve o título à conta inferida pela baixa — sem esse caminho de
   * volta, uma conta selecionada por engano ficaria presa para sempre.
   */
  onSetOrigin: (id: string, accountKey: string, accountLabel: string) => Promise<void>;
  onRevertBaixa: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
  userRole: string;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export const TitulosWorkspace: React.FC<TitulosWorkspaceProps> = ({
  movType,
  titulos,
  statementEntries,
  customers,
  selectedYear,
  settings,
  onSaveSettings,
  onImport,
  onApplyMatches,
  onManualBaixa,
  onSetOrigin,
  onRevertBaixa,
  onDelete,
  onClear,
  userRole,
}) => {
  const t = THEME[movType];
  const canEdit = userRole === 'admin' || userRole === 'gestor';
  const hoje = todayIso();

  const [subTab, setSubTab] = useState<SubTab>('painel');
  const [busy, setBusy] = useState<string>('');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null);

  // ── Filtros da aba TÍTULOS ────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'pago' | 'aberto' | 'vencido'>('todos');
  const [baixaFilter, setBaixaFilter] = useState<'todos' | BaixaStatus>('todos');
  const [deptFilter, setDeptFilter] = useState('todos');
  const [linkFilter, setLinkFilter] = useState<'todos' | 'vinculados' | 'sem_vinculo'>('todos');
  // Filtro por conta de origem. 'sem_origem' isola justamente o que falta o
  // gestor apontar — é a fila de trabalho dele, e sem o filtro seria preciso
  // caçar essas linhas no meio de centenas já resolvidas.
  const [originFilter, setOriginFilter] = useState<string>('todos');
  const [sortKey, setSortKey] = useState<'dueDate' | 'amount' | 'personName' | 'paymentDate'>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 40;

  // ── Baixa manual: busca no extrato ─────────────────────────────────────────
  // Janela padrão ±15 dias (30 dias no total) em torno da data do título —
  // ampla o bastante para achar o lançamento mesmo quando o banco compensa
  // alguns dias depois do combinado, sem forçar o gestor a abrir o extrato à
  // parte para conferir na mão.
  const BAIXA_SEARCH_WINDOW_DEFAULT = 15;
  const [baixaSearchTarget, setBaixaSearchTarget] = useState<TituloFinanceiro | null>(null);
  const [baixaSearchDays, setBaixaSearchDays] = useState(BAIXA_SEARCH_WINDOW_DEFAULT);
  const [baixaSearchAmount, setBaixaSearchAmount] = useState('');
  const [baixaSearchQuery, setBaixaSearchQuery] = useState('');
  const [baixaBusy, setBaixaBusy] = useState(false);
  const [baixaError, setBaixaError] = useState<string | null>(null);

  // ── Estado da importação ──────────────────────────────────────────────────
  const [preview, setPreview] = useState<TituloPreviewRow[] | null>(null);
  const [previewFile, setPreviewFile] = useState('');
  const [previewIssues, setPreviewIssues] = useState<string[]>([]);
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Contas de Origem (Nativas + Customizadas) ──────────────────────────────
  const [accountsList, setAccountsList] = useState<PaymentAccount[]>(() => getAllPaymentAccounts());
  const [isCreateOriginOpen, setIsCreateOriginOpen] = useState(false);
  const [createOriginTargetTituloId, setCreateOriginTargetTituloId] = useState<string | null>(null);
  const [newOriginName, setNewOriginName] = useState('');
  const [newOriginForm, setNewOriginForm] = useState<PaymentForm>('Banco');
  const [newOriginCode, setNewOriginCode] = useState('');
  const [newOriginDesc, setNewOriginDesc] = useState('');

  const openCreateOriginModal = (targetTituloId?: string) => {
    setCreateOriginTargetTituloId(targetTituloId || null);
    setNewOriginName('');
    setNewOriginForm('Banco');
    setNewOriginCode('');
    setNewOriginDesc('');
    setIsCreateOriginOpen(true);
  };

  const handleCreateCustomOrigin = () => {
    if (!newOriginName.trim()) return;
    const created = addCustomAccount({
      label: newOriginName.trim(),
      paymentForm: newOriginForm,
      accountCode: newOriginCode.trim(),
      description: newOriginDesc.trim(),
    });

    const updated = getAllPaymentAccounts();
    setAccountsList(updated);

    if (createOriginTargetTituloId) {
      onSetOrigin(createOriginTargetTituloId, created.code, created.label);
    }

    setIsCreateOriginOpen(false);
    setCreateOriginTargetTituloId(null);
    setFeedback({ tone: 'ok', text: `Conta "${created.label}" cadastrada com sucesso!` });
  };

  // ── Estado da conciliação ─────────────────────────────────────────────────
  const [draft, setDraft] = useState<ReconciliationSettings>(settings);
  const [result, setResult] = useState<ReturnType<typeof reconcile> | null>(null);

  const customerIndex = useMemo(() => buildCustomerIndex(customers), [customers]);

  // ── Baixa manual: busca no extrato ─────────────────────────────────────────
  //
  // Lançamentos já vinculados a OUTRO título não entram na lista — evita casar
  // o mesmo crédito bancário com dois títulos diferentes. O lançamento já
  // vinculado a ESTE título continua aparecendo, para permitir revisar ou
  // trocar a baixa sem precisar reverter primeiro.
  const usedStatementIds = useMemo(
    () => new Set(titulos.filter((x) => x.reconciledStatementId).map((x) => x.reconciledStatementId as string)),
    [titulos]
  );

  const openBaixaSearch = useCallback((titulo: TituloFinanceiro) => {
    setBaixaSearchTarget(titulo);
    setBaixaSearchDays(BAIXA_SEARCH_WINDOW_DEFAULT);
    setBaixaSearchAmount(String(titulo.balance > 0 ? titulo.balance : titulo.amount));
    setBaixaSearchQuery('');
    setBaixaError(null);
  }, []);

  const closeBaixaSearch = useCallback(() => {
    setBaixaSearchTarget(null);
    setBaixaError(null);
    setBaixaBusy(false);
  }, []);

  /**
   * Data de referência da busca: pagamento quando existe, senão vencimento.
   * Título ainda "Em Aberto" no ERP normalmente não tem `paymentDate` — buscar
   * ao redor do VENCIMENTO é a melhor aposta disponível para achar o
   * lançamento que baixou esse compromisso.
   */
  const baixaSearchBaseDate = baixaSearchTarget
    ? baixaSearchTarget.paymentDate || baixaSearchTarget.dueDate
    : '';

  const baixaSearchResults = useMemo(() => {
    if (!baixaSearchTarget || !baixaSearchBaseDate) return [];
    const alvo = baixaSearchTarget;
    const janela = Math.max(1, Math.min(90, baixaSearchDays));
    const valorBuscado = parseNumberPtBr(baixaSearchAmount);
    const temValorBuscado = Number.isFinite(valorBuscado) && valorBuscado > 0;
    const termo = baixaSearchQuery.trim().toLowerCase();

    const inicio = addDaysIso(baixaSearchBaseDate, -janela);
    const fim = addDaysIso(baixaSearchBaseDate, janela);

    const matches = statementEntries
      .filter((e) => {
        const valorLado = movType === 'R' ? e.entryAmount : e.exitAmount;
        if (!(valorLado > 0)) return false;
        if (usedStatementIds.has(e.id) && e.id !== alvo.reconciledStatementId) return false;
        if (e.date < inicio || e.date > fim) return false;
        if (termo) {
          const alvoTexto = `${e.description || ''} ${e.clientName || ''} ${e.documentRef || ''}`.toLowerCase();
          if (!alvoTexto.includes(termo)) return false;
        }
        return true;
      })
      .map((e) => {
        const valorLado = movType === 'R' ? e.entryAmount : e.exitAmount;
        const diffDays = Math.abs(diffDaysIso(baixaSearchBaseDate, e.date));
        const diffAmount = temValorBuscado ? round2(Math.abs(valorLado - valorBuscado)) : 0;
        const quality: 'exato' | 'aproximado' = !temValorBuscado || diffAmount <= 0.01 ? 'exato' : 'aproximado';
        return { entry: e, valorLado, diffDays, diffAmount, quality };
      });

    matches.sort((a, b) => {
      if (a.quality !== b.quality) return a.quality === 'exato' ? -1 : 1;
      return a.diffAmount * 2 + a.diffDays - (b.diffAmount * 2 + b.diffDays);
    });

    return matches;
  }, [baixaSearchTarget, baixaSearchBaseDate, baixaSearchDays, baixaSearchAmount, baixaSearchQuery, statementEntries, usedStatementIds, movType]);

  const confirmBaixa = useCallback(
    async (statementId?: string, source?: string) => {
      if (!baixaSearchTarget || baixaBusy) return;
      setBaixaBusy(true);
      setBaixaError(null);
      try {
        await onManualBaixa(baixaSearchTarget.id, statementId, source);
        closeBaixaSearch();
      } catch (err) {
        setBaixaError(err instanceof Error ? err.message : 'Falha ao processar a baixa. Tente novamente.');
      } finally {
        setBaixaBusy(false);
      }
    },
    [baixaSearchTarget, baixaBusy, onManualBaixa, closeBaixaSearch]
  );

  // ── Recorte de período ────────────────────────────────────────────────────
  // Começa no exercício selecionado no topo do sistema, por VENCIMENTO — que é
  // a competência do compromisso e a régua com que o relatório fecha com o ERP.
  // A partir daí o gestor muda o intervalo e a data-base na própria barra.
  const [period, setPeriod] = useState<PeriodFilterState>(() => defaultPeriodFilter(selectedYear));

  // Trocar o exercício no topo do sistema arrasta o filtro junto, senão a tela
  // ficaria mostrando 2025 com "2026" escrito no cabeçalho.
  useEffect(() => {
    setPeriod((p) => (p.year === selectedYear ? p : { ...p, year: selectedYear }));
  }, [selectedYear]);

  const resolved = useMemo(() => resolvePeriod(period), [period]);

  const anosDisponiveis = useMemo(
    () => yearsFromItems(titulos, (t) => [t.dueDate, t.paymentDate, t.issueDate].filter(Boolean)),
    [titulos]
  );

  /** A base da tela: os títulos dentro do período, na data-base escolhida. */
  const doAno = useMemo(() => filterByPeriod(titulos, resolved), [titulos, resolved]);

  // ── Números do topo ───────────────────────────────────────────────────────
  // Todas as somas passam por `sumBy`, que acumula em CENTAVOS INTEIROS. Somar
  // 400 floats e arredondar no fim deixa resíduo (426610.79000000004); somando
  // inteiros, o total bate com o do ERP no centavo, que é o que permite conferir
  // sem "diferença de arredondamento" inexplicável no rodapé.
  const totals = useMemo(() => {
    const pagos = doAno.filter((x) => x.isPaid);
    const abertos = doAno.filter((x) => !x.isPaid);
    const vencidos = abertos.filter((x) => x.dueDate && x.dueDate < hoje);
    const conciliados = doAno.filter((x) => x.status === 'Baixado Automático' || x.status === 'Baixado Manual');
    const semVinculo = doAno.filter((x) => !customerIndex.get(normalizePersonCode(x.personCode)));

    return {
      totalCount: doAno.length,
      totalAmount: sumBy(doAno, (x) => x.amount),
      pagosCount: pagos.length,
      pagosAmount: sumBy(pagos, (x) => x.amount),
      abertosCount: abertos.length,
      abertosAmount: sumBy(abertos, (x) => x.balance),
      vencidosCount: vencidos.length,
      vencidosAmount: sumBy(vencidos, (x) => x.balance),
      conciliadosCount: conciliados.length,
      conciliadosAmount: sumBy(conciliados, (x) => x.amount),
      conciliadoPercent: pagos.length > 0 ? round2((conciliados.length / pagos.length) * 100) : 0,
      semVinculoCount: semVinculo.length,
      semVinculoAmount: sumBy(semVinculo, (x) => x.amount),
    };
  }, [doAno, hoje, customerIndex]);

  const departamentos = useMemo(
    () => Array.from(new Set(doAno.map((x) => x.department).filter(Boolean))).sort(),
    [doAno]
  );

  // ── Conta de origem do dinheiro ───────────────────────────────────────────
  //
  // O índice do extrato é montado UMA vez por render, não por título: resolver a
  // origem de 400 títulos varrendo 2.800 lançamentos em cada um seria mais de um
  // milhão de comparações a cada digitada no campo de busca.
  const statementIndex = useMemo(() => buildStatementIndex(statementEntries), [statementEntries]);

  const originByTitulo = useMemo(() => {
    const m = new Map<string, ReturnType<typeof resolveTituloOrigin>>();
    for (const x of doAno) m.set(x.id, resolveTituloOrigin(x, statementIndex));
    return m;
  }, [doAno, statementIndex]);

  // ── Curva mensal: previsto (vencimento) x realizado (pagamento) ───────────
  // Roda sobre a base COMPLETA do ano do filtro, não sobre o recorte: a curva é
  // o retrato do ano inteiro e serve de contexto para o recorte. Se ela também
  // fosse filtrada, escolher "últimos 30 dias" deixaria onze meses em branco e
  // o gráfico perderia a função de mostrar onde o recorte se encaixa.
  const curvaMensal = useMemo(() => {
    const cents = MONTH_ORDER.map((mk) => ({ mk, label: MONTH_LABEL[mk], previsto: 0, realizado: 0 }));
    const idx = new Map(cents.map((l) => [l.mk, l]));
    for (const x of titulos) {
      if (x.isPaid) {
        // Realizado mora no mês do PAGAMENTO — é quando o dinheiro se moveu.
        if (x.paidYear === period.year) {
          const l = idx.get(x.paidMonthKey);
          if (l) l.realizado += Math.round(x.amount * 100);
        }
      } else if (x.year === period.year) {
        const l = idx.get(x.monthKey);
        if (l) l.previsto += Math.round(x.balance * 100);
      }
    }
    return cents.map((l) => ({ ...l, previsto: l.previsto / 100, realizado: l.realizado / 100 }));
  }, [titulos, period.year]);

  const maxCurva = Math.max(1, ...curvaMensal.map((l) => Math.max(l.previsto, l.realizado)));

  // ── Concentração por pessoa ───────────────────────────────────────────────
  const porPessoa = useMemo(() => {
    const map = new Map<string, { code: string; name: string; total: number; aberto: number; count: number; linked: boolean }>();
    for (const x of doAno) {
      const key = normalizePersonCode(x.personCode) || x.personName;
      const cur = map.get(key) || {
        code: x.personCode,
        name: x.personName || '—',
        total: 0,
        aberto: 0,
        count: 0,
        linked: !!customerIndex.get(normalizePersonCode(x.personCode)),
      };
      // Acumula em centavos inteiros; a conversão para reais é feita no fim.
      cur.total += Math.round(x.amount * 100);
      if (!x.isPaid) cur.aberto += Math.round(x.balance * 100);
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ ...v, total: v.total / 100, aberto: v.aberto / 100 }))
      .sort((a, b) => b.total - a.total);
  }, [doAno, customerIndex]);

  // ── Aging (só faz sentido no que está vencido e em aberto) ────────────────
  const aging = useMemo(() => {
    const faixas = [
      { label: 'A vencer', min: -Infinity, max: -1, total: 0, count: 0, tone: 'bg-[#C19A6B]' },
      { label: '1 a 30 dias', min: 0, max: 30, total: 0, count: 0, tone: 'bg-amber-400' },
      { label: '31 a 60 dias', min: 31, max: 60, total: 0, count: 0, tone: 'bg-orange-500' },
      { label: '61 a 90 dias', min: 61, max: 90, total: 0, count: 0, tone: 'bg-rose-500' },
      { label: 'Acima de 90 dias', min: 91, max: Infinity, total: 0, count: 0, tone: 'bg-rose-800' },
    ];
    for (const x of doAno) {
      if (x.isPaid || !x.dueDate) continue;
      // `diffDaysIso` conta em UTC. Subtrair dois `new Date(...T00:00:00)` em
      // horário local erra por uma hora nas viradas de horário de verão, e o
      // `Math.floor` transforma essa hora em um dia inteiro — títulos pulando de
      // faixa de aging sozinhos, uma vez por ano, sem explicação.
      const dias = diffDaysIso(x.dueDate, hoje);
      const f = faixas.find((z) => dias >= z.min && dias <= z.max);
      if (f) {
        f.total += Math.round(x.balance * 100);
        f.count += 1;
      }
    }
    return faixas.map((f) => ({ ...f, total: f.total / 100 }));
  }, [doAno, hoje]);

  const agingMax = Math.max(1, ...aging.map((f) => f.total));

  // ── Lista filtrada da aba TÍTULOS ─────────────────────────────────────────
  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    let lista = doAno.filter((x) => {
      if (statusFilter === 'pago' && !x.isPaid) return false;
      if (statusFilter === 'aberto' && x.isPaid) return false;
      if (statusFilter === 'vencido' && (x.isPaid || !x.dueDate || x.dueDate >= hoje)) return false;
      if (baixaFilter !== 'todos' && x.status !== baixaFilter) return false;
      if (deptFilter !== 'todos' && x.department !== deptFilter) return false;
      if (linkFilter !== 'todos') {
        const linked = !!customerIndex.get(normalizePersonCode(x.personCode));
        if (linkFilter === 'vinculados' && !linked) return false;
        if (linkFilter === 'sem_vinculo' && linked) return false;
      }
      if (originFilter !== 'todos') {
        const o = originByTitulo.get(x.id);
        const key = o?.accountKey || '';
        if (originFilter === 'sem_origem' ? !!key : key !== originFilter) return false;
      }
      if (!q) return true;
      return (
        x.personName.toLowerCase().includes(q) ||
        x.personCode.toLowerCase().includes(q) ||
        x.titleCode.toLowerCase().includes(q) ||
        x.titleNumber.toLowerCase().includes(q) ||
        (x.observation || '').toLowerCase().includes(q) ||
        (x.department || '').toLowerCase().includes(q)
      );
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    lista = [...lista].sort((a, b) => {
      if (sortKey === 'amount') return (a.amount - b.amount) * dir;
      if (sortKey === 'personName') return a.personName.localeCompare(b.personName) * dir;
      const av = (sortKey === 'paymentDate' ? a.paymentDate : a.dueDate) || '';
      const bv = (sortKey === 'paymentDate' ? b.paymentDate : b.dueDate) || '';
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return lista;
  }, [doAno, search, statusFilter, baixaFilter, deptFilter, linkFilter, originFilter, originByTitulo, sortKey, sortDir, hoje, customerIndex]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtrados.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const filtradosTotal = sumBy(filtrados, (x) => (x.isPaid ? x.amount : x.balance));

  /**
   * AS SOMAS POR CONTA, POR FORMA DE PAGAMENTO E POR CLASSIFICAÇÃO DE DESPESA.
   *
   * Rodam sobre `filtrados`, não sobre a base inteira: o painel tem que
   * responder à pergunta que está na tela. Se somasse tudo, filtrar "junho" e ler
   * o total do ano ao lado seria uma armadilha — e é o tipo de número que vai
   * para uma reunião.
   *
   * Só títulos PAGOS entram. A pergunta "de que conta saiu" não existe para um
   * compromisso que ainda não foi pago; incluí-lo inflaria a conta com dinheiro
   * que não se moveu.
   */
  const originSummary = useMemo(
    () => summarizeByOrigin(filtrados, statementIndex, customerIndex, normalizePersonCode),
    [filtrados, statementIndex, customerIndex]
  );

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  };

  // ── Importação ────────────────────────────────────────────────────────────

  /**
   * Lê o arquivo e monta a prévia. NADA é gravado aqui: o gestor precisa ver o
   * total, o período e as linhas rejeitadas antes de a base ser tocada. Import
   * que grava direto é import que ninguém confere.
   */
  const handleFile = useCallback(
    async (file: File) => {
      setFeedback(null);
      setPreview(null);
      setPreviewIssues([]);
      setBusy('lendo');
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

        const issues: string[] = [];
        if (!looksLikeRfn046(rows)) {
          setFeedback({
            tone: 'erro',
            text: 'Este arquivo não parece um RFN046: faltam as colunas Titulo_Codigo / Titulo_MovimentoFinanceiro / Titulo_DataVencimento / Titulo_Status.',
          });
          setBusy('');
          return;
        }

        const faltantes = missingRfn046Headers(rows);
        if (faltantes.length > 0) issues.push(`Colunas do layout ausentes (serão gravadas vazias): ${faltantes.join(', ')}`);

        const det = detectMovType(rows);
        if (det.mixed)
          issues.push(
            `Arquivo MISTO: ${det.counts.R} linha(s) de entrada (R) e ${det.counts.P} de saída (P). Só as de ${
              movType === 'R' ? 'entrada' : 'saída'
            } serão aceitas nesta tela.`
          );
        if (det.movType && det.movType !== movType)
          issues.push(
            `O arquivo é predominantemente de ${det.movType === 'R' ? 'ENTRADA (R)' : 'SAÍDA (P)'} — abra a tela de ${
              det.movType === 'R' ? 'Contas a Receber' : 'Contas a Pagar'
            } para importá-lo.`
          );
        if (det.counts.indefinido > 0)
          issues.push(`${det.counts.indefinido} linha(s) sem Titulo_MovimentoFinanceiro — serão rejeitadas.`);

        const parsed = parseRfn046Rows(rows, movType);

        // Vínculo com o cadastro de clientes já na prévia: o gestor vê quantos
        // títulos vão entrar órfãos ANTES de gravar, e não depois de o relatório
        // por cliente sair com um buraco.
        for (const p of parsed) {
          const c = customerIndex.get(normalizePersonCode(p.titulo.personCode));
          if (c) p.titulo.customerId = c.id;
        }

        setPreview(parsed);
        setPreviewFile(file.name);
        setPreviewIssues(issues);
        setShowInvalidOnly(false);
      } catch (err) {
        console.error(err);
        setFeedback({ tone: 'erro', text: `Não foi possível ler o arquivo: ${(err as Error).message}` });
      } finally {
        setBusy('');
      }
    },
    [movType, customerIndex]
  );

  const previewSummary = useMemo(
    () => (preview ? summarizeTitulos(preview, movType, preview.filter((p) => p.valid && p.titulo.customerId).length) : null),
    [preview, movType]
  );

  const confirmarImportacao = async () => {
    if (!preview) return;
    const validos = preview.filter((p) => p.valid).map((p) => p.titulo);
    if (validos.length === 0) {
      setFeedback({ tone: 'erro', text: 'Nenhuma linha válida para importar.' });
      return;
    }
    setBusy('importando');
    try {
      await onImport(validos);
      setFeedback({
        tone: 'ok',
        text: `${validos.length} título(s) gravado(s) em ${t.title}. Total ${formatCurrency(
          validos.reduce((a, x) => a + x.amount, 0)
        )}.`,
      });
      setPreview(null);
      setPreviewFile('');
      if (fileRef.current) fileRef.current.value = '';
      setSubTab('painel');
    } catch (err) {
      setFeedback({ tone: 'erro', text: `Falha ao gravar: ${(err as Error).message}` });
    } finally {
      setBusy('');
    }
  };

  // ── Conciliação ───────────────────────────────────────────────────────────

  const rodarConciliacao = () => {
    setBusy('conciliando');
    setFeedback(null);
    // Conciliação roda contra a base COMPLETA (todos os anos), não o recorte do
    // ano: título de 30/12 compensa em 03/01 e nunca acharia par no recorte.
    const r = reconcile(titulos, statementEntries, draft);
    setResult(r);
    setBusy('');
  };

  const aplicarBaixas = async (matches: ReconciliationMatch[], status: BaixaStatus) => {
    if (matches.length === 0) return;
    setBusy('aplicando');
    try {
      await onApplyMatches(matches, status);
      setFeedback({
        tone: 'ok',
        text: `${matches.length} baixa(s) aplicada(s) — ${formatCurrency(matches.reduce((a, m) => a + m.tituloAmount, 0))}.`,
      });
      setResult(null);
    } catch (err) {
      setFeedback({ tone: 'erro', text: `Falha ao aplicar baixas: ${(err as Error).message}` });
    } finally {
      setBusy('');
    }
  };

  const salvarParametros = () => {
    onSaveSettings(draft);
    setFeedback({ tone: 'ok', text: 'Parâmetros de baixa automática salvos.' });
  };

  // ── Exportação ────────────────────────────────────────────────────────────

  const exportar = () => {
    const linhas = filtrados.map((x) => ({
      'Título': x.titleCode,
      'Número': x.titleNumber,
      'Parcela': x.parcela,
      'Movimento': x.movType,
      'Empresa': x.companyName,
      [`${t.personLabel} (cód.)`]: x.personCode,
      [t.personLabel]: x.personName,
      'Vinculado ao cadastro': x.customerId ? 'Sim' : 'Não',
      'Tipo': x.titleType,
      'Emissão': formatIsoBr(x.issueDate),
      'Vencimento': formatIsoBr(x.dueDate),
      'Pagamento': formatIsoBr(x.paymentDate),
      'Valor': x.amount,
      'Saldo': x.balance,
      'Status ERP': x.erpStatus,
      'Situação da baixa': x.status,
      // A conta vai RESOLVIDA para o Excel (escolha do gestor ou, na falta,
      // a conta da baixa). Exportar o campo cru mandaria vazio na maioria das
      // linhas, e quem abrisse a planilha concluiria que ninguém preencheu.
      [t.originLabel]: originByTitulo.get(x.id)?.label || '',
      'Forma de pagamento': originByTitulo.get(x.id)?.paymentForm || '',
      'Conta definida por': originByTitulo.get(x.id)?.source === 'gestor' ? 'Gestor' : originByTitulo.get(x.id)?.source === 'baixa' ? 'Baixa' : '',
      'Extrato conciliado': x.reconciledSource || '',
      'Departamento': x.department,
      'Natureza': x.operationNature,
      'Agente cobrador': x.collectionAgent,
      'Observação': x.observation,
    }));
    const sufixo = `${resolved.start || 'inicio'}_a_${resolved.end || 'fim'}`.replace(/-/g, '');
    exportReportToExcel(
      linhas,
      t.title,
      `${movType === 'R' ? 'contas_a_receber' : 'contas_a_pagar'}_${sufixo}_por_${resolved.basis}`
    );
  };

  const limparBase = async () => {
    const alvo = t.title.toUpperCase();
    const digitado = window.prompt(
      `Isto APAGA todos os títulos de ${t.title} (${titulos.length} registros). A operação não tem volta.\n\nDigite ${alvo} para confirmar:`
    );
    if ((digitado || '').trim().toUpperCase() !== alvo) return;
    setBusy('limpando');
    try {
      await onClear();
      setFeedback({ tone: 'ok', text: `${t.title} zerado.` });
    } catch (err) {
      setFeedback({ tone: 'erro', text: `Falha ao zerar: ${(err as Error).message}` });
    } finally {
      setBusy('');
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const TabButton: React.FC<{ id: SubTab; label: string; icon: React.ElementType; badge?: string }> = ({
    id,
    label,
    icon: Icon,
    badge,
  }) => (
    <button
      onClick={() => setSubTab(id)}
      className={`px-4 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center gap-2 ${
        subTab === id
          ? 'bg-[#2D2A26] text-white border-[#2D2A26]'
          : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF] hover:bg-[#EAE6DF]'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge && (
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
            subTab === id ? 'bg-[#C19A6B]/25 text-[#C19A6B]' : 'bg-white text-[#8B7D6B]'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* ── Cabeçalho ───────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${t.accentBg} ${t.accentBorder}`}>
              <t.icon className={`w-6 h-6 ${t.accent}`} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#2D2A26] leading-tight">{t.title}</h2>
              <p className="text-xs text-[#8B7D6B] mt-0.5">{t.subtitle}</p>
              <p className="text-[11px] text-[#8B7D6B] mt-1.5">
                <b className="text-[#2D2A26]">{resolved.label}</b> por {DATE_BASIS_LABEL[resolved.basis].toLowerCase()} ·{' '}
                {totals.totalCount.toLocaleString('pt-BR')} título(s) no recorte · base total{' '}
                {titulos.length.toLocaleString('pt-BR')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportar}
              disabled={filtrados.length === 0}
              className="px-3.5 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] border border-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Exportar
            </button>
            {canEdit && (
              <>
                <button
                  onClick={() => setSubTab('conciliacao')}
                  className="px-3.5 py-2.5 text-xs font-bold bg-[#C19A6B] text-white hover:bg-[#B08A5B] rounded-lg shadow-xs transition-all flex items-center gap-1.5"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Baixa automática
                </button>
                <button
                  onClick={() => setSubTab('importar')}
                  className="px-3.5 py-2.5 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-1.5"
                >
                  <UploadCloud className="w-4 h-4" />
                  Importar RFN046
                </button>
                <button
                  onClick={limparBase}
                  disabled={titulos.length === 0 || busy !== ''}
                  className="px-3 py-2.5 text-xs font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
                  title="Zerar a base desta tela"
                >
                  <Eraser className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── Filtro de período ────────────────────────────────────────────── */}
      <PeriodFilterBar
        value={period}
        onChange={setPeriod}
        resolved={resolved}
        availableYears={anosDisponiveis}
        matched={doAno.length}
        total={titulos.length}
      />

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 text-sm ${
            feedback.tone === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.tone === 'ok' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span className="flex-1">{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi
          label="Total do período"
          value={formatCurrency(totals.totalAmount)}
          hint={`${totals.totalCount} título(s)`}
          tone="destaque"
          icon={Layers}
        />
        <Kpi
          label={t.paidLabel}
          value={formatCurrency(totals.pagosAmount)}
          hint={`${totals.pagosCount} com status "Pago" — vão para o realizado`}
          tone="bom"
          icon={BadgeCheck}
        />
        <Kpi
          label={t.openLabel}
          value={formatCurrency(totals.abertosAmount)}
          hint={`${totals.abertosCount} em aberto — entram na previsão`}
          tone="alerta"
          icon={CalendarClock}
        />
        <Kpi
          label="Vencido em aberto"
          value={formatCurrency(totals.vencidosAmount)}
          hint={`${totals.vencidosCount} título(s) com vencimento passado`}
          tone="ruim"
          icon={AlertTriangle}
        />
        <Kpi
          label="Conciliado c/ extrato"
          value={`${totals.conciliadoPercent.toFixed(0)}%`}
          hint={`${totals.conciliadosCount} de ${totals.pagosCount} baixados`}
          tone="neutro"
          icon={Link2}
        />
      </div>

      {/* ── Abas ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-[#EAE6DF] rounded-xl p-2 shadow-xs">
        <TabButton id="painel" label="Painel" icon={TrendingUp} />
        <TabButton id="titulos" label="Títulos" icon={Table2} badge={String(doAno.length)} />
        <TabButton id="conciliacao" label="Conciliação" icon={RefreshCcw} />
        {canEdit && <TabButton id="importar" label="Importar" icon={UploadCloud} />}
        <span className="ml-auto text-[11px] text-[#8B7D6B] pr-2 hidden md:block">
          {t.openLabel} em aberto: <b className={t.accent}>{formatCurrency(totals.abertosAmount)}</b>
        </span>
      </div>

      {/* ═══ PAINEL ═════════════════════════════════════════════════════ */}
      {subTab === 'painel' && (
        <div className="space-y-6">
          {/* Curva mensal */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-[#2D2A26]">Previsto x Realizado — {period.year}</h3>
                <p className="text-[11px] text-[#8B7D6B] mt-0.5">
                  Realizado no mês do <b>pagamento</b> (Titulo_Status = Pago). Previsto no mês do <b>vencimento</b>.
                  São réguas diferentes de propósito: o compromisso e o dinheiro não moram no mesmo mês.
                  A curva mostra o ano de {period.year} inteiro — é o contexto onde o recorte acima se encaixa.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#2D2A26] inline-block" /> Realizado
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-[#C19A6B] inline-block" /> Previsto
                </span>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-2 items-end h-40">
              {curvaMensal.map((l) => (
                <div key={l.mk} className="flex flex-col items-center justify-end h-full gap-1" title={`${l.label}: realizado ${formatCurrency(l.realizado)} · previsto ${formatCurrency(l.previsto)}`}>
                  <div className="flex items-end gap-0.5 h-full w-full justify-center">
                    <div
                      className="w-1/2 bg-[#2D2A26] rounded-t transition-all"
                      style={{ height: `${(l.realizado / maxCurva) * 100}%` }}
                    />
                    <div
                      className="w-1/2 bg-[#C19A6B] rounded-t transition-all"
                      style={{ height: `${(l.previsto / maxCurva) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-[#8B7D6B]">{l.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Aging */}
            <Card className="p-6">
              <h3 className="text-sm font-bold text-[#2D2A26] mb-1">
                {movType === 'R' ? 'Aging de cobrança' : 'Aging de compromissos'}
              </h3>
              <p className="text-[11px] text-[#8B7D6B] mb-4">
                Só títulos EM ABERTO. {movType === 'R'
                  ? 'É esta a inadimplência real — calculada do próprio RFN046, sem base paralela.'
                  : 'Compromisso vencido e não pago é dívida em atraso, não previsão.'}
              </p>
              <div className="space-y-3">
                {aging.map((f) => (
                  <div key={f.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-bold text-[#433E37]">
                        {f.label} <span className="text-[#8B7D6B] font-normal">({f.count})</span>
                      </span>
                      <span className="font-bold tabular-nums text-[#2D2A26]">{formatCurrency(f.total)}</span>
                    </div>
                    <Bar value={f.total} max={agingMax} className={f.tone} />
                  </div>
                ))}
              </div>
            </Card>

            {/* Concentração */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-[#2D2A26]">Concentração por {t.personLabel.toLowerCase()}</h3>
                <span className="text-[10px] font-bold text-[#8B7D6B]">Top 8 de {porPessoa.length}</span>
              </div>
              <p className="text-[11px] text-[#8B7D6B] mb-4">
                Vínculo pelo <code className="bg-[#F3F1ED] px-1 rounded">Titulo_PessoaCod</code> ⇄{' '}
                <code className="bg-[#F3F1ED] px-1 rounded">cod_cliente</code>.
                {totals.semVinculoCount > 0 && (
                  <>
                    {' '}
                    <b className="text-amber-700">
                      {totals.semVinculoCount} título(s) sem cliente no cadastro ({formatCurrency(totals.semVinculoAmount)}).
                    </b>
                  </>
                )}
              </p>
              <div className="space-y-3">
                {porPessoa.slice(0, 8).map((p) => (
                  <div key={p.code + p.name}>
                    <div className="flex justify-between text-xs mb-1 gap-2">
                      <span className="font-bold text-[#433E37] truncate flex items-center gap-1.5" title={p.name}>
                        {p.linked ? (
                          <Link2 className="w-3 h-3 text-emerald-600 shrink-0" />
                        ) : (
                          <Link2Off className="w-3 h-3 text-amber-600 shrink-0" />
                        )}
                        {p.name}
                      </span>
                      <span className="font-bold tabular-nums text-[#2D2A26] shrink-0">{formatCurrency(p.total)}</span>
                    </div>
                    <Bar value={p.total} max={porPessoa[0]?.total || 1} />
                  </div>
                ))}
                {porPessoa.length === 0 && (
                  <p className="text-xs text-[#8B7D6B] text-center py-6">Nenhum título no recorte selecionado.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ═══ TÍTULOS ════════════════════════════════════════════════════ */}
      {subTab === 'titulos' && (
        <Card className="overflow-hidden">
          {/* Filtros */}
          <div className="p-4 border-b border-[#EAE6DF] bg-[#F9F7F2] flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={`Buscar por ${t.personLabel.toLowerCase()}, código, nº do título, observação...`}
                className="w-full pl-9 pr-3 py-2 text-xs border border-[#EAE6DF] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#433E37]"
            >
              <option value="todos">Situação: todas</option>
              <option value="pago">Pago (realizado)</option>
              <option value="aberto">Em aberto (previsto)</option>
              <option value="vencido">Vencido e não pago</option>
            </select>
            <select
              value={baixaFilter}
              onChange={(e) => {
                setBaixaFilter(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#433E37]"
            >
              <option value="todos">Baixa: todas</option>
              <option value="Em Aberto">Sem baixa</option>
              <option value="Baixado Automático">Baixa automática</option>
              <option value="Baixado Manual">Baixa manual</option>
              <option value="Conferir">A conferir</option>
            </select>
            <select
              value={originFilter}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__ADD_NEW__') {
                  openCreateOriginModal();
                  return;
                }
                setOriginFilter(val);
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#433E37] max-w-[190px]"
            >
              <option value="todos">{t.originLabel}: todas</option>
              <option value="sem_origem">Sem conta definida</option>
              {accountsList.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
              {canEdit && (
                <option value="__ADD_NEW__" className="font-bold text-amber-800 bg-amber-50">
                  + Cadastrar nova origem...
                </option>
              )}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#433E37] max-w-[180px]"
            >
              <option value="todos">Departamento: todos</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={linkFilter}
              onChange={(e) => {
                setLinkFilter(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#433E37]"
            >
              <option value="todos">Vínculo: todos</option>
              <option value="vinculados">Com cliente</option>
              <option value="sem_vinculo">Sem cliente</option>
            </select>
          </div>

          <div className="px-4 py-2 bg-white border-b border-[#EAE6DF] flex items-center justify-between text-[11px] text-[#8B7D6B]">
            <span>
              {filtrados.length.toLocaleString('pt-BR')} de {doAno.length.toLocaleString('pt-BR')} título(s) no recorte
            </span>
            <span>
              Soma exibida: <b className="text-[#2D2A26] tabular-nums">{formatCurrency(filtradosTotal)}</b>{' '}
              <span className="opacity-70">(pago pelo valor, aberto pelo saldo)</span>
            </span>
          </div>

          {/* ═══ SOMAS POR CONTA, POR FORMA E POR CLASSIFICAÇÃO DE DESPESA ═══
              As três respondem à MESMA pergunta por ângulos diferentes e fecham
              no mesmo total — por isso "Sem conta definida" e "Não classificado"
              aparecem como linha, em vez de serem omitidos. Uma soma que
              silenciosamente ignora o que não sabe classificar mostra um total
              menor que o real, e quem lê não tem como notar o que ficou de fora.

              Todas seguem o recorte de período e os filtros da tela: um painel
              que soma o ano inteiro ao lado de uma tabela filtrada por mês é uma
              armadilha, e desses números saem decisões. */}
          {originSummary.paidCount > 0 && (
            <div className="px-4 py-4 bg-[#F9F7F2] border-b border-[#EAE6DF] space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-xs font-black text-[#2D2A26]">
                  {t.paidLabel} por conta — {originSummary.paidCount.toLocaleString('pt-BR')} título(s) no recorte
                </h4>
                <span className="text-[11px] text-[#8B7D6B]">
                  Total {t.paidLabel.toLowerCase()}:{' '}
                  <b className="text-[#2D2A26] tabular-nums">{formatCurrency(originSummary.paidAmount)}</b>
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* Por conta */}
                <div className="bg-white border border-[#EAE6DF] rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-[#F3F1ED] text-[10px] font-bold uppercase tracking-wider text-[#8B7D6B]">
                    Por conta
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-[#EAE6DF]">
                      {originSummary.byAccount.map((a) => (
                        <tr
                          key={a.accountKey || 'sem'}
                          className={`hover:bg-[#F9F7F2] cursor-pointer ${!a.accountKey ? 'bg-amber-50/60' : ''}`}
                          onClick={() => {
                            setOriginFilter(a.accountKey || 'sem_origem');
                            setPage(1);
                          }}
                          title="Clique para filtrar a tabela por esta conta"
                        >
                          <td className="px-3 py-1.5">
                            <span className={`font-bold ${a.accountKey ? 'text-[#2D2A26]' : 'text-amber-800'}`}>
                              {a.label}
                            </span>
                            <span className="block text-[9px] text-[#8B7D6B]">
                              {a.count} título(s)
                              {a.paymentForm ? ` · ${a.paymentForm}` : ''}
                              {a.fromBaixa > 0 ? ` · ${a.fromBaixa} pela baixa` : ''}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-[#2D2A26] whitespace-nowrap">
                            {formatCurrency(a.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Por forma de pagamento */}
                <div className="bg-white border border-[#EAE6DF] rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-[#F3F1ED] text-[10px] font-bold uppercase tracking-wider text-[#8B7D6B]">
                    Por forma de pagamento
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-[#EAE6DF]">
                      {originSummary.byForm.map((f) => (
                        <tr key={f.form} className={f.form === 'Sem origem' ? 'bg-amber-50/60' : ''}>
                          <td className="px-3 py-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                f.form === 'Dinheiro'
                                  ? 'bg-[#C19A6B]/15 text-[#C19A6B] border-[#C19A6B]/30'
                                  : f.form === 'Banco'
                                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {f.form}
                            </span>
                            <span className="block text-[9px] text-[#8B7D6B] mt-0.5">{f.count} título(s)</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-[#2D2A26] whitespace-nowrap">
                            {formatCurrency(f.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 py-1.5 text-[9px] text-[#8B7D6B] border-t border-[#EAE6DF]">
                    Forma derivada da conta: caixa é dinheiro, conta corrente é banco. Não é campo digitável.
                  </p>
                </div>

                {/* Por classificação de despesa (vem do cadastro da pessoa) */}
                <div className="bg-white border border-[#EAE6DF] rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-[#F3F1ED] text-[10px] font-bold uppercase tracking-wider text-[#8B7D6B]">
                    Despesa fixa x variável
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-[#EAE6DF]">
                      {originSummary.byExpense.map((e) => (
                        <tr key={e.classification} className={e.classification === 'Não classificado' ? 'bg-amber-50/60' : ''}>
                          <td className="px-3 py-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                e.classification === 'Despesa Fixa'
                                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                                  : e.classification === 'Despesa Variável'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-[#F3F1ED] text-[#8B7D6B] border-[#EAE6DF]'
                              }`}
                            >
                              {e.classification}
                            </span>
                            <span className="block text-[9px] text-[#8B7D6B] mt-0.5">{e.count} título(s)</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-bold text-[#2D2A26] whitespace-nowrap">
                            {formatCurrency(e.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 py-1.5 text-[9px] text-[#8B7D6B] border-t border-[#EAE6DF]">
                    Vem do cadastro de {t.personLabelPlural.toLowerCase()} (campo Classif. Despesa), pelo código da pessoa.
                  </p>
                </div>
              </div>

              {originSummary.withoutOrigin.count > 0 && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <b>{originSummary.withoutOrigin.count} título(s)</b> pago(s) sem conta identificada (
                  {formatCurrency(originSummary.withoutOrigin.amount)}). São pagamentos sem baixa no extrato — use a
                  coluna <b>{t.originLabel}</b> para apontar de onde saiu o dinheiro, ou filtre por
                  “Sem conta definida” para resolvê-los em série.
                </p>
              )}
            </div>
          )}

          {/* Tabela */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F3F1ED] text-[#8B7D6B]">
                <tr>
                  {[
                    { k: 'personName' as const, label: t.personLabel, align: 'left' },
                    { k: null, label: 'Título', align: 'left' },
                    { k: 'dueDate' as const, label: 'Vencimento', align: 'left' },
                    { k: 'paymentDate' as const, label: 'Pagamento', align: 'left' },
                    { k: 'amount' as const, label: 'Valor', align: 'right' },
                    { k: null, label: 'Saldo', align: 'right' },
                    { k: null, label: 'ERP', align: 'center' },
                    { k: null, label: 'Baixa', align: 'center' },
                    { k: null, label: t.originLabel, align: 'left' },
                    { k: null, label: '', align: 'right' },
                  ].map((c, i) => (
                    <th
                      key={i}
                      onClick={() => c.k && toggleSort(c.k)}
                      className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-bold whitespace-nowrap ${
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                      } ${c.k ? 'cursor-pointer hover:text-[#2D2A26] select-none' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {c.k && sortKey === c.k && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {pageItems.map((x) => {
                  const vencido = !x.isPaid && !!x.dueDate && x.dueDate < hoje;
                  const linked = !!customerIndex.get(normalizePersonCode(x.personCode));
                  return (
                    <tr key={x.id} className={`hover:bg-[#F9F7F2] transition-colors ${vencido ? 'bg-rose-50/40' : ''}`}>
                      <td className="px-3 py-2.5 max-w-[240px]">
                        <div className="flex items-center gap-1.5">
                          {linked ? (
                            <Link2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          ) : (
                            <Link2Off className="w-3 h-3 text-amber-500 shrink-0" />
                          )}
                          <span className="font-bold text-[#2D2A26] truncate" title={x.personName}>
                            {x.personName || '—'}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#8B7D6B] font-mono">
                          cód. {x.personCode || '—'} · {x.department || 'sem depto'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-[11px] text-[#433E37]">{x.titleNumber || x.titleCode}</span>
                        <span className="block text-[10px] text-[#8B7D6B]">
                          {x.parcela || '—'} · {x.titleType || '—'}
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${vencido ? 'text-rose-700 font-bold' : 'text-[#433E37]'}`}>
                        {formatIsoBr(x.dueDate)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[#433E37]">{formatIsoBr(x.paymentDate)}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[#2D2A26] whitespace-nowrap">
                        {formatCurrency(x.amount)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${
                          x.balance > 0 ? 'text-amber-700 font-bold' : 'text-[#8B7D6B]'
                        }`}
                      >
                        {formatCurrency(x.balance)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <ErpPill titulo={x} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <StatusPill status={x.status} />
                        {x.matchScore !== undefined && x.matchScore > 0 && (
                          <span className="block text-[9px] text-[#8B7D6B] mt-0.5" title={x.matchReason}>
                            score {x.matchScore}
                          </span>
                        )}
                      </td>
                      {/* CONTA DE ORIGEM.
                          O `value` do select vem da origem RESOLVIDA, não do campo
                          gravado: assim o título baixado contra o extrato já
                          aparece com a conta certa sem ninguém ter tocado nele. Ao
                          escolher, a decisão passa a ser do gestor e vence a baixa
                          (ver utils/paymentAccounts.ts). A opção "— usar a conta da
                          baixa —" é o caminho de volta. */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {(() => {
                          const origem = originByTitulo.get(x.id);
                          const key = origem?.accountKey || '';
                          const definidoPeloGestor = origem?.source === 'gestor';
                          if (!canEdit) {
                            return origem && key ? (
                              <span className="text-[11px] text-[#433E37] font-bold">{origem.label}</span>
                            ) : (
                              <span className="text-[11px] text-[#8B7D6B]">—</span>
                            );
                          }
                          return (
                            <div className="flex items-center gap-1">
                              <select
                                value={definidoPeloGestor ? key : ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '__ADD_NEW__') {
                                    openCreateOriginModal(x.id);
                                    return;
                                  }
                                  const acc = getPaymentAccountByCode(v);
                                  onSetOrigin(
                                    x.id,
                                    v,
                                    v ? acc?.label || PAYMENT_ACCOUNT_BY_CODE[v]?.label || '' : ''
                                  );
                                }}
                                title={`${t.originHint}${origem?.label ? ` — hoje: ${origem.label}` : ''}`}
                                className={`text-[11px] px-1.5 py-1 rounded-md border bg-white max-w-[152px] ${
                                  definidoPeloGestor
                                    ? 'border-[#C19A6B] text-[#2D2A26] font-bold'
                                    : key
                                    ? 'border-[#EAE6DF] text-[#8B7D6B]'
                                    : 'border-amber-300 text-amber-800'
                                }`}
                              >
                                <option value="">
                                  {key ? `${origem?.label} (da baixa)` : '— definir conta —'}
                                </option>
                                {accountsList.map((a) => (
                                  <option key={a.code} value={a.code}>
                                    {a.label} · {a.paymentForm}
                                  </option>
                                ))}
                                <option value="__ADD_NEW__" className="font-semibold text-amber-800 bg-amber-50">
                                  + Cadastrar nova origem...
                                </option>
                              </select>
                              <button
                                type="button"
                                onClick={() => openCreateOriginModal(x.id)}
                                title="Cadastrar nova origem manualmente"
                                className="p-1 rounded text-[#8B7D6B] hover:text-amber-800 hover:bg-amber-100 transition-colors shrink-0"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {canEdit && (
                          <div className="inline-flex items-center gap-1">
                            {x.status === 'Em Aberto' || x.status === 'Conferir' ? (
                              <button
                                onClick={() => openBaixaSearch(x)}
                                title="Dar baixa manual — buscar no extrato"
                                className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-50 border border-transparent hover:border-emerald-200"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => onRevertBaixa(x.id)}
                                title="Reverter baixa"
                                className="p-1.5 rounded-md text-[#8B7D6B] hover:bg-[#F3F1ED] border border-transparent hover:border-[#EAE6DF]"
                              >
                                <RefreshCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => onDelete(x.id)}
                              title="Excluir título"
                              className="p-1.5 rounded-md text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-[#8B7D6B]">
                      Nenhum título encontrado com os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="p-3 border-t border-[#EAE6DF] flex items-center justify-between bg-[#F9F7F2]">
              <span className="text-[11px] text-[#8B7D6B]">
                Página {pageSafe} de {totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe === 1}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED] disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe === totalPages}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#EAE6DF] bg-white text-[#433E37] hover:bg-[#F3F1ED] disabled:opacity-50"
                >
                  Próximo
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ═══ CONCILIAÇÃO ════════════════════════════════════════════════ */}
      {subTab === 'conciliacao' && (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-start gap-3 mb-5">
              <SlidersHorizontal className="w-5 h-5 text-[#C19A6B] mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-[#2D2A26]">Régua da baixa automática</h3>
                <p className="text-[11px] text-[#8B7D6B] mt-0.5 max-w-3xl">
                  Cada título com status <b>Pago</b> procura no extrato o lançamento de {t.statementSide} que é ele.
                  Valor e data são eliminatórios; nome e número do título somam confiança. Só baixa sozinho quem passa
                  do score mínimo — o resto vira sugestão para conferência humana.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { key: 'amountToleranceAbs' as const, label: 'Tolerância R$', step: 0.01, hint: 'Diferença absoluta aceita' },
                { key: 'amountTolerancePercent' as const, label: 'Tolerância %', step: 0.1, hint: 'Cobre tarifa e juros' },
                { key: 'dateWindowDays' as const, label: 'Janela (dias)', step: 1, hint: 'Distância título ⇄ extrato' },
                { key: 'minNameSimilarity' as const, label: 'Nome mín. %', step: 5, hint: 'Corte de similaridade' },
                { key: 'autoMatchMinScore' as const, label: 'Score p/ baixar', step: 5, hint: 'Abaixo disso, só sugere' },
                { key: 'suggestionMinScore' as const, label: 'Score p/ sugerir', step: 5, hint: 'Abaixo disso, descarta' },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B] mb-1">{f.label}</label>
                  <input
                    type="number"
                    step={f.step}
                    min={0}
                    value={draft[f.key]}
                    onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#2D2A26] focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40 tabular-nums"
                  />
                  <p className="text-[10px] text-[#8B7D6B] mt-1">{f.hint}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-[#433E37] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.requireNameMatch}
                  onChange={(e) => setDraft({ ...draft, requireNameMatch: e.target.checked })}
                  className="w-4 h-4 accent-[#C19A6B]"
                />
                Exigir nome compatível (ou nº do título no extrato) para baixar
              </label>
              <div className="flex-1" />
              <button
                onClick={salvarParametros}
                className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] border border-[#EAE6DF] rounded-lg transition-all"
              >
                Salvar parâmetros
              </button>
              <button
                onClick={rodarConciliacao}
                disabled={busy !== ''}
                className="px-4 py-2.5 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-2 disabled:opacity-60"
              >
                {busy === 'conciliando' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                Simular conciliação
              </button>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-[#F9F7F2] border border-[#EAE6DF] text-[11px] text-[#8B7D6B] flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                A simulação não grava nada. Ela roda contra o extrato <b>completo</b> ({statementEntries.length}{' '}
                lançamentos, todos os anos) porque título pago em 30/12 costuma compensar em 03/01 — filtrar por ano
                faria esse par nunca ser encontrado.
              </span>
            </div>
          </Card>

          {result && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi
                  label="Baixa automática"
                  value={String(result.stats.autoCount)}
                  hint={formatCurrency(result.stats.autoAmount)}
                  tone="bom"
                  icon={CheckCircle2}
                />
                <Kpi
                  label="Sugestões (conferir)"
                  value={String(result.stats.sugestaoCount)}
                  hint={formatCurrency(result.stats.sugestaoAmount)}
                  tone="alerta"
                  icon={AlertTriangle}
                />
                <Kpi
                  label="Sem par no extrato"
                  value={String(result.stats.semParCount)}
                  hint={formatCurrency(result.stats.semParAmount)}
                  tone="ruim"
                  icon={Link2Off}
                />
                <Kpi
                  label="Títulos analisados"
                  value={String(result.stats.titulosConsiderados)}
                  hint={`${result.stats.lancamentosDisponiveis} lançamentos livres`}
                  tone="neutro"
                  icon={Layers}
                />
              </div>

              {canEdit && (result.auto.length > 0 || result.suggestions.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => aplicarBaixas(result.auto, 'Baixado Automático')}
                    disabled={result.auto.length === 0 || busy !== ''}
                    className="px-4 py-2.5 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy === 'aplicando' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Aplicar {result.auto.length} baixa(s) automática(s)
                  </button>
                  <button
                    onClick={() => aplicarBaixas(result.suggestions, 'Conferir')}
                    disabled={result.suggestions.length === 0 || busy !== ''}
                    className="px-4 py-2.5 text-xs font-bold bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Marcar {result.suggestions.length} para conferência
                  </button>
                </div>
              )}

              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-[#EAE6DF] bg-[#F9F7F2]">
                  <h3 className="text-sm font-bold text-[#2D2A26]">Pares encontrados</h3>
                  <p className="text-[11px] text-[#8B7D6B] mt-0.5">
                    Ordenados por confiança. Cada lançamento de extrato só pode quitar um título — o par mais evidente
                    escolhe primeiro.
                  </p>
                </div>
                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F3F1ED] text-[#8B7D6B] sticky top-0">
                      <tr>
                        {['Score', 'Título', t.personLabel, 'Valor', 'Extrato', 'Evidências'].map((h, i) => (
                          <th
                            key={h}
                            className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-bold ${
                              i === 3 ? 'text-right' : 'text-left'
                            }`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE6DF]">
                      {[...result.auto, ...result.suggestions].map((m) => (
                        <tr key={m.tituloId + m.statementId} className="hover:bg-[#F9F7F2]">
                          <td className="px-3 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                m.decision === 'auto'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              {m.score}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-[#433E37]">{m.titleCode}</td>
                          <td className="px-3 py-2.5 max-w-[200px] truncate text-[#2D2A26] font-bold">
                            {titulos.find((x) => x.id === m.tituloId)?.personName || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[#2D2A26] whitespace-nowrap">
                            {formatCurrency(m.tituloAmount)}
                            {m.amountDiff > 0 && (
                              <span className="block text-[10px] text-amber-700 font-normal">
                                extrato {formatCurrency(m.statementAmount)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 max-w-[260px]">
                            <span className="font-bold text-[#433E37]">{m.statementSource}</span>
                            <span className="block text-[10px] text-[#8B7D6B] truncate" title={m.statementDescription}>
                              {formatIsoBr(m.statementDate)} · {m.statementDescription || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              <span className="px-1.5 py-0.5 rounded bg-[#F3F1ED] text-[10px] text-[#433E37] border border-[#EAE6DF]">
                                {m.amountDiff === 0 ? 'valor exato' : `Δ ${formatCurrency(m.amountDiff)}`}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-[#F3F1ED] text-[10px] text-[#433E37] border border-[#EAE6DF]">
                                {m.daysDiff === 0 ? 'mesmo dia' : `${m.daysDiff}d`}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                  m.nameSimilarity >= draft.minNameSimilarity
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-[#F3F1ED] text-[#8B7D6B] border-[#EAE6DF]'
                                }`}
                              >
                                nome {m.nameSimilarity}%
                              </span>
                              {m.titleInDescription && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[10px] text-blue-700 border border-blue-200">
                                  nº no extrato
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {result.auto.length === 0 && result.suggestions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-12 text-center text-[#8B7D6B]">
                            Nenhum par dentro dos parâmetros atuais. Aumente a tolerância de valor ou a janela de dias.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ═══ IMPORTAR ═══════════════════════════════════════════════════ */}
      {subTab === 'importar' && canEdit && (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-start gap-3 mb-4">
              <UploadCloud className="w-5 h-5 text-[#C19A6B] mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-[#2D2A26]">Importar RFN046 — {t.title}</h3>
                <p className="text-[11px] text-[#8B7D6B] mt-0.5 max-w-3xl">
                  Envie o relatório <b>RFN046 (Títulos)</b> exportado com o filtro de{' '}
                  <b>{movType === 'R' ? 'entradas (R)' : 'saídas (P)'}</b>. As 34 colunas do layout são preservadas.
                  Reimportar a mesma planilha <b>atualiza</b> os títulos — nunca duplica, e nunca apaga a conciliação
                  já feita.
                </p>
              </div>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className="border-2 border-dashed border-[#EAE6DF] bg-[#F9F7F2] hover:border-[#C19A6B] rounded-xl p-8 text-center transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-[#C19A6B]/15 text-[#C19A6B] flex items-center justify-center mx-auto border border-[#C19A6B]/30 mb-3">
                <UploadCloud className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-[#2D2A26]">Arraste a planilha aqui ou selecione o arquivo</p>
              <p className="text-[11px] text-[#8B7D6B] mt-1">Formatos aceitos: .xlsx e .xls</p>
              <label className="mt-4 px-4 py-2 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg cursor-pointer shadow-xs inline-block transition-all">
                {busy === 'lendo' ? 'Lendo...' : 'Selecionar arquivo'}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
              {previewFile && (
                <p className="mt-3 text-[11px] font-mono text-[#C19A6B]">{previewFile}</p>
              )}
            </div>
          </Card>

          {previewIssues.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
              <p className="text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Pontos de atenção no arquivo
              </p>
              {previewIssues.map((i, k) => (
                <p key={k} className="text-[11px] pl-6">
                  • {i}
                </p>
              ))}
            </div>
          )}

          {preview && previewSummary && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <Kpi label="Linhas" value={String(previewSummary.totalRows)} hint={`${previewSummary.validRows} válidas`} />
                <Kpi
                  label="Rejeitadas"
                  value={String(previewSummary.invalidRows)}
                  hint="não serão gravadas"
                  tone={previewSummary.invalidRows > 0 ? 'ruim' : 'neutro'}
                />
                <Kpi label="Total do arquivo" value={formatCurrency(previewSummary.totalAmount)} tone="destaque" />
                <Kpi
                  label={`${t.paidLabel} (status Pago)`}
                  value={formatCurrency(previewSummary.paidAmount)}
                  hint={`${previewSummary.paidRows} título(s)`}
                  tone="bom"
                />
                <Kpi
                  label="Saldo em aberto"
                  value={formatCurrency(previewSummary.openBalance)}
                  hint={`${previewSummary.openRows} título(s)`}
                  tone="alerta"
                />
                <Kpi
                  label="Vinculados ao cadastro"
                  value={`${previewSummary.validRows > 0 ? Math.round((previewSummary.linkedToCustomer / previewSummary.validRows) * 100) : 0}%`}
                  hint={`${previewSummary.linkedToCustomer} de ${previewSummary.validRows} por cod_cliente`}
                  icon={Users}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={confirmarImportacao}
                  disabled={busy !== '' || previewSummary.validRows === 0}
                  className="px-5 py-2.5 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {busy === 'importando' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Gravar {previewSummary.validRows} título(s) em {t.title}
                </button>
                <button
                  onClick={() => {
                    setPreview(null);
                    setPreviewFile('');
                    setPreviewIssues([]);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] border border-[#EAE6DF] rounded-lg transition-all"
                >
                  Descartar prévia
                </button>
                <label className="flex items-center gap-2 text-xs font-bold text-[#433E37] cursor-pointer ml-auto">
                  <input
                    type="checkbox"
                    checked={showInvalidOnly}
                    onChange={(e) => setShowInvalidOnly(e.target.checked)}
                    className="w-4 h-4 accent-[#C19A6B]"
                  />
                  Mostrar só linhas com problema
                </label>
                <span className="text-[11px] text-[#8B7D6B]">
                  Período: {formatIsoBr(previewSummary.periodStart)} a {formatIsoBr(previewSummary.periodEnd)}
                </span>
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F3F1ED] text-[#8B7D6B] sticky top-0">
                      <tr>
                        {['#', 'Título', t.personLabel, 'Vencimento', 'Pagamento', 'Valor', 'Saldo', 'Status ERP', 'Diagnóstico'].map(
                          (h, i) => (
                            <th
                              key={h}
                              className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-bold ${
                                i === 5 || i === 6 ? 'text-right' : 'text-left'
                              }`}
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE6DF]">
                      {preview
                        .filter((p) => (showInvalidOnly ? !p.valid || p.warnings.length > 0 : true))
                        .slice(0, 400)
                        .map((p) => (
                          <tr key={p.rowNumber} className={p.valid ? 'hover:bg-[#F9F7F2]' : 'bg-rose-50/60'}>
                            <td className="px-3 py-2 text-[#8B7D6B] font-mono">{p.rowNumber}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[#433E37]">
                              {p.titulo.titleNumber || p.titulo.titleCode}
                            </td>
                            <td className="px-3 py-2 max-w-[220px] truncate text-[#2D2A26]" title={p.titulo.personName}>
                              {p.titulo.customerId ? (
                                <Link2 className="w-3 h-3 text-emerald-600 inline mr-1" />
                              ) : (
                                <Link2Off className="w-3 h-3 text-amber-500 inline mr-1" />
                              )}
                              {p.titulo.personName || '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-[#433E37]">{formatIsoBr(p.titulo.dueDate)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-[#433E37]">{formatIsoBr(p.titulo.paymentDate)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-bold text-[#2D2A26]">
                              {formatCurrency(p.titulo.amount)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#8B7D6B]">
                              {formatCurrency(p.titulo.balance)}
                            </td>
                            <td className="px-3 py-2">
                              <ErpPill titulo={p.titulo} />
                            </td>
                            <td className="px-3 py-2 max-w-[320px]">
                              {p.errors.map((e, k) => (
                                <span key={k} className="block text-[10px] text-rose-700 font-bold">
                                  ✕ {e}
                                </span>
                              ))}
                              {p.warnings.map((w, k) => (
                                <span key={k} className="block text-[10px] text-amber-700">
                                  ! {w}
                                </span>
                              ))}
                              {p.valid && p.warnings.length === 0 && (
                                <span className="text-[10px] text-emerald-700">✓ ok</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {preview.length > 400 && (
                  <div className="px-4 py-2 bg-[#F9F7F2] border-t border-[#EAE6DF] text-[11px] text-[#8B7D6B]">
                    Mostrando as primeiras 400 linhas de {preview.length}. A gravação considera todas.
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── Modal: Baixa manual — buscar no extrato ─────────────────────────
       *
       * Reabre uma tela que existia antes da fusão de Contas a Pagar/Receber
       * no RFN046 (ver git f57bd29 / e9f7c80). Regra: a busca prioriza a
       * DATA — janela ajustável, padrão ±15 dias (30 dias no total) em torno
       * do pagamento (ou do vencimento, quando o título ainda não tem data de
       * pagamento) — e o VALOR é aproximado, não um filtro rígido: tarifa,
       * desconto e arredondamento fazem o lançamento do banco não bater
       * centavo a centavo com o título, e um filtro exato esconderia
       * exatamente o par certo. Os resultados vêm marcados como "Valor
       * exato" ou "Aproximado (diferença de R$X)", nessa ordem.
       */}
      {baixaSearchTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-emerald-200 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            {/* Cabeçalho */}
            <div className="p-5 border-b border-[#EAE6DF]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-black text-[#2D2A26] flex items-center gap-2">
                    <Search className="w-5 h-5 text-emerald-600 shrink-0" />
                    Buscar no extrato para dar baixa
                  </h4>
                  <p className="text-xs text-[#8B7D6B] mt-1 truncate">
                    <span className="font-bold text-[#2D2A26]">{baixaSearchTarget.personName || '—'}</span>{' '}
                    · {formatCurrency(baixaSearchTarget.balance > 0 ? baixaSearchTarget.balance : baixaSearchTarget.amount)}
                    {' '}· {t.statementSide}
                  </p>
                  <p className="text-[10px] font-mono text-[#C19A6B] mt-0.5">
                    {baixaSearchTarget.titleNumber || baixaSearchTarget.titleCode}
                    {baixaSearchTarget.parcela ? ` · ${baixaSearchTarget.parcela}` : ''}
                    {' · data de referência: '}
                    {baixaSearchBaseDate ? formatIsoBr(baixaSearchBaseDate) : 'sem data — informe manualmente'}
                    {!baixaSearchTarget.paymentDate && baixaSearchTarget.dueDate && ' (vencimento, título sem pagamento no ERP)'}
                  </p>
                </div>
                <button onClick={closeBaixaSearch} className="p-1 rounded-lg hover:bg-[#F3F1ED] shrink-0" disabled={baixaBusy}>
                  <X className="w-4 h-4 text-[#8B7D6B]" />
                </button>
              </div>

              {/* Controles: janela de dias + valor buscado + texto */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Janela:</span>
                <select
                  value={baixaSearchDays}
                  onChange={(e) => setBaixaSearchDays(Number(e.target.value))}
                  disabled={baixaBusy}
                  className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg px-2 py-1.5 font-bold focus:outline-none focus:border-[#C19A6B] disabled:opacity-50"
                >
                  <option value={7}>±7 dias</option>
                  <option value={15}>±15 dias (30 dias no total)</option>
                  <option value={30}>±30 dias</option>
                  <option value={60}>±60 dias</option>
                </select>

                <span className="text-[10px] font-bold text-[#8B7D6B] uppercase ml-1">Valor buscado:</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={baixaSearchAmount}
                  onChange={(e) => setBaixaSearchAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                  disabled={baixaBusy}
                  placeholder="0,00"
                  className="w-28 bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg px-2 py-1.5 font-bold tabular-nums focus:outline-none focus:border-[#C19A6B] disabled:opacity-50"
                />

                <div className="relative flex-1 min-w-[160px]">
                  <Search className="w-3.5 h-3.5 text-[#8B7D6B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={baixaSearchQuery}
                    maxLength={80}
                    onChange={(e) => setBaixaSearchQuery(e.target.value)}
                    disabled={baixaBusy}
                    placeholder="Filtrar por descrição, cliente/beneficiário…"
                    className="w-full pl-8 bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] rounded-lg px-2 py-1.5 font-medium focus:outline-none focus:border-[#C19A6B] disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* Resultados */}
            <div className="p-5 overflow-y-auto flex-1">
              {baixaError && (
                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg p-2.5 mb-3">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-rose-700 font-semibold">{baixaError}</p>
                </div>
              )}

              {!baixaSearchBaseDate ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-[#2D2A26]">Título sem data de vencimento nem de pagamento</p>
                  <p className="text-xs text-[#8B7D6B] mt-1">Não é possível centralizar a busca. Confirme a baixa sem vínculo abaixo.</p>
                </div>
              ) : baixaSearchResults.length === 0 ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-[#2D2A26]">Nenhum lançamento encontrado</p>
                  <p className="text-xs text-[#8B7D6B] mt-1">
                    Nenhum {t.statementSide} dentro de ±{baixaSearchDays} dias de {formatIsoBr(baixaSearchBaseDate)}.
                    Aumente a janela ou limpe o filtro de texto acima.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-emerald-700 mb-3">
                    {baixaSearchResults.length} lançamento(s) — clique para confirmar a baixa:
                  </p>
                  {baixaSearchResults.map((match) => {
                    const entry = match.entry;
                    const jaVinculadoAqui = entry.id === baixaSearchTarget.reconciledStatementId;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={baixaBusy}
                        onClick={() => confirmBaixa(entry.id, entry.source)}
                        className="w-full text-left border border-[#EAE6DF] rounded-xl p-4 hover:border-emerald-400 hover:bg-emerald-50/40 transition-all disabled:opacity-50 disabled:cursor-wait"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                {entry.sourceLabel}
                              </span>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  match.quality === 'exato'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {match.quality === 'exato' ? 'Valor exato' : `Aproximado (dif. ${formatCurrency(match.diffAmount)})`}
                              </span>
                              {jaVinculadoAqui && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                                  já vinculado a este título
                                </span>
                              )}
                              <span className="text-[11px] font-mono text-[#8B7D6B]">
                                {formatIsoBr(entry.date)} · {match.diffDays} dia(s) de diferença
                              </span>
                            </div>
                            <p className="text-xs text-[#433E37] mt-1 truncate">{entry.description || '—'}</p>
                            {entry.clientName && <p className="text-[10px] text-[#8B7D6B] mt-0.5 truncate">{entry.clientName}</p>}
                          </div>
                          <span className="text-sm font-black tabular-nums text-[#2D2A26] shrink-0">
                            {formatCurrency(match.valorLado)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rodapé: confirmar sem vincular */}
            <div className="p-4 border-t border-[#EAE6DF] bg-[#F9F7F2] rounded-b-2xl flex items-center justify-between gap-3">
              <p className="text-[10px] text-[#8B7D6B] max-w-[55%]">
                Sem o lançamento certo na lista? Dá para confirmar a baixa sem vincular a um lançamento do extrato — fica marcada como
                &quot;Baixado Manual&quot; sem conciliação.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={closeBaixaSearch}
                  disabled={baixaBusy}
                  className="px-3.5 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => confirmBaixa()}
                  disabled={baixaBusy}
                  className="px-3.5 py-2 text-xs font-bold bg-[#2D2A26] text-white rounded-lg hover:bg-[#433E37] disabled:opacity-50 flex items-center gap-2"
                >
                  {baixaBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {baixaBusy ? 'Processando…' : 'Confirmar sem vincular'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal de Cadastro Manual de Origem ────────────────────────────── */}
      {isCreateOriginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-[#EAE6DF] w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#EAE6DF] bg-[#FAF8F5]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#2D2A26] text-base">Cadastrar Nova Origem</h3>
                  <p className="text-xs text-[#8B7D6B]">Adicione uma conta ou caixa manualmente ao sistema</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOriginOpen(false);
                  setCreateOriginTargetTituloId(null);
                }}
                className="p-1 rounded-md text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#EAE6DF]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Body */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateCustomOrigin();
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-[#433E37] mb-1">
                  Nome da Conta / Origem <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Banco Inter, Caixa 30115, Cora..."
                  value={newOriginName}
                  onChange={(e) => setNewOriginName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#EAE6DF] rounded-lg focus:outline-none focus:border-[#C19A6B] bg-white text-[#2D2A26]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#433E37] mb-1">
                    Forma de Pagamento <span className="text-rose-600">*</span>
                  </label>
                  <select
                    value={newOriginForm}
                    onChange={(e) => setNewOriginForm(e.target.value as PaymentForm)}
                    className="w-full px-3 py-2 text-xs border border-[#EAE6DF] rounded-lg focus:outline-none focus:border-[#C19A6B] bg-white text-[#2D2A26] font-medium"
                  >
                    <option value="Banco">Banco</option>
                    <option value="Dinheiro">Dinheiro (Caixa em espécie)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#433E37] mb-1">
                    Código Contábil <span className="text-[#8B7D6B] font-normal">(Opcional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 30115"
                    value={newOriginCode}
                    onChange={(e) => setNewOriginCode(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#EAE6DF] rounded-lg focus:outline-none focus:border-[#C19A6B] bg-white text-[#2D2A26]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#433E37] mb-1">
                  Descrição / Observação <span className="text-[#8B7D6B] font-normal">(Opcional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex: Conta corrente secundária..."
                  value={newOriginDesc}
                  onChange={(e) => setNewOriginDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#EAE6DF] rounded-lg focus:outline-none focus:border-[#C19A6B] bg-white text-[#2D2A26]"
                />
              </div>

              {createOriginTargetTituloId && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span className="font-bold">Aviso:</span> Esta nova origem será atribuída automaticamente ao título selecionado após a criação.
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EAE6DF]">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOriginOpen(false);
                    setCreateOriginTargetTituloId(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-[#433E37] hover:bg-[#EAE6DF] rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-[#C19A6B] hover:bg-[#B0895A] rounded-lg shadow-sm transition-colors"
                >
                  Cadastrar e Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TitulosWorkspace;
