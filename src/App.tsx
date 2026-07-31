/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — Paris Dakar Gerencial
 * Todos os dados vêm do Firestore (Firebase). Sem dados hardcoded.
 */

import React, { useEffect, useMemo, useState, useCallback, Suspense, lazy } from 'react';
import { DashboardView } from './components/DashboardView';
import { LaunchModal } from './components/LaunchModal';
import { LoginModal } from './components/LoginModal';
import { Navbar } from './components/Navbar';
import { PwaInstallBanner } from './components/PwaBanners';
import { Sidebar } from './components/Sidebar';

/**
 * CARREGAMENTO SOB DEMANDA DAS TELAS
 * ----------------------------------
 * Antes, todas as 14 telas entravam em um único pacote JavaScript: abrir o
 * sistema baixava e interpretava o código de Fluxo de Caixa, Contas a Pagar,
 * Extrato, PDF, gráficos — mesmo que a pessoa só quisesse ver o Dashboard. Com
 * `lazy`, cada tela vira um arquivo separado, baixado apenas quando aquela aba
 * é aberta pela primeira vez (e depois fica em cache). O Dashboard continua no
 * pacote principal porque é a tela inicial — adiá-lo só adicionaria um piscar.
 */
const CustomerManagementView = lazy(() => import('./components/CustomerManagementView').then((m) => ({ default: m.CustomerManagementView })));
const DelinquencyReportView = lazy(() => import('./components/DelinquencyReportView').then((m) => ({ default: m.DelinquencyReportView })));
const EconomicView = lazy(() => import('./components/EconomicView').then((m) => ({ default: m.EconomicView })));
const FinancialView = lazy(() => import('./components/FinancialView').then((m) => ({ default: m.FinancialView })));
const ImportDataView = lazy(() => import('./components/ImportDataView').then((m) => ({ default: m.ImportDataView })));
const SellersManagementView = lazy(() => import('./components/SellersManagementView').then((m) => ({ default: m.SellersManagementView })));
const ApiIntegrationDocsView = lazy(() => import('./components/ApiIntegrationDocsView').then((m) => ({ default: m.ApiIntegrationDocsView })));
const PostgresSettingsView = lazy(() => import('./components/PostgresSettingsView').then((m) => ({ default: m.PostgresSettingsView })));
const FinancialStatementView = lazy(() => import('./components/FinancialStatementView').then((m) => ({ default: m.FinancialStatementView })));
// Contas a Receber e Contas a Pagar são a MESMA tela, parametrizada por
// `movType`. Um só chunk carregado para os dois módulos.
const TitulosWorkspace = lazy(() => import('./components/TitulosWorkspace').then((m) => ({ default: m.TitulosWorkspace })));
const CashFlowView = lazy(() => import('./components/CashFlowView').then((m) => ({ default: m.CashFlowView })));
const DailyMovementView = lazy(() => import('./components/DailyMovementView').then((m) => ({ default: m.DailyMovementView })));
const BillingView = lazy(() => import('./components/BillingView').then((m) => ({ default: m.BillingView })));
const StockView = lazy(() => import('./components/StockView').then((m) => ({ default: m.StockView })));
const SalesView = lazy(() => import('./components/SalesView').then((m) => ({ default: m.SalesView })));
const TaskManagerView = lazy(() => import('./components/TaskManagerView').then((m) => ({ default: m.TaskManagerView })));
const UserManagementView = lazy(() => import('./components/UserManagementView').then((m) => ({ default: m.UserManagementView })));

/** Esqueleto mostrado enquanto o código de uma tela é baixado. */
const ViewSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-7 w-64 bg-[#E5E0D8] rounded-lg" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 bg-[#E5E0D8]/70 rounded-xl" />)}
    </div>
    <div className="h-64 bg-[#E5E0D8]/50 rounded-xl" />
  </div>
);

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Erro de Renderização Capturado no App:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white p-8 rounded-2xl border border-rose-200 shadow-md max-w-xl mx-auto space-y-4 my-8 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto font-bold text-xl">
            !
          </div>
          <h2 className="text-lg font-extrabold text-[#2D2A26]">Aviso de Renderização do Módulo</h2>
          <p className="text-xs text-[#8B7D6B] leading-relaxed">
            Ocorreu uma inconsistência temporária de exibição nesta tela. Clique no botão abaixo para restaurar a navegação.
          </p>
          {this.state.error?.message && (
            <p className="text-[11px] text-rose-700 font-mono bg-rose-50 p-3 rounded-lg text-left overflow-x-auto border border-rose-200">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-6 py-2.5 bg-[#2D2A26] hover:bg-[#3F3B35] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm"
          >
            Recarregar Módulo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import {
  getEconomicData,
  getFinancialData,
  getClientes,
  getTitulosInadimplentes,
  getVendedores,
  getApiTokens,
  saveEconomicMonth,
  saveFinancialMonth,
  saveCliente,
  updateCliente,
  deleteCliente,
  saveVendedor,
  updateVendedor,
  deleteVendedor,
  clearInadimplencia,
  createApiToken,
  loginFirebase,
  loginWithGoogle,
  logoutFirebase,
  saveBatchCustomers,
  saveBatchDelinquentTitles,
  upsertClientes,
  upsertTitulos,
  updateClienteInadimplencia,
  addTitulo,
  updateTitulo,
  deleteTitulo,
  getExtratoFinanceiro,
  upsertExtratoFinanceiro,
  deleteExtratoFinanceiro,
  clearExtratoFinanceiro,
  getFluxoCaixa,
  saveFluxoCaixa,
  upsertTitulosFinanceiros,
  aplicarBaixaTitulos,
  marcarTitulosParaConferencia,
  atualizarTitulo,
  excluirTitulo,
  zerarTitulos,
} from './firebaseService';

import { fetchTitulos } from './services/titulosService';
import { fetchAgreements, saveAgreement, deleteAgreement } from './services/agreementsService';
import { reconcile } from './utils/reconciliation';
import { buildCustomerIndex, normalizePersonCode } from './utils/linking';

import {
  fetchBillingSummaries,
  fetchBillingCustomers,
  fetchInvoicesByYear,
  upsertInvoicesBatch,
  fetchStockItems,
  fetchStockSummary,
  upsertStockBatch,
} from './services/billingStockService';

import {
  fetchSalesByYear,
  fetchSalesYears,
  saveSalesAuditSnapshot,
  saveSalesSummaries,
  syncSellersFromSales,
  upsertSalesBatch,
} from './services/salesService';
import type { SellerSyncResult } from './services/salesService';
import { auditSales, buildSalesMonthSummaries } from './utils/salesAudit';

import {
  ApiToken,
  BillingCustomerSummary,
  BillingMonthSummary,
  Customer,
  DelinquentTitle,
  DebtAgreement,
  DelinquencyValidationRowResult,
  EconomicMonthData,
  FinancialMonthData,
  FinancialStatementEntry,
  InvoiceRecord,
  BaixaStatus,
  ReconciliationMatch,
  ReconciliationSettings,
  DEFAULT_RECONCILIATION_SETTINGS,
  TituloFinanceiro,
  TituloMovType,
  CashFlowPlan,
  PostgresConfig,
  SaleItem,
  Seller,
  StatementSource,
  StockItem,
  StockSummary,
  ValidationRowResult,
  ViewTab,
  User,
} from './types';

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [importTargetModule, setImportTargetModule] = useState<'financial' | 'economic' | 'customers' | 'delinquency' | 'sales'>('financial');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // ── Autenticação ──────────────────────────────────────────────────────────
  // Ninguém entra sem autenticar: começa SEM usuário e o app só é renderizado
  // depois do login. Antes existia um usuário admin padrão aqui, o que fazia
  // qualquer visitante abrir o sistema já como administrador.
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState<boolean>(false);

  // ── Stores de dados (carregados do Firestore) ─────────────────────────────
  const [economicData, setEconomicData] = useState<Record<string, EconomicMonthData>>({});
  const [financialData, setFinancialData] = useState<Record<string, FinancialMonthData>>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [delinquentTitles, setDelinquentTitles] = useState<DelinquentTitle[]>([]);
  const [agreements, setAgreements] = useState<DebtAgreement[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [statementEntries, setStatementEntries] = useState<FinancialStatementEntry[]>([]);
  // EXTRATO COMPLETO (todos os anos). O `statementEntries` acima é o recorte do
  // exercício selecionado, que é o certo para a TELA do Extrato Financeiro —
  // ela é um relatório anual. Mas a conciliação de Contas a Pagar não pode ser
  // anual: pagamento de 30/12 compensa em 03/01, e um título de 2025 pago pelo
  // extrato de 2026 nunca acharia o par. Por isso a tela de Contas a Pagar
  // trabalha com esta lista.
  const [allStatementEntries, setAllStatementEntries] = useState<FinancialStatementEntry[]>([]);
  // ── Títulos financeiros (RFN046) ────────────────────────────────────────
  // Duas listas com o MESMO tipo, porque são o mesmo relatório visto pelos dois
  // lados do movimento. O recorte é o ano do VENCIMENTO (competência).
  const [receivables, setReceivables] = useState<TituloFinanceiro[]>([]);
  const [payables, setPayables] = useState<TituloFinanceiro[]>([]);
  // PREVISÃO DE PAGAMENTO (RFN046 — títulos em aberto). Carregada SEM filtro de
  // ano de propósito: a pergunta "quanto vou pagar nos próximos 30 dias" feita
  // em dezembro precisa enxergar os vencimentos de janeiro. É uma base pequena
  // (só o que está em aberto), então o custo de leitura é irrelevante.
  // Parâmetros da baixa automática. Ficam no navegador do gestor porque são
  // preferência de trabalho, não dado da empresa — e cada operação tem a sua
  // régua para tolerância de valor e janela de dias.
  const [reconSettings, setReconSettings] = useState<ReconciliationSettings>(() => {
    try {
      const raw = localStorage.getItem('pdk_recon_settings');
      return raw ? { ...DEFAULT_RECONCILIATION_SETTINGS, ...JSON.parse(raw) } : DEFAULT_RECONCILIATION_SETTINGS;
    } catch {
      return DEFAULT_RECONCILIATION_SETTINGS;
    }
  });
  const [cashFlowPlans, setCashFlowPlans] = useState<CashFlowPlan[]>([]);
  const [loginError, setLoginError] = useState<string>('');

  // ── Faturamento e Estoque (carregados sob demanda, ver loadBilling/loadStock)
  const [billingSummaries, setBillingSummaries] = useState<BillingMonthSummary[]>([]);
  const [billingCustomers, setBillingCustomers] = useState<BillingCustomerSummary[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [isStockLoading, setIsStockLoading] = useState(false);
  const [billingLoaded, setBillingLoaded] = useState(false);
  // Carga leve (só resumos mensais) usada pelo Dashboard — ver loadBillingSummariesLight
  const [billingSummariesLoaded, setBillingSummariesLoaded] = useState(false);
  const [stockLoaded, setStockLoaded] = useState(false);

  // ── Vendas de Produtos (RPR001) ──────────────────────────────────────────
  // Mesma política do Faturamento e do Estoque: 16 mil linhas não entram na
  // memória no login. A carga acontece ao abrir a aba, e traz os anos mais
  // recentes primeiro — que é o recorte que responde 90% das perguntas.
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [salesYears, setSalesYears] = useState<number[]>([]);
  const [loadedSalesYears, setLoadedSalesYears] = useState<number[]>([]);
  const [isSalesLoading, setIsSalesLoading] = useState(false);
  const [salesLoaded, setSalesLoaded] = useState(false);

  // Config Postgres mantida apenas para exibição da tela de configurações
  const [postgresConfig] = useState<PostgresConfig>({
    host: import.meta.env.VITE_PGHOST || 'Firebase Firestore',
    port: 5432,
    database: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'paris-dakar-gerencial',
    user: 'firebase-auth',
    ssl: true,
    isConnected: true,
  });

  // ── Dados "mestre" (não variam por ano) ───────────────────────────────────
  // clientes/títulos/vendedores/tokens não têm campo "ano": antes eram
  // recarregados por inteiro em TODA troca de aba de ano (2024/2025/2026/2027),
  // multiplicando leituras no Firestore sem necessidade nenhuma (a cota estourou
  // 8x o limite diário com só 3 usuários — ver commit da correção). Agora
  // carregam uma única vez por login.
  const loadMasterData = useCallback(async () => {
    try {
      const [cliData, titData, vendData, tokData, acordosData] = await Promise.all([
        getClientes(),
        getTitulosInadimplentes(),
        getVendedores(),
        getApiTokens(),
        fetchAgreements(),
      ]);
      setCustomers(cliData);
      setDelinquentTitles(titData);
      setSellers(vendData);
      setApiTokens(tokData);
      setAgreements(acordosData);
    } catch (err: any) {
      console.error('Erro ao carregar dados mestre do Firestore:', err.message);
    }
  }, []);

  // ── Dados do ano selecionado (já filtrados por "ano" no Firestore) ────────
  const loadYearData = useCallback(async (year: number) => {
    setIsLoading(true);
    try {
      const [ecoData, finData, stmtData, allStmtData, recvData, payData, cashData] = await Promise.all([
        getEconomicData(year),
        getFinancialData(year),
        getExtratoFinanceiro(year),
        // Extrato completo, para a conciliação de Contas a Pagar enxergar as
        // viradas de ano (ver comentário na declaração do estado).
        getExtratoFinanceiro(),
        fetchTitulos('R', year),
        fetchTitulos('P', year),
        getFluxoCaixa(year),
      ]);
      setEconomicData(ecoData);
      setFinancialData(finData);
      setStatementEntries(stmtData);
      setAllStatementEntries(allStmtData);
      setReceivables(recvData);
      setPayables(payData);
      setCashFlowPlans(cashData);
    } catch (err: any) {
      console.error('Erro ao carregar dados do ano no Firestore:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Carrega os dados mestre uma única vez por login (não depende do ano
  // selecionado, então não deve rodar de novo a cada troca de aba de ano).
  useEffect(() => {
    if (!currentUser) return;
    loadMasterData();
  }, [currentUser, loadMasterData]);

  // Só carrega dados depois que houver um usuário autenticado. Além de ser o
  // correto em termos de acesso, evita gastar cota do Firestore com visitantes
  // que nem entraram no sistema. Recarrega ao trocar de ano — mas sem repetir
  // as coleções mestre (ver loadMasterData acima).
  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      return;
    }
    loadYearData(selectedYear);
  }, [selectedYear, loadYearData, currentUser]);

  // ── Faturamento e Estoque: carregam SÓ quando a aba é aberta ──────────────
  // Estas duas bases são as maiores do sistema (29 mil notas, 5 mil SKUs).
  // Carregá-las no login pesaria em todo mundo, inclusive em quem só quer ver
  // o DRE. Então elas ficam adormecidas até a aba correspondente ser aberta —
  // e mesmo aí, o Faturamento lê apenas os resumos mensais, nunca as notas.
  // `force` precisa VENCER o guard de "já está carregando".
  // O bug anterior: `if (isBillingLoading || ...)` abortava silenciosamente o
  // recarregamento pedido logo após a importação, porque a tela ainda estava
  // com o flag de carga ligado. O usuário terminava de importar 29 mil notas e
  // continuava vendo R$ 0,00, sem nenhum erro no console.
  const loadBilling = useCallback(async (force = false) => {
    if (!force && (isBillingLoading || billingLoaded)) return;
    setIsBillingLoading(true);
    try {
      const [sums, custs] = await Promise.all([fetchBillingSummaries(), fetchBillingCustomers()]);
      setBillingSummaries(sums);
      setBillingCustomers(custs);
      setBillingLoaded(true);
    } catch (err: any) {
      console.error('Erro ao carregar faturamento:', err.message);
    } finally {
      setIsBillingLoading(false);
    }
  }, [isBillingLoading, billingLoaded]);

  /**
   * Carga LEVE do faturamento, usada pelo Dashboard.
   *
   * Diferente de `loadBilling`, lê apenas `faturamento_mensal` (12 documentos
   * por ano) e ignora `faturamento_cliente`, que tem milhares. É o bastante
   * para o gráfico Faturado × Recebido × Pago e mantém a abertura do sistema
   * barata — o Dashboard é a primeira tela de todo mundo, todo dia.
   * Se a carga completa já rodou, não faz nada: os resumos já estão em memória.
   */
  const loadBillingSummariesLight = useCallback(async () => {
    if (billingLoaded || billingSummariesLoaded || isBillingLoading) return;
    try {
      const sums = await fetchBillingSummaries();
      setBillingSummaries(sums);
      setBillingSummariesLoaded(true);
    } catch (err: any) {
      console.error('Erro ao carregar resumos de faturamento:', err.message);
    }
  }, [billingLoaded, billingSummariesLoaded, isBillingLoading]);

  const loadStock = useCallback(async (force = false) => {
    if (!force && (isStockLoading || stockLoaded)) return;
    setIsStockLoading(true);
    try {
      const [items, summary] = await Promise.all([fetchStockItems(), fetchStockSummary()]);
      setStockItems(items);
      setStockSummary(summary);
      setStockLoaded(true);
    } catch (err: any) {
      console.error('Erro ao carregar estoque:', err.message);
    } finally {
      setIsStockLoading(false);
    }
  }, [isStockLoading, stockLoaded]);

  /**
   * Carga das vendas. Traz os DOIS anos mais recentes por padrão, não o
   * histórico inteiro: seis anos são ~16 mil documentos e a análise de margem
   * corrente raramente precisa de 2020. Os anos anteriores ficam disponíveis
   * sob demanda pelo seletor "Carregar ano" da própria tela.
   */
  const loadSales = useCallback(async (force = false) => {
    if (!force && (isSalesLoading || salesLoaded)) return;
    setIsSalesLoading(true);
    try {
      const years = await fetchSalesYears();
      setSalesYears(years);
      const target = years.slice(0, 2);
      const chunks = await Promise.all(target.map((y) => fetchSalesByYear(y)));
      setSaleItems(chunks.flat());
      setLoadedSalesYears(target);
      setSalesLoaded(true);
    } catch (err: any) {
      console.error('Erro ao carregar vendas:', err.message);
    } finally {
      setIsSalesLoading(false);
    }
  }, [isSalesLoading, salesLoaded]);

  /** Acrescenta um ano ao que já está em memória, sem recarregar o resto. */
  const handleLoadSalesYear = useCallback(async (year: number) => {
    if (loadedSalesYears.includes(year)) return;
    setIsSalesLoading(true);
    try {
      const rows = await fetchSalesByYear(year);
      setSaleItems((prev) => {
        const seen = new Set(prev.map((p) => p.dedupeKey));
        return [...prev, ...rows.filter((r) => !seen.has(r.dedupeKey))];
      });
      setLoadedSalesYears((prev) => [...prev, year]);
    } catch (err: any) {
      console.error(`Erro ao carregar vendas de ${year}:`, err.message);
    } finally {
      setIsSalesLoading(false);
    }
  }, [loadedSalesYears]);

  // ── Handler: importação do RPR001 (Vendas de Produtos) ───────────────────
  // Grava o detalhe, recalcula os resumos mensais com o MESMO motor que a tela
  // usa (salesAudit) e guarda o retrato da auditoria. Reusar o motor é
  // deliberado: se o serviço tivesse a própria fórmula de margem, painel e
  // banco divergiriam na primeira mudança de regra.
  const handleImportSales = useCallback(async (items: SaleItem[]) => {
    const result = await upsertSalesBatch(items);
    console.info(
      `[Vendas] ${result.added} novas, ${result.updated} atualizadas, ` +
      `${result.unchanged} sem alteração, ${result.errors} erros.`
    );

    const audit = auditSales(items, stockItems, customers);
    await saveSalesSummaries(buildSalesMonthSummaries(audit.audited));

    for (const year of result.years.filter(Boolean)) {
      const yearAudit = auditSales(
        items.filter((i) => i.year === year),
        stockItems,
        customers
      );
      await saveSalesAuditSnapshot({
        year,
        totalRiskAmount: yearAudit.risk.totalRiskAmount,
        negativeMarginAmount: yearAudit.risk.negativeMarginAmount,
        negativeMarginLines: yearAudit.risk.negativeMarginLines,
        excessDiscountAmount: yearAudit.risk.excessDiscountAmount,
        excessDiscountLines: yearAudit.risk.excessDiscountLines,
        marginGapAmount: yearAudit.risk.marginGapAmount,
        priceGapAmount: yearAudit.risk.priceGapAmount,
        relatedPartyRevenue: yearAudit.risk.relatedPartyRevenue,
        thresholds: {},
        updatedAt: new Date().toISOString(),
      });
    }

    await loadSales(true);
  }, [stockItems, customers, loadSales]);

  /**
   * Cadastra a equipe de vendas a partir das notas.
   *
   * É o passo que faz a inadimplência encontrar o responsável: o RFN029 traz o
   * vendedor por nome, o RPR001 traz por código, e só o cadastro `vendedores`
   * casa os dois. Depois de sincronizar, recarregamos os dados mestre para que
   * a tela de Vendedores e o cruzamento de inadimplência já enxerguem os novos.
   */
  const handleSyncSellersFromSales = useCallback(
    async (items: SaleItem[]): Promise<SellerSyncResult | null> => {
      try {
        const result = await syncSellersFromSales(items, sellers);
        if (result.created.length || result.codeFilled.length) {
          const refreshed = await getVendedores();
          setSellers(refreshed);
        }
        console.info(
          `[Vendedores] ${result.created.length} cadastrados, ${result.existing} já existiam, ` +
          `${result.codeFilled.length} com código preenchido, ${result.duplicates.length} duplicidades na origem.`
        );
        return result;
      } catch (err: any) {
        console.error('Erro ao sincronizar vendedores:', err.message);
        return null;
      }
    },
    [sellers]
  );

  useEffect(() => {
    if (!currentUser) return;
    // O Dashboard precisa do FATURAMENTO para o ciclo "Faturado × Recebido ×
    // Pago", mas não pode pagar o preço da carga completa: `loadBilling` também
    // lê `faturamento_cliente` (milhares de documentos). Aqui puxamos só os
    // resumos mensais — 12 documentos por ano — o suficiente para o painel.
    if (activeTab === 'dashboard') loadBillingSummariesLight();
    if (activeTab === 'billing') loadBilling();
    if (activeTab === 'stock') loadStock();
    // Vendas depende do Estoque e dos Clientes para os vínculos; o Estoque é
    // carregado junto para que a coluna "custo atual" não apareça vazia na
    // primeira abertura da aba.
    if (activeTab === 'sales') { loadSales(); loadStock(); }
  }, [activeTab, currentUser, loadBilling, loadStock, loadSales, loadBillingSummariesLight]);

  // ── Handler: importação do RPR014 (Faturamento) ──────────────────────────
  /**
   * Importação do RPR014.
   *
   * Três coisas acontecem aqui, e a ordem importa:
   *  1. grava e recebe de volta os resumos JÁ CALCULADOS;
   *  2. aplica esses resumos no estado na hora — os cartões atualizam antes de
   *     qualquer releitura do Firestore. Depender da releitura era a causa dos
   *     cartões continuarem zerados: a escrita em lote ainda não tinha
   *     propagado quando o `getDocs` seguinte era disparado;
   *  3. só então relê do banco, para pegar meses de outras cargas que não
   *     estavam nesta planilha.
   */
  const handleImportInvoices = useCallback(async (
    records: InvoiceRecord[],
    onProgress?: (stage: string, done: number, total: number) => void
  ) => {
    const result = await upsertInvoicesBatch(records, onProgress);
    console.info(
      `[Faturamento] ${result.added} novos, ${result.updated} atualizados, ` +
      `${result.unchanged} sem alteração, ${result.errors} erros.`
    );

    // (2) atualização otimista: mescla por id, mantendo os meses que já estavam
    // na tela e substituindo os que acabaram de ser recalculados.
    if (result.summaries.length) {
      setBillingSummaries((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        result.summaries.forEach((m) => map.set(m.id, m));
        return [...map.values()];
      });
    }

    // (3) e o ano em foco: se o usuário estava em um ano sem movimento e a
    // planilha trouxe outros, levamos a tela para o ano mais recente que tem
    // dados. Sem isso, o resultado visível de importar seis anos de histórico
    // é uma tela vazia, porque o seletor continuou onde estava.
    const importedYears = [...new Set(result.summaries.filter((m) => m.grossRevenue > 0).map((m) => m.year))];
    if (importedYears.length && !importedYears.includes(selectedYear)) {
      setSelectedYear(Math.max(...importedYears));
    }

    await loadBilling(true);
  }, [loadBilling, selectedYear]);

  // ── Handler: importação do RPR053 (Estoque / Lista de Preço) ─────────────
  const handleImportStock = useCallback(async (items: StockItem[]) => {
    const result = await upsertStockBatch(items);
    console.info(
      `[Estoque] ${result.added} novos, ${result.updated} atualizados, ` +
      `${result.unchanged} sem alteração, ${result.errors} erros.`
    );
    await loadStock(true);
  }, [loadStock]);

  // Detalhe nota a nota de um ano — só quando o usuário pede explicitamente.
  const handleLoadInvoiceDetail = useCallback(
    async (year: number): Promise<InvoiceRecord[]> => fetchInvoicesByYear(year),
    []
  );



  /**
   * Anos que têm dados de fato, para o seletor de ano oferecer como atalho.
   *
   * Reúne todas as fontes que já foram carregadas: resumos de faturamento,
   * partições de vendas e os lançamentos de DRE/financeiro do ano corrente.
   * Não dispara nenhuma leitura nova — usa só o que está em memória, senão o
   * cabeçalho passaria a custar consultas ao Firestore em todo render.
   */
  const yearsWithData = useMemo(() => {
    const set = new Set<number>();
    billingSummaries.forEach((m) => { if (m.grossRevenue > 0) set.add(m.year); });
    salesYears.forEach((y) => set.add(y));
    saleItems.forEach((i) => { if (i.year) set.add(i.year); });
    return [...set].filter(Boolean).sort((a, b) => b - a);
  }, [billingSummaries, salesYears, saleItems]);

  // ── Handler: Login via Firebase Auth ─────────────────────────────────────
  // O perfil de acesso (role) vem SEMPRE do registro do usuário no Firestore
  // (fonte da verdade), nunca de um valor escolhido no formulário — isso
  // evita que qualquer pessoa se autoconceda acesso de administrador.
  const handleLoginSuccess = async (credentials: { email: string; password: string }) => {
    setLoginError('');
    try {
      const result = await loginFirebase(credentials.email, credentials.password);
      if (result) {
        setCurrentUser({
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
        });
        setIsLoginModalOpen(false);
      }
    } catch (err: any) {
      setLoginError(err.message || 'Erro ao autenticar. Verifique as credenciais.');
    }
  };

  // ── Handler: Login com a conta Google (Gmail) ────────────────────────────
  const handleGoogleLogin = async () => {
    setLoginError('');
    try {
      const result = await loginWithGoogle();
      if (result) {
        setCurrentUser({
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
          avatar: result.user.avatar,
        });
        setIsLoginModalOpen(false);
      }
    } catch (err: any) {
      setLoginError(err.message || 'Erro ao entrar com o Google.');
    }
  };

  // Logout encerra a sessão de verdade e volta para a tela de login (antes
  // devolvia um usuário admin padrão, ou seja, "deslogar" mantinha acesso total).
  const handleLogout = async () => {
    try {
      await logoutFirebase();
    } catch (err) {
      console.error('Erro ao encerrar sessao:', err);
    }
    setCurrentUser(null);
    setLoginError('');
    setActiveTab('dashboard');
  };

  // ── Handler: Lançamento Manual (DRE / Financeiro) ─────────────────────────
  const handleSaveLaunch = async (launch: {
    targetModule: 'economic' | 'financial';
    year: number;
    monthKey: string;
    fieldValues: Record<string, number>;
  }) => {
    if (launch.targetModule === 'economic') {
      const current: EconomicMonthData = economicData[launch.monthKey] || {
        monthKey: launch.monthKey,
        monthLabel: `${launch.monthKey}/${launch.year}`,
        receitaBruta: 0,
        cmv: 0,
        cmvPercent: 0,
        margemBruta: 0,
        margemPercent: 0,
        despesasFixas: 0,
        despesasPercent: 0,
        resultadoEconomico: 0,
        resultadoPercent: 0,
        pontoEquilibrio: 0,
      };

      const receitaBruta = launch.fieldValues.receitaBruta ?? current.receitaBruta;
      const cmv = launch.fieldValues.cmv ?? current.cmv;
      const despesasFixas = launch.fieldValues.despesasFixas ?? current.despesasFixas;

      const cmvPercent = receitaBruta > 0 ? (cmv / receitaBruta) * 100 : 0;
      const margemBruta = receitaBruta - cmv;
      const margemPercent = receitaBruta > 0 ? (margemBruta / receitaBruta) * 100 : 0;
      const despesasPercent = receitaBruta > 0 ? (despesasFixas / receitaBruta) * 100 : 0;
      const resultadoEconomico = margemBruta - despesasFixas;
      const resultadoPercent = receitaBruta > 0 ? (resultadoEconomico / receitaBruta) * 100 : 0;
      const pontoEquilibrio = margemPercent > 0 ? despesasFixas / (margemPercent / 100) : 0;

      const updatedMonth: EconomicMonthData = {
        ...current,
        receitaBruta,
        cmv,
        cmvPercent: Math.round(cmvPercent * 100) / 100,
        margemBruta,
        margemPercent: Math.round(margemPercent * 100) / 100,
        despesasFixas,
        despesasPercent: Math.round(despesasPercent * 100) / 100,
        resultadoEconomico,
        resultadoPercent: Math.round(resultadoPercent * 100) / 100,
        pontoEquilibrio: Math.round(pontoEquilibrio * 100) / 100,
      };

      // Atualiza state local imediatamente
      setEconomicData((prev) => ({ ...prev, [launch.monthKey]: updatedMonth }));

      // Persiste no Firestore
      await saveEconomicMonth(launch.year, launch.monthKey, updatedMonth).catch((e) =>
        console.error('Erro ao salvar econômico no Firestore:', e)
      );
    } else {
      const current: FinancialMonthData = financialData[launch.monthKey] || {
        monthKey: launch.monthKey,
        monthLabel: `${launch.monthKey}/${launch.year}`,
        entradasBancos: 0,
        entradasTesouraria: 0,
        totalEntradas: 0,
        totalSaidas: 0,
        resultadoFinanceiro: 0,
        resultadoPercent: 0,
        estoque: 0,
        inadimplenciaMensal: 0,
        inadimplenciaAcumulada: 0,
      };

      const entradasBancos = launch.fieldValues.entradasBancos ?? current.entradasBancos;
      const entradasTesouraria = launch.fieldValues.entradasTesouraria ?? current.entradasTesouraria;
      const totalEntradas = entradasBancos + entradasTesouraria;
      const totalSaidas = launch.fieldValues.totalSaidas ?? current.totalSaidas;
      const resultadoFinanceiro = totalEntradas - totalSaidas;
      const resultadoPercent = totalEntradas > 0 ? (resultadoFinanceiro / totalEntradas) * 100 : 0;
      const estoque = launch.fieldValues.estoque ?? current.estoque;
      const inadimplenciaMensal = launch.fieldValues.inadimplenciaMensal ?? current.inadimplenciaMensal;

      // Recalcula inadimplência acumulada
      const monthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const updatedMonth: FinancialMonthData = {
        ...current,
        entradasBancos,
        entradasTesouraria,
        totalEntradas,
        totalSaidas,
        resultadoFinanceiro,
        resultadoPercent: Math.round(resultadoPercent * 100) / 100,
        estoque,
        inadimplenciaMensal,
        inadimplenciaAcumulada: current.inadimplenciaAcumulada,
      };

      const newFinancial = { ...financialData, [launch.monthKey]: updatedMonth };

      // Recalcula acumulado para o ano
      let acc = 0;
      monthKeys.forEach((m) => {
        if (newFinancial[m]) {
          acc += newFinancial[m].inadimplenciaMensal;
          newFinancial[m] = { ...newFinancial[m], inadimplenciaAcumulada: Math.round(acc * 100) / 100 };
        }
      });

      setFinancialData(newFinancial);

      // Persiste no Firestore
      await saveFinancialMonth(launch.year, launch.monthKey, newFinancial[launch.monthKey]).catch((e) =>
        console.error('Erro ao salvar financeiro no Firestore:', e)
      );
    }
  };

  // ── Handler: Importação CSV/Excel ─────────────────────────────────────
  const handleCommitImport = async (
    validEntries: ValidationRowResult[],
    year: number,
    targetModule: 'economic' | 'financial' | 'customers' | 'delinquency'
  ) => {
    if (targetModule === 'customers') {
      // Importação em lote de clientes com UPSERT usando cod_cliente como chave.
      // Cada linha válida traz um parsedCustomer completo com todos os campos da planilha.
      const parsedCustomers: Partial<Customer>[] = validEntries
        .map((entry) => (entry as any).parsedCustomer as Partial<Customer> | undefined)
        .filter((c): c is Partial<Customer> => !!c && !!(c.name));

      if (parsedCustomers.length === 0) return;

      try {
        const result = await upsertClientes(parsedCustomers);
        console.log(`Clientes importados: ${result.added} novos, ${result.updated} atualizados.`);
        // Recarrega do Firestore para refletir IDs/estado reais (sem duplicar)
        const fresh = await getClientes();
        setCustomers(fresh);
      } catch (e) {
        console.error('Erro ao importar clientes (upsert):', e);
      }
      return;
    }

    if (targetModule === 'delinquency') {
      // Importação de títulos inadimplentes via validateFinancialRows (caminho legado)
      // O caminho principal é handleCommitDelinquencyImport (via validateDelinquencyRows)
      const newTitles: DelinquentTitle[] = validEntries.map((entry, idx) => {
        const rawVal = entry.rawValue || '0';
        const numVal = parseFloat(rawVal.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
        const customerCode = (entry.rawCustomer || '').trim();
        const dueDate = (entry.rawDate || '').trim();
        const titleNumber = (entry.rawType || '').trim() || `TIT-${Date.now()}-${idx}`;

        // Buscar cliente pelo código ou pelo nome
        const matchedCustomer = customers.find(
          (c) =>
            c.code.toLowerCase() === customerCode.toLowerCase() ||
            c.name.toLowerCase() === customerCode.toLowerCase()
        );

        // Calcular dias em atraso
        let daysOverdue = 0;
        try {
          const due = new Date(dueDate.split('/').reverse().join('-'));
          const today = new Date();
          daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
        } catch { /* */ }

        const agingBucket: DelinquentTitle['agingBucket'] =
          daysOverdue <= 30 ? '1-30' :
          daysOverdue <= 60 ? '31-60' :
          daysOverdue <= 90 ? '61-90' : '>90';

        return {
          id: `tit_import_${Date.now()}_${idx}`,
          titleNumber,
          customerId: matchedCustomer?.id || '',
          customerCode: matchedCustomer?.code || customerCode,
          customerName: matchedCustomer?.name || customerCode,
          cnpjCpf: matchedCustomer?.cnpjCpf || '',
          issueDate: '',
          dueDate,
          originalAmount: numVal,
          updatedAmount: numVal,
          daysOverdue,
          agingBucket,
          collectionStatus: 'Aguardando' as const,
          notes: (entry.rawDescription || '').trim(),
        };
      });

      setDelinquentTitles((prev) => [...newTitles, ...prev]);

      // Atualiza valores inadimplentes dos clientes vinculados
      const updatedCustomers = [...customers];
      newTitles.forEach((title) => {
        const custIdx = updatedCustomers.findIndex(
          (c) => c.id === title.customerId || c.code.toLowerCase() === title.customerCode.toLowerCase()
        );
        if (custIdx >= 0) {
          updatedCustomers[custIdx] = {
            ...updatedCustomers[custIdx],
            delinquentAmount: updatedCustomers[custIdx].delinquentAmount + title.updatedAmount,
            status: 'Inadimplente',
          };
        }
      });
      setCustomers(updatedCustomers);

      await saveBatchDelinquentTitles(newTitles).catch((e) =>
        console.error('Erro ao salvar títulos em lote:', e)
      );
      return;
    }

    // Módulos econômico e financeiro (lógica original)
    validEntries.forEach((entry) => {
      const numVal = parseFloat(
        entry.rawValue.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()
      );
      if (isNaN(numVal) || numVal <= 0) return;

      const rawMonth = entry.rawDate?.toLowerCase()?.substring(0, 3) || 'jan';
      const validMonths = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const monthKey = validMonths.includes(rawMonth) ? rawMonth : 'jan';

      if (targetModule === 'economic') {
        handleSaveLaunch({
          targetModule: 'economic',
          year,
          monthKey,
          fieldValues: { receitaBruta: numVal },
        });
      } else {
        handleSaveLaunch({
          targetModule: 'financial',
          year,
          monthKey,
          fieldValues: { entradasBancos: numVal },
        });
      }
    });
  };

  // Recalcula a inadimplência (dívida) de cada cliente a partir dos títulos, vinculando por
  // cod_cliente (customerCode) ou por id. Atualiza state local e persiste os clientes alterados.
  const applyDelinquencyToCustomers = async (
    titlesList: DelinquentTitle[],
    customersList: Customer[]
  ): Promise<Customer[]> => {
    const sumByCode = new Map<string, number>();
    const sumById = new Map<string, number>();
    titlesList.forEach((t) => {
      const amt = t.updatedAmount || 0;
      if (t.customerCode) {
        const k = t.customerCode.toLowerCase();
        sumByCode.set(k, (sumByCode.get(k) || 0) + amt);
      }
      if (t.customerId) {
        sumById.set(t.customerId, (sumById.get(t.customerId) || 0) + amt);
      }
    });

    const updated = customersList.map((c) => {
      const amount =
        (c.id ? sumById.get(c.id) : undefined) ??
        (c.code ? sumByCode.get(c.code.toLowerCase()) : undefined) ??
        0;
      const status: Customer['status'] =
        amount > 0 ? 'Inadimplente' : c.status === 'Risco' ? 'Risco' : 'Adimplente';
      return { ...c, delinquentAmount: amount, status };
    });

    // Persiste apenas os clientes cujo valor/status mudou
    await Promise.all(
      updated
        .filter(
          (c, i) =>
            c.delinquentAmount !== customersList[i].delinquentAmount ||
            c.status !== customersList[i].status
        )
        .map((c) => updateClienteInadimplencia(c.id, c.delinquentAmount, c.status))
    ).catch((e) => console.error('Erro ao atualizar inadimplência dos clientes:', e));

    setCustomers(updated);
    return updated;
  };

  // ── Handler: Importação de Inadimplência ────────────────────────────────────
  //
  // `Pessoa_CodigoDevedor` da planilha é gravado em `customerCode` e é a chave
  // que amarra o título ao cadastro (`Customer.code`). Devedor que ainda não
  // existe no cadastro é criado na hora com os dados da própria planilha (nome,
  // CPF/CNPJ, telefone) — sem isso o título ficaria órfão e a dívida não
  // apareceria no cadastro do cliente, que é justamente o relatório que o
  // pessoal de cobrança abre.
  const handleCommitDelinquencyImport = async (
    validEntries: DelinquencyValidationRowResult[]
  ) => {
    const parsedTitles = validEntries.map((e) => e.parsedTitle).filter(Boolean) as Partial<DelinquentTitle>[];
    if (parsedTitles.length === 0) return;

    try {
      // 1) Descobre quais devedores ainda não têm cadastro
      const byCode = new Map(customers.filter((c) => c.code).map((c) => [c.code.toLowerCase(), c]));
      const byName = new Map(customers.map((c) => [c.name.trim().toLowerCase(), c]));

      const missing = new Map<string, Partial<Customer>>();
      parsedTitles.forEach((p) => {
        const code = (p.customerCode || '').trim();
        const name = (p.customerName || '').trim();
        if (!code) return;
        const exists = byCode.get(code.toLowerCase()) || byName.get(name.toLowerCase());
        if (exists || missing.has(code.toLowerCase())) return;
        missing.set(code.toLowerCase(), {
          code,
          name,
          cnpjCpf: p.cnpjCpf || '',
          phone: p.customerPhone || '',
          cellphone: p.customerPhone || '',
          contactName: '',
          email: '',
          city: '',
          state: '',
          creditLimit: 0,
          currentBalance: 0,
          delinquentAmount: 0,
          status: 'Inadimplente',
          sellerResponsible: p.sellerName || '',
          relationshipType: 'Cliente',
          // CPF tem 11 dígitos; acima disso é CNPJ. Serve só de palpite inicial —
          // o cadastro completo do cliente sobrescreve na próxima importação.
          personType: (p.cnpjCpf || '').replace(/\D/g, '').length > 11 ? 'J' : 'F',
        });
      });

      let workingCustomers = customers;
      if (missing.size > 0) {
        await upsertClientes([...missing.values()]);
        workingCustomers = await getClientes();
        setCustomers(workingCustomers);
        console.log(`Clientes criados a partir da inadimplência: ${missing.size}`);
      }

      // 2) Vincula cada título ao cliente (por código e, como rede, por nome)
      const codeIndex = new Map(workingCustomers.filter((c) => c.code).map((c) => [c.code.toLowerCase(), c]));
      const nameIndex = new Map(workingCustomers.map((c) => [c.name.trim().toLowerCase(), c]));

      const titlesToSave: Omit<DelinquentTitle, 'id'>[] = parsedTitles.map((p) => {
        const code = (p.customerCode || '').trim();
        const matched =
          (code ? codeIndex.get(code.toLowerCase()) : undefined) ||
          nameIndex.get((p.customerName || '').trim().toLowerCase());

        return {
          ...(p as Omit<DelinquentTitle, 'id' | 'customerId'>),
          customerId: matched?.id || '',
          customerCode: matched?.code || code,
          customerName: p.customerName || matched?.name || '',
          cnpjCpf: p.cnpjCpf || matched?.cnpjCpf || '',
        };
      });

      const result = await upsertTitulos(titlesToSave);
      console.log(`Títulos importados: ${result.added} novos, ${result.updated} atualizados.`);

      // 3) Recarrega os títulos reais e recalcula a dívida de cada cliente
      const freshTitles = await getTitulosInadimplentes();
      setDelinquentTitles(freshTitles);
      await applyDelinquencyToCustomers(freshTitles, workingCustomers);
    } catch (err: any) {
      console.error('Erro ao importar inadimplência:', err?.message || err);
    }
  };

  // ── Handlers: CRUD de Títulos de Inadimplência ──────────────────────────────
  const handleAddTitle = async (title: Omit<DelinquentTitle, 'id'>) => {
    try {
      // Vincula cliente por código informado
      const matched = customers.find(
        (c) => title.customerCode && c.code.toLowerCase() === title.customerCode.toLowerCase()
      );
      const enriched = {
        ...title,
        customerId: matched?.id || title.customerId || '',
        customerName: matched?.name || title.customerName,
        cnpjCpf: title.cnpjCpf || matched?.cnpjCpf || '',
      };
      await addTitulo(enriched as DelinquentTitle);
      const freshTitles = await getTitulosInadimplentes();
      setDelinquentTitles(freshTitles);
      await applyDelinquencyToCustomers(freshTitles, customers);
    } catch (e) {
      console.error('Erro ao adicionar título:', e);
    }
  };

  const handleUpdateTitle = async (id: string, title: Partial<DelinquentTitle>) => {
    try {
      await updateTitulo(id, title);
      const freshTitles = await getTitulosInadimplentes();
      setDelinquentTitles(freshTitles);
      await applyDelinquencyToCustomers(freshTitles, customers);
    } catch (e) {
      console.error('Erro ao atualizar título:', e);
    }
  };

  const handleDeleteTitle = async (id: string) => {
    try {
      await deleteTitulo(id);
      const freshTitles = await getTitulosInadimplentes();
      setDelinquentTitles(freshTitles);
      await applyDelinquencyToCustomers(freshTitles, customers);
    } catch (e) {
      console.error('Erro ao excluir título:', e);
    }
  };

  // ── Handlers: Acordos de Negociação ────────────────────────────────────────
  // Gravar o acordo carimba os títulos envolvidos no mesmo batch (ver
  // agreementsService). Por isso os títulos são SEMPRE relidos depois: sem essa
  // releitura a lista continuaria oferecendo "Negociar" num título que já tem
  // acordo, e a segunda negociação sobrescreveria a primeira.
  const handleSaveAgreement = async (agreement: DebtAgreement) => {
    try {
      await saveAgreement(agreement);
      const [freshAgreements, freshTitles] = await Promise.all([
        fetchAgreements(),
        getTitulosInadimplentes(),
      ]);
      setAgreements(freshAgreements);
      setDelinquentTitles(freshTitles);
    } catch (e) {
      console.error('Erro ao gravar acordo de negociação:', e);
    }
  };

  const handleDeleteAgreement = async (agreement: DebtAgreement) => {
    try {
      await deleteAgreement(agreement.id, agreement.titleIds);
      const [freshAgreements, freshTitles] = await Promise.all([
        fetchAgreements(),
        getTitulosInadimplentes(),
      ]);
      setAgreements(freshAgreements);
      setDelinquentTitles(freshTitles);
    } catch (e) {
      console.error('Erro ao excluir acordo de negociação:', e);
    }
  };

  // ── Handler: Novo Cliente ─────────────────────────────────────────────────
  const handleAddCustomer = async (custData: Partial<Customer>) => {
    const newCust: Customer = {
      id: `cli_${Date.now()}`,
      code: custData.code || `CLI-${Math.floor(1000 + Math.random() * 9000)}`,
      name: custData.name || 'Novo Cliente',
      cnpjCpf: custData.cnpjCpf || '00.000.000/0001-00',
      tradeName: custData.tradeName || custData.name || '',
      contactName: custData.contactName || '',
      phone: custData.phone || '',
      email: custData.email || '',
      city: custData.city || 'São Paulo',
      state: custData.state || 'SP',
      creditLimit: custData.creditLimit || 0,
      currentBalance: custData.currentBalance || 0,
      delinquentAmount: custData.delinquentAmount || 0,
      status: (custData.delinquentAmount || 0) > 0 ? 'Inadimplente' : 'Adimplente',
      lastPurchaseDate: new Date().toISOString().split('T')[0],
      relationshipType: custData.relationshipType || 'Nenhum',
      expenseClassification: custData.expenseClassification || 'Nenhuma',
    };

    setCustomers((prev) => [newCust, ...prev]);
    await saveCliente(newCust).catch((e) =>
      console.error('Erro ao salvar cliente no Firestore:', e)
    );
  };

  const handleUpdateCustomer = async (id: string, custData: Partial<Customer>) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...custData } : c))
    );
    await updateCliente(id, custData).catch((e) =>
      console.error('Erro ao atualizar cliente no Firestore:', e)
    );
  };

  const handleDeleteCustomer = async (id: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    await deleteCliente(id).catch((e) =>
      console.error('Erro ao excluir cliente no Firestore:', e)
    );
  };

  // ── Handlers: Vendedores ──────────────────────────────────────────────────
  const handleAddSeller = async (seller: Seller) => {
    setSellers((prev) => [seller, ...prev]);
    await saveVendedor(seller).catch((e) =>
      console.error('Erro ao salvar vendedor no Firestore:', e)
    );
  };

  const handleUpdateSeller = async (id: string, sellerData: Partial<Seller>) => {
    const oldSeller = sellers.find((s) => s.id === id);
    if (!oldSeller) return;

    // 1. Atualiza estado local de vendedores
    setSellers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...sellerData } : s))
    );

    try {
      // 2. Atualiza o vendedor no Firestore
      await updateVendedor(id, sellerData);

      // 3. Se alterou o nome ou código, cascateia para clientes e títulos inadimplentes
      const nameChanged = sellerData.name !== undefined && sellerData.name !== oldSeller.name;
      const codeChanged = sellerData.code !== undefined && sellerData.code !== oldSeller.code;

      if (nameChanged || codeChanged) {
        const newName = sellerData.name || oldSeller.name;
        const newCode = sellerData.code || oldSeller.code;

        // Cascatear Clientes (vendedor_responsavel)
        if (nameChanged) {
          const customersToUpdate = customers.filter(
            (c) => c.sellerResponsible === oldSeller.name
          );

          if (customersToUpdate.length > 0) {
            setCustomers((prev) =>
              prev.map((c) =>
                c.sellerResponsible === oldSeller.name
                  ? { ...c, sellerResponsible: newName }
                  : c
              )
            );

            for (const c of customersToUpdate) {
              await updateCliente(c.id, { sellerResponsible: newName }).catch((err) =>
                console.error(`Erro ao atualizar vendedor responsável para cliente ${c.id}:`, err)
              );
            }
          }
        }

        // Cascatear Títulos Inadimplentes (sellerName, sellerCode, sellerId)
        const titlesToUpdate = delinquentTitles.filter(
          (t) =>
            t.sellerId === id ||
            (oldSeller.code && t.sellerCode && t.sellerCode.toLowerCase() === oldSeller.code.toLowerCase()) ||
            (oldSeller.name && t.sellerName && t.sellerName.toLowerCase() === oldSeller.name.toLowerCase())
        );

        if (titlesToUpdate.length > 0) {
          setDelinquentTitles((prev) =>
            prev.map((t) => {
              const matchesId = t.sellerId === id;
              const matchesCode = oldSeller.code && t.sellerCode && t.sellerCode.toLowerCase() === oldSeller.code.toLowerCase();
              const matchesName = oldSeller.name && t.sellerName && t.sellerName.toLowerCase() === oldSeller.name.toLowerCase();

              if (matchesId || matchesCode || matchesName) {
                return {
                  ...t,
                  sellerId: id,
                  sellerName: newName,
                  sellerCode: newCode,
                };
              }
              return t;
            })
          );

          for (const t of titlesToUpdate) {
            await updateTitulo(t.id, {
              sellerId: id,
              sellerName: newName,
              sellerCode: newCode,
            }).catch((err) =>
              console.error(`Erro ao atualizar vendedor para o título ${t.id}:`, err)
            );
          }
        }
      }
    } catch (e) {
      console.error('Erro ao atualizar vendedor no Firestore:', e);
      // Reverte estado local de vendedores em caso de erro
      setSellers(sellers);
    }
  };

  const handleDeleteSeller = async (id: string) => {
    setSellers((prev) => prev.filter((s) => s.id !== id));
    await deleteVendedor(id).catch((e) =>
      console.error('Erro ao excluir vendedor no Firestore:', e)
    );
  };

  // ── Handler: Zerar Inadimplência ──────────────────────────────────────────
  const handleClearDelinquency = async () => {
    setDelinquentTitles([]);
    await clearInadimplencia().catch((e) =>
      console.error('Erro ao zerar títulos no Firestore:', e)
    );
  };

  // ── Extrato Financeiro: recálculo do Resultado Financeiro ─────────────────
  // Recalcula, a partir do conjunto completo de lançamentos de extrato de um
  // ano, as Entradas de Bancos e Entradas de Tesouraria de cada mês, e persiste
  // no Firestore (resultado_financeiro). É recomputado do zero (não somado ao
  // valor anterior) para que o extrato seja sempre a fonte única da verdade e
  // reimportações/exclusões nunca dupliquem ou deixem valores "presos".
  const recomputeFinancialFromStatement = async (
    year: number,
    entriesForYear: FinancialStatementEntry[],
    currentFinancial: Record<string, FinancialMonthData>
  ) => {
    const monthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    const bancosPorMes = new Map<string, number>();
    const tesourariaPorMes = new Map<string, number>();
    entriesForYear.forEach((e) => {
      if (!e.monthKey) return;
      // TRANSFERÊNCIA INTERNA NÃO É ENTRADA.
      // No RFN019 do Caixa 30108, 797 lançamentos (R$ 1,2 mi) são dinheiro
      // vindo da própria tesouraria — a empresa passando dinheiro de um bolso
      // para o outro. Somar isso como recebimento inventa caixa: só em 2026
      // seriam R$ 42.543,77 de entrada que nenhum cliente pagou. O lançamento
      // fica gravado para a conciliação fechar com o saldo da conta, mas é
      // excluído aqui do cálculo de entradas.
      if (e.isInternalTransfer) return;
      if (e.origin === 'banco') {
        bancosPorMes.set(e.monthKey, (bancosPorMes.get(e.monthKey) || 0) + e.entryAmount);
      } else {
        tesourariaPorMes.set(e.monthKey, (tesourariaPorMes.get(e.monthKey) || 0) + e.entryAmount);
      }
    });

    const updatedFinancial: Record<string, FinancialMonthData> = { ...currentFinancial };
    let acc = 0;

    for (const m of monthKeys) {
      const current: FinancialMonthData = updatedFinancial[m] || {
        monthKey: m,
        monthLabel: `${m}/${year}`,
        entradasBancos: 0,
        entradasTesouraria: 0,
        totalEntradas: 0,
        totalSaidas: 0,
        resultadoFinanceiro: 0,
        resultadoPercent: 0,
        estoque: 0,
        inadimplenciaMensal: 0,
        inadimplenciaAcumulada: 0,
      };

      const entradasBancos = Math.round((bancosPorMes.get(m) || 0) * 100) / 100;
      const entradasTesouraria = Math.round((tesourariaPorMes.get(m) || 0) * 100) / 100;
      const totalEntradas = entradasBancos + entradasTesouraria;
      const totalSaidas = current.totalSaidas || 0;
      const resultadoFinanceiro = totalEntradas - totalSaidas;
      const resultadoPercent = totalEntradas > 0 ? (resultadoFinanceiro / totalEntradas) * 100 : 0;
      acc += current.inadimplenciaMensal || 0;

      const updatedMonth: FinancialMonthData = {
        ...current,
        entradasBancos,
        entradasTesouraria,
        totalEntradas,
        totalSaidas,
        resultadoFinanceiro,
        resultadoPercent: Math.round(resultadoPercent * 100) / 100,
        inadimplenciaAcumulada: Math.round(acc * 100) / 100,
      };

      updatedFinancial[m] = updatedMonth;
      await saveFinancialMonth(year, m, updatedMonth).catch((e) =>
        console.error(`Erro ao salvar financeiro (${m}) a partir do extrato:`, e)
      );
    }

    setFinancialData(updatedFinancial);
  };

  // ── Handler: Importação de Extrato Financeiro (UPSERT) ─────────────────────
  const handleCommitStatementImport = async (entries: Omit<FinancialStatementEntry, 'id'>[]) => {
    if (entries.length === 0) return;
    try {
      const result = await upsertExtratoFinanceiro(entries);
      console.log(`Extrato importado: ${result.added} novo(s), ${result.updated} atualizado(s).`);
      const [fresh, all] = await Promise.all([
        getExtratoFinanceiro(selectedYear),
        getExtratoFinanceiro(),
      ]);
      setStatementEntries(fresh);
      // Mantém o extrato completo em dia: é ele que a conciliação de Contas a
      // Pagar varre. Sem este refresh, o lançamento recém-importado só entraria
      // na conciliação depois de trocar de ano ou recarregar a página.
      setAllStatementEntries(all);
      await recomputeFinancialFromStatement(selectedYear, fresh, financialData);
    } catch (err: any) {
      console.error('Erro ao importar extrato financeiro:', err?.message || err);
    }
  };

  const handleDeleteStatementEntry = async (id: string) => {
    try {
      await deleteExtratoFinanceiro(id);
      const [fresh, all] = await Promise.all([
        getExtratoFinanceiro(selectedYear),
        getExtratoFinanceiro(),
      ]);
      setStatementEntries(fresh);
      // Mantém o extrato completo em dia: é ele que a conciliação de Contas a
      // Pagar varre. Sem este refresh, o lançamento recém-importado só entraria
      // na conciliação depois de trocar de ano ou recarregar a página.
      setAllStatementEntries(all);
      await recomputeFinancialFromStatement(selectedYear, fresh, financialData);
    } catch (e) {
      console.error('Erro ao excluir lançamento do extrato:', e);
    }
  };

  const handleClearStatementEntries = async (source?: StatementSource) => {
    try {
      await clearExtratoFinanceiro(selectedYear, source);
      const [fresh, all] = await Promise.all([
        getExtratoFinanceiro(selectedYear),
        getExtratoFinanceiro(),
      ]);
      setStatementEntries(fresh);
      // Mantém o extrato completo em dia: é ele que a conciliação de Contas a
      // Pagar varre. Sem este refresh, o lançamento recém-importado só entraria
      // na conciliação depois de trocar de ano ou recarregar a página.
      setAllStatementEntries(all);
      await recomputeFinancialFromStatement(selectedYear, fresh, financialData);
    } catch (e) {
      console.error('Erro ao zerar extrato financeiro:', e);
    }
  };

  // ── Títulos Financeiros (RFN046) — Contas a Receber e Contas a Pagar ─────
  //
  // Um handler serve os dois lados. `movType` diz em qual coleção mexer; o
  // resto da regra é idêntica, porque a fonte é o mesmo relatório. Handlers
  // separados por lado foi exatamente o que fez a base antiga de pagar e a de
  // previsão divergirem: a mesma correção precisava ser aplicada duas vezes.

  const setTitulosState = (movType: TituloMovType, titulos: TituloFinanceiro[]) => {
    if (movType === 'R') setReceivables(titulos);
    else setPayables(titulos);
  };

  /** Relê a base de um lado (recorte do ano para a tela) e atualiza o estado. */
  const refreshTitulos = useCallback(async (movType: TituloMovType, year: number) => {
    const fresh = await fetchTitulos(movType, year);
    setTitulosState(movType, fresh);
    return fresh;
  }, []);

  /**
   * Importa os títulos e, logo em seguida, tenta a baixa automática.
   *
   * A conciliação roda DEPOIS da gravação e contra a base completa (todos os
   * anos), não contra o que acabou de subir: um título importado hoje pode
   * casar com um lançamento de extrato que está no banco há três meses.
   */
  const handleImportTitulos = async (movType: TituloMovType, rows: TituloFinanceiro[]) => {
    if (rows.length === 0) return;

    // Vínculo com o cadastro pelo cod_cliente — feito aqui e não na tela para
    // valer também em importações automatizadas futuras (API, agendamento).
    const byCode = buildCustomerIndex(customers);
    const comVinculo = rows.map((r) => {
      const c = byCode.get(normalizePersonCode(r.personCode));
      return c ? { ...r, customerId: c.id } : r;
    });

    const result = await upsertTitulosFinanceiros(comVinculo);

    // Conciliação imediata: base completa dos dois lados.
    const [todos, extrato] = await Promise.all([fetchTitulos(movType), getExtratoFinanceiro()]);
    setAllStatementEntries(extrato);

    const rec = reconcile(todos, extrato, reconSettings);
    if (rec.auto.length > 0) await aplicarBaixaTitulos(movType, rec.auto, 'Baixado Automático');
    if (rec.suggestions.length > 0) await marcarTitulosParaConferencia(movType, rec.suggestions);

    await refreshTitulos(movType, selectedYear);

    const label = movType === 'R' ? 'Contas a Receber' : 'Contas a Pagar';
    alert(
      `Importação de ${label} concluída.\n\n` +
        `• ${result.created} título(s) NOVO(S)\n` +
        `• ${result.updated} título(s) atualizado(s) (sem duplicar)\n` +
        (result.errors > 0 ? `• ${result.errors} linha(s) com erro de gravação\n` : '') +
        `• ${comVinculo.filter((t) => t.customerId).length} vinculado(s) ao cadastro de clientes\n` +
        (rec.auto.length > 0 ? `• ${rec.auto.length} baixa(s) automática(s) contra o extrato\n` : '') +
        (rec.suggestions.length > 0 ? `• ${rec.suggestions.length} sugestão(ões) marcada(s) para conferência\n` : '')
    );
  };

  const handleApplyMatches = async (
    movType: TituloMovType,
    matches: ReconciliationMatch[],
    status: BaixaStatus
  ) => {
    if (matches.length === 0) return;
    if (status === 'Conferir') await marcarTitulosParaConferencia(movType, matches);
    else await aplicarBaixaTitulos(movType, matches, status);
    await refreshTitulos(movType, selectedYear);
  };

  /** Código legível da baixa: RC-2026-00001 (receber) / BX-2026-00001 (pagar). */
  const gerarBaixaCode = (movType: TituloMovType, lista: TituloFinanceiro[]): string => {
    const prefix = `${movType === 'R' ? 'RC' : 'BX'}-${new Date().getFullYear()}-`;
    const seqs = lista
      .filter((x) => x.baixaCode && x.baixaCode.startsWith(prefix))
      .map((x) => parseInt(x.baixaCode!.replace(prefix, ''), 10))
      .filter((n) => !isNaN(n));
    return `${prefix}${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(5, '0')}`;
  };

  const handleManualBaixaTitulo = async (
    movType: TituloMovType,
    id: string,
    statementId?: string,
    source?: string,
    paidAmount?: number
  ) => {
    const lista = movType === 'R' ? receivables : payables;
    const now = new Date().toISOString();
    const dt = new Date(now);
    const paidYear = dt.getFullYear();
    const ALL_MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const paidMonthKey = ALL_MONTH_KEYS[dt.getMonth()];
    const baixaCode = gerarBaixaCode(movType, lista);

    const existing = lista.find((x) => x.id === id);
    const finalPaidAmount = paidAmount !== undefined ? paidAmount : (existing?.paidAmount || existing?.amount || 0);

    await atualizarTitulo(movType, id, {
      status: 'Baixado Manual',
      reconciledAt: now,
      baixaCode,
      reconciledStatementId: statementId || '',
      reconciledSource: source || '',
      isPaid: true,
      paymentDate: now,
      paidYear,
      paidMonthKey,
      paidAmount: finalPaidAmount,
    });

    setTitulosState(
      movType,
      lista.map((x) =>
        x.id === id
          ? {
              ...x,
              status: 'Baixado Manual' as BaixaStatus,
              isPaid: true,
              paymentDate: now,
              paidYear,
              paidMonthKey,
              reconciledAt: now,
              baixaCode,
              reconciledStatementId: statementId || x.reconciledStatementId,
              reconciledSource: source || x.reconciledSource,
              paidAmount: finalPaidAmount,
            }
          : x
      )
    );
  };

  const handleRevertBaixaTitulo = async (movType: TituloMovType, id: string) => {
    const lista = movType === 'R' ? receivables : payables;
    await atualizarTitulo(movType, id, {
      status: 'Em Aberto',
      reconciledStatementId: '',
      reconciledSource: '',
      reconciledAt: '',
      matchScore: 0,
      matchReason: '',
      isPaid: false,
    });
    setTitulosState(
      movType,
      lista.map((x) =>
        x.id === id
          ? {
              ...x,
              status: 'Em Aberto' as BaixaStatus,
              isPaid: false,
              reconciledStatementId: '',
              reconciledSource: '',
              reconciledAt: '',
            }
          : x
      )
    );
  };

  /**
   * Aponta de qual conta saiu (ou entrou) o dinheiro do título.
   *
   * `accountKey` vazio LIMPA a escolha e devolve o título à conta inferida pela
   * baixa — é o caminho de volta de quem clicou na conta errada. Por isso os
   * campos são gravados como string vazia em vez de omitidos: com `merge: true`,
   * campo omitido mantém o valor antigo, e a correção não teria efeito.
   */
  const handleSetTituloOrigin = async (
    movType: TituloMovType,
    id: string,
    accountKey: string,
    accountLabel: string
  ) => {
    const lista = movType === 'R' ? receivables : payables;
    const now = new Date().toISOString();
    const patch = {
      originAccountKey: accountKey,
      originAccountLabel: accountKey ? accountLabel : '',
      originSetAt: accountKey ? now : '',
      originSetByName: accountKey ? currentUser.name : '',
    };
    await atualizarTitulo(movType, id, patch);
    setTitulosState(movType, lista.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const handleDeleteTitulo = async (movType: TituloMovType, id: string) => {
    await excluirTitulo(movType, id);
    const lista = movType === 'R' ? receivables : payables;
    setTitulosState(movType, lista.filter((x) => x.id !== id));
  };

  const handleClearTitulos = async (movType: TituloMovType) => {
    await zerarTitulos(movType);
    setTitulosState(movType, []);
  };

  /** Parâmetros da baixa automática — ficam no navegador do gestor. */
  const handleSaveReconSettings = (s: ReconciliationSettings) => {
    setReconSettings(s);
    try {
      localStorage.setItem('pdk_recon_settings', JSON.stringify(s));
    } catch {
      /* modo privado bloqueia storage — perder a preferência não é motivo de erro */
    }
  };

  /**
   * Salvar plano de Fluxo de Caixa.
   *
   * Guarda o plano DEVOLVIDO pelo serviço, não o que foi enviado: o serviço
   * normaliza (todas as semanas com todos os campos) e carimba `updatedAt`. É
   * esse carimbo que a tela usa para saber se o que está em memória já é o que
   * está no banco — sem ele, o rascunho apareceria como "não salvo" logo depois
   * de salvar.
   *
   * Upsert em posição fixa. A versão anterior fazia `[...others, plan]`, que
   * empurrava o mês salvo para o fim do array; como a tela procura o plano por
   * `find`, cada gravação trocava a identidade do objeto e disparava o efeito
   * de sincronização — que por sua vez sobrescrevia o rascunho em edição.
   */
  const handleSaveCashFlowPlan = async (plan: CashFlowPlan): Promise<CashFlowPlan> => {
    const saved = await saveFluxoCaixa(plan);
    setCashFlowPlans((prev) => {
      const idx = prev.findIndex((p) => p.monthKey === saved.monthKey && p.year === saved.year);
      if (idx === -1) return [...prev, saved];
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
    return saved;
  };

  // ── Handler: Gerar Token API ──────────────────────────────────────────────
  const handleGenerateApiToken = async (name: string) => {
    try {
      const newToken = await createApiToken(name);
      setApiTokens((prev) => [newToken, ...prev]);
    } catch (err: any) {
      console.error('Erro ao criar token API:', err.message);
      // Fallback local
      const fallbackToken: ApiToken = {
        id: `tok_${Date.now()}`,
        name,
        token: `pdg_live_${Math.random().toString(36).substring(2, 18)}`,
        createdAt: new Date().toISOString(),
        status: 'active',
      };
      setApiTokens((prev) => [fallbackToken, ...prev]);
    }
  };

  // ── Handler: Teste de Conexão (apenas visual no modo Firebase) ────────────
  const handleTestPostgresConnection = (_cfg: Partial<PostgresConfig>) => {
    // No modo Firebase, apenas mostra status
  };

  // ── Render ────────────────────────────────────────────────────────────────
  // Sem usuário autenticado, nada do sistema é renderizado — apenas a tela de
  // login. Isso impede que dados financeiros apareçam para quem não entrou.
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#F3F1ED] text-[#2D2A26] flex flex-col items-center justify-center font-sans p-4">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-lg bg-[#2D2A26] flex items-center justify-center text-[#C19A6B] font-black text-lg shadow-xs">
            PD
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">
              PARIS DAKAR <span className="text-[#C19A6B]">GERENCIAL</span>
            </h1>
            <p className="text-xs text-[#8B7D6B]">Controle Financeiro &amp; Econômico DRE</p>
          </div>
        </div>

        <LoginModal
          isOpen
          dismissible={false}
          onClose={() => {
            /* Login é obrigatório: não há para onde fechar. */
          }}
          onLoginSuccess={handleLoginSuccess}
          onGoogleLogin={handleGoogleLogin}
          loginError={loginError}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F1ED] text-[#2D2A26] flex flex-col font-sans selection:bg-[#C19A6B] selection:text-white">
      {/* Barra de carregamento global */}
      {isLoading && (
        <div className="fixed top-0 left-0 right-0 z-[100] h-0.5 bg-[#C19A6B]/20">
          <div className="h-full bg-[#C19A6B] animate-pulse w-full" />
        </div>
      )}

      {/* Top Bar Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        yearsWithData={yearsWithData}
        currentUser={currentUser}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onOpenLaunchModal={() => setIsLaunchModalOpen(true)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/*
        Layout: a rolagem acontece na JANELA, não em um contêiner interno. É o
        que permite a lateral ficar realmente fixa (`sticky top-16`) enquanto a
        tabela do meio rola. Com `overflow-hidden` no pai, como era antes, o
        `sticky` não tem efeito e o menu subia junto com o conteúdo.
        `min-w-0` no <main> impede que uma tabela larga empurre a lateral.
      */}
      <div className="flex-1 flex items-start">
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          userRole={currentUser.role}
        />

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6">
          <ErrorBoundary key={activeTab}>
            <Suspense fallback={<ViewSkeleton />}>
          {activeTab === 'dashboard' && (
            <DashboardView
              economicMonths={economicData}
              financialMonths={financialData}
              customers={customers}
              delinquentTitles={delinquentTitles}
              billingSummaries={billingSummaries}
              payables={payables}
              statementEntries={statementEntries}
              selectedYear={selectedYear}
              setActiveTab={setActiveTab}
            />
          )}

          {activeTab === 'economic' && (
            <EconomicView
              economicMonths={economicData}
              selectedYear={selectedYear}
              onOpenLaunchModal={() => setIsLaunchModalOpen(true)}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'financial' && (
            <FinancialView
              financialMonths={financialData}
              selectedYear={selectedYear}
              onOpenLaunchModal={() => setIsLaunchModalOpen(true)}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'statement' && (
            <FinancialStatementView
              entries={statementEntries}
              selectedYear={selectedYear}
              onCommitEntries={handleCommitStatementImport}
              onDeleteEntry={handleDeleteStatementEntry}
              onClearEntries={handleClearStatementEntries}
              userRole={currentUser.role}
              /* Só para o extrato mostrar quais lançamentos já foram usados numa
                 baixa (Contas a Receber/Pagar do mesmo exercício) — a baixa em
                 si continua vivendo só no título, isto é apenas leitura. */
              receivables={receivables}
              payables={payables}
            />
          )}

          {(activeTab === 'receivables' || activeTab === 'payables') && (
            /*
             * A MESMA tela para os dois lados. `key` força o React a remontar ao
             * trocar de módulo: sem isso, os filtros e a prévia de importação do
             * Contas a Receber apareceriam abertos no Contas a Pagar.
             *
             * `statementEntries` vai COMPLETO (todos os anos) de propósito: a
             * conciliação precisa achar o crédito de 03/01 que quitou o título
             * de 30/12 — com o recorte anual esse par nunca é encontrado.
             */
            <TitulosWorkspace
              key={activeTab}
              movType={activeTab === 'receivables' ? 'R' : 'P'}
              titulos={activeTab === 'receivables' ? receivables : payables}
              statementEntries={allStatementEntries}
              customers={customers}
              selectedYear={selectedYear}
              settings={reconSettings}
              onSaveSettings={handleSaveReconSettings}
              onImport={(rows) => handleImportTitulos(activeTab === 'receivables' ? 'R' : 'P', rows)}
              onApplyMatches={(matches, status) =>
                handleApplyMatches(activeTab === 'receivables' ? 'R' : 'P', matches, status)
              }
              onManualBaixa={(id, sid, src, pAmt) =>
                handleManualBaixaTitulo(activeTab === 'receivables' ? 'R' : 'P', id, sid, src, pAmt)
              }
              onSetOrigin={(id, accountKey, accountLabel) =>
                handleSetTituloOrigin(activeTab === 'receivables' ? 'R' : 'P', id, accountKey, accountLabel)
              }
              onRevertBaixa={(id) => handleRevertBaixaTitulo(activeTab === 'receivables' ? 'R' : 'P', id)}
              onDelete={(id) => handleDeleteTitulo(activeTab === 'receivables' ? 'R' : 'P', id)}
              onClear={() => handleClearTitulos(activeTab === 'receivables' ? 'R' : 'P')}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'daily' && (
            /*
             * Movimento Diário lê os MESMOS states já carregados por
             * `loadYearData` — não abre consulta própria no Firestore. A tela é
             * derivada por inteiro de `receivables` + `payables`, então baixar
             * um título em Contas a Pagar já reflete aqui na próxima carga, sem
             * segunda fonte de verdade para sair de sincronia.
             *
             * Ressalva conhecida: os títulos vêm filtrados por ANO DE
             * VENCIMENTO (campo `ano`). Um título vencido em 30/12/2025 e pago
             * em 03/01/2026 mora na base de 2025 — para vê-lo, troque o
             * exercício no topo. É a mesma régua das demais telas do sistema.
             */
            <DailyMovementView
              receivables={receivables}
              payables={payables}
              selectedYear={selectedYear}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'cashflow' && (
            <CashFlowView
              plans={cashFlowPlans}
              statementEntries={statementEntries}
              receivables={receivables}
              payables={payables}
              selectedYear={selectedYear}
              onSavePlan={handleSaveCashFlowPlan}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'billing' && (
            <BillingView
              summaries={billingSummaries}
              billingCustomers={billingCustomers}
              customers={customers}
              delinquentTitles={delinquentTitles}
              selectedYear={selectedYear}
              isLoading={isBillingLoading}
              onImportInvoices={handleImportInvoices}
              onLoadYearDetail={handleLoadInvoiceDetail}
              onReload={() => loadBilling(true)}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'stock' && (
            <StockView
              items={stockItems}
              summary={stockSummary}
              isLoading={isStockLoading}
              onImportStock={handleImportStock}
              onReload={() => loadStock(true)}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'sales' && (
            <SalesView
              items={saleItems}
              stockItems={stockItems}
              customers={customers}
              sellers={sellers}
              delinquentTitles={delinquentTitles}
              availableYears={salesYears.filter((y) => !loadedSalesYears.includes(y))}
              selectedYear={selectedYear}
              isLoading={isSalesLoading}
              onImportSales={handleImportSales}
              onSyncSellers={handleSyncSellersFromSales}
              onReload={() => loadSales(true)}
              onLoadYear={handleLoadSalesYear}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'tasks' && (
            <TaskManagerView
              onNavigateToModule={(tab) => setActiveTab(tab)}
              onNavigateToImport={(mod) => {
                setImportTargetModule(mod);
                setActiveTab('import');
              }}
              userRole={currentUser.role}
              userName={currentUser.name}
            />
          )}

          {activeTab === 'import' && (
            <ImportDataView
              onCommitImport={handleCommitImport}
              onCommitDelinquencyImport={handleCommitDelinquencyImport}
              onCommitSalesImport={async (rows) => {
                await handleImportSales(rows);
                await handleSyncSellersFromSales(rows);
              }}
              selectedYear={selectedYear}
              initialModule={importTargetModule}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'customers' && (
            <CustomerManagementView
              customers={customers}
              delinquentTitles={delinquentTitles}
              onAddCustomer={handleAddCustomer}
              onUpdateCustomer={handleUpdateCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              userRole={currentUser.role}
              onNavigateToImport={() => {
                setImportTargetModule('customers');
                setActiveTab('import');
              }}
            />
          )}

          {activeTab === 'sellers' && (
            <SellersManagementView
              sellers={sellers}
              delinquentTitles={delinquentTitles}
              customers={customers}
              onAddSeller={handleAddSeller}
              onUpdateSeller={handleUpdateSeller}
              onDeleteSeller={handleDeleteSeller}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'delinquency' && (
            <DelinquencyReportView
              titles={delinquentTitles}
              customers={customers}
              selectedYear={selectedYear}
              onClearDelinquency={handleClearDelinquency}
              onAddTitle={handleAddTitle}
              onUpdateTitle={handleUpdateTitle}
              onDeleteTitle={handleDeleteTitle}
              userRole={currentUser.role}
              agreements={agreements}
              onSaveAgreement={handleSaveAgreement}
              onDeleteAgreement={handleDeleteAgreement}
              currentUserName={currentUser.name || currentUser.email || ''}
              onNavigateToImport={() => {
                setImportTargetModule('delinquency');
                setActiveTab('import');
              }}
            />
          )}

          {activeTab === 'api-docs' && (
            <ApiIntegrationDocsView apiTokens={apiTokens} onGenerateToken={handleGenerateApiToken} />
          )}

          {activeTab === 'postgres-settings' && (
            <PostgresSettingsView
              dbConfig={postgresConfig}
              onTestConnection={handleTestPostgresConnection}
            />
          )}

          {activeTab === 'users' && (
            <UserManagementView currentUser={currentUser} />
          )}
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Modais */}
      <LaunchModal
        isOpen={isLaunchModalOpen}
        onClose={() => setIsLaunchModalOpen(false)}
        selectedYear={selectedYear}
        onSaveLaunch={handleSaveLaunch}
      />

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        onGoogleLogin={handleGoogleLogin}
        loginError={loginError}
      />

      {/* PWA — Banner de Instalação */}
      <PwaInstallBanner />
    </div>
  );
}
