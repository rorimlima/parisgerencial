/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — Paris Dakar Gerencial
 * Todos os dados vêm do Firestore (Firebase). Sem dados hardcoded.
 */

import React, { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { DashboardView } from './components/DashboardView';
import { LaunchModal } from './components/LaunchModal';
import { LoginModal } from './components/LoginModal';
import { Navbar } from './components/Navbar';
import { PwaInstallBanner } from './components/PwaBanners';
import { Sidebar } from './components/Sidebar';
import type { RawPayableRow } from './components/PayablesView';

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
const PayablesView = lazy(() => import('./components/PayablesView').then((m) => ({ default: m.PayablesView })));
const CashFlowView = lazy(() => import('./components/CashFlowView').then((m) => ({ default: m.CashFlowView })));
const BillingView = lazy(() => import('./components/BillingView').then((m) => ({ default: m.BillingView })));
const StockView = lazy(() => import('./components/StockView').then((m) => ({ default: m.StockView })));
const SalesView = lazy(() => import('./components/SalesView').then((m) => ({ default: m.SalesView })));

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
  getContasPagar,
  upsertContasPagar,
  updateContaPagar,
  applyBaixaAutomatica,
  deleteContaPagar,
  clearContasPagar,
  getFluxoCaixa,
  saveFluxoCaixa,
} from './firebaseService';

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
  DelinquencyValidationRowResult,
  EconomicMonthData,
  FinancialMonthData,
  FinancialStatementEntry,
  InvoiceRecord,
  PayableTitle,
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
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [statementEntries, setStatementEntries] = useState<FinancialStatementEntry[]>([]);
  const [payables, setPayables] = useState<PayableTitle[]>([]);
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
      const [cliData, titData, vendData, tokData] = await Promise.all([
        getClientes(),
        getTitulosInadimplentes(),
        getVendedores(),
        getApiTokens(),
      ]);
      setCustomers(cliData);
      setDelinquentTitles(titData);
      setSellers(vendData);
      setApiTokens(tokData);
    } catch (err: any) {
      console.error('Erro ao carregar dados mestre do Firestore:', err.message);
    }
  }, []);

  // ── Dados do ano selecionado (já filtrados por "ano" no Firestore) ────────
  const loadYearData = useCallback(async (year: number) => {
    setIsLoading(true);
    try {
      const [ecoData, finData, stmtData, payData, cashData] = await Promise.all([
        getEconomicData(year),
        getFinancialData(year),
        getExtratoFinanceiro(year),
        getContasPagar(year),
        getFluxoCaixa(year),
      ]);
      setEconomicData(ecoData);
      setFinancialData(finData);
      setStatementEntries(stmtData);
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
  const loadBilling = useCallback(async (force = false) => {
    if (isBillingLoading || (billingLoaded && !force)) return;
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

  const loadStock = useCallback(async (force = false) => {
    if (isStockLoading || (stockLoaded && !force)) return;
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
    if (isSalesLoading || (salesLoaded && !force)) return;
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
    if (activeTab === 'billing') loadBilling();
    if (activeTab === 'stock') loadStock();
    // Vendas depende do Estoque e dos Clientes para os vínculos; o Estoque é
    // carregado junto para que a coluna "custo atual" não apareça vazia na
    // primeira abertura da aba.
    if (activeTab === 'sales') { loadSales(); loadStock(); }
  }, [activeTab, currentUser, loadBilling, loadStock, loadSales]);

  // ── Handler: importação do RPR014 (Faturamento) ──────────────────────────
  const handleImportInvoices = useCallback(async (records: InvoiceRecord[]) => {
    const result = await upsertInvoicesBatch(records);
    console.info(
      `[Faturamento] ${result.added} novos, ${result.updated} atualizados, ` +
      `${result.unchanged} sem alteração, ${result.errors} erros.`
    );
    await loadBilling(true);
  }, [loadBilling]);

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
      const fresh = await getExtratoFinanceiro(selectedYear);
      setStatementEntries(fresh);
      await recomputeFinancialFromStatement(selectedYear, fresh, financialData);
    } catch (err: any) {
      console.error('Erro ao importar extrato financeiro:', err?.message || err);
    }
  };

  const handleDeleteStatementEntry = async (id: string) => {
    try {
      await deleteExtratoFinanceiro(id);
      const fresh = await getExtratoFinanceiro(selectedYear);
      setStatementEntries(fresh);
      await recomputeFinancialFromStatement(selectedYear, fresh, financialData);
    } catch (e) {
      console.error('Erro ao excluir lançamento do extrato:', e);
    }
  };

  const handleClearStatementEntries = async (source?: StatementSource) => {
    try {
      await clearExtratoFinanceiro(selectedYear, source);
      const fresh = await getExtratoFinanceiro(selectedYear);
      setStatementEntries(fresh);
      await recomputeFinancialFromStatement(selectedYear, fresh, financialData);
    } catch (e) {
      console.error('Erro ao zerar extrato financeiro:', e);
    }
  };

  // ── Contas a Pagar (RFN006) ──────────────────────────────────────────────
  const monthKeyFromIso = (dateStr: string): string => {
    if (!dateStr) return '';
    const monthKeys = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const mStr = dateStr.includes('-')
      ? dateStr.split('-')[1]
      : dateStr.includes('/')
      ? dateStr.split('/')[1]
      : '';
    const m = parseInt(mStr, 10);
    return monthKeys[m - 1] || '';
  };

  // Concilia (baixa automática) títulos "Em Aberto" contra lançamentos de saída
  // do Extrato Financeiro (banco + caixa/tesouraria) ainda não utilizados em
  // nenhuma outra baixa. Critério: mesmo valor (tolerância de R$0,01) e data de
  // pagamento dentro de uma janela de ±5 dias da data do lançamento no extrato
  // (cobre o intervalo típico entre o registro no ERP e a compensação bancária).
  // Casamento é 1-para-1 (guloso, por menor diferença de dias) para nunca
  // vincular o mesmo lançamento de extrato a dois títulos diferentes.
  const computeAutoReconciliation = (
    payablesList: PayableTitle[],
    entriesList: FinancialStatementEntry[]
  ): { id: string; statementId: string; source: string; notes?: string }[] => {
    // Janela ampliada para 15 dias para encontrar o máximo de correspondências automáticas
    const DATE_WINDOW_DAYS = 15;
    // Tolerância em centavos evita problemas de arredondamento de ponto flutuante
    const AMOUNT_TOLERANCE_CENTS = 1;

    const openPayables = payablesList.filter((p) => p.status === 'Em Aberto');
    const usedStatementIds = new Set(payablesList.filter((p) => p.reconciledStatementId).map((p) => p.reconciledStatementId));
    const availableExits = entriesList.filter((e) => e.exitAmount > 0 && !usedStatementIds.has(e.id));

    const toTime = (iso: string) => {
      if (!iso) return NaN;
      // Garante conversão sem efeito de fuso horário
      return new Date(iso.slice(0, 10) + 'T00:00:00').getTime();
    };

    // Agrupa os lançamentos de saída disponíveis por valor (em centavos), permitindo
    // que cada título busque apenas candidatos com o mesmo valor em vez de varrer
    // toda a lista de lançamentos — troca O(títulos × lançamentos) por ~O(títulos +
    // lançamentos), essencial para bases com milhares de registros (RFN006 tem
    // ~6 mil linhas) responderem em milissegundos em vez de segundos/minutos.
    const exitsByAmountCents = new Map<number, FinancialStatementEntry[]>();
    for (const e of availableExits) {
      const cents = Math.round(e.exitAmount * 100);
      const bucket = exitsByAmountCents.get(cents);
      if (bucket) bucket.push(e);
      else exitsByAmountCents.set(cents, [e]);
    }

    const candidates: { payableId: string; entryId: string; sourceLabel: string; diffDays: number; notes: string }[] = [];
    for (const p of openPayables) {
      const pTime = toTime(p.paymentDate);
      if (isNaN(pTime)) continue;

      const pCents = Math.round(p.amount * 100);
      // Considera o valor exato e uma pequena tolerância de arredondamento (±1 centavo)
      for (let delta = -AMOUNT_TOLERANCE_CENTS; delta <= AMOUNT_TOLERANCE_CENTS; delta++) {
        const bucket = exitsByAmountCents.get(pCents + delta);
        if (!bucket) continue;
        for (const e of bucket) {
          const eTime = toTime(e.date);
          if (isNaN(eTime)) continue;
          const diffDays = Math.abs(pTime - eTime) / (1000 * 60 * 60 * 24);
          if (diffDays > DATE_WINDOW_DAYS) continue;

          // Se houver texto contendo borderô, capturamos para justificar a baixa
          let notes = '';
          const desc = (p.description || '').trim();
          if (desc.toLowerCase().includes('borderô') || desc.toLowerCase().includes('bordero')) {
            notes = desc;
          } else {
            notes = `Baixa automática com base em lançamento de ${e.sourceLabel}`;
          }

          candidates.push({ payableId: p.id, entryId: e.id, sourceLabel: e.sourceLabel, diffDays, notes });
        }
      }
    }
    candidates.sort((a, b) => a.diffDays - b.diffDays);

    const matchedPayables = new Set<string>();
    const matchedEntries = new Set<string>();
    const results: { id: string; statementId: string; source: string; notes?: string }[] = [];
    for (const c of candidates) {
      if (matchedPayables.has(c.payableId) || matchedEntries.has(c.entryId)) continue;
      matchedPayables.add(c.payableId);
      matchedEntries.add(c.entryId);
      results.push({ id: c.payableId, statementId: c.entryId, source: c.sourceLabel, notes: c.notes });
    }
    return results;
  };

  const handleImportPayables = async (rows: RawPayableRow[]) => {
    if (rows.length === 0) return;

    const toSave = rows.map((r) => {
      const matched = customers.find(
        (c) => c.code && c.code.toLowerCase() === r.supplierCode.toLowerCase()
      );
      
      const desc = r.description || '';
      const isBorderou = desc.toLowerCase().includes('originado pelo borderô') || desc.toLowerCase().includes('originado pelo bordero');
      const status = (isBorderou ? 'Baixado Manual' : 'Em Aberto') as PayableTitle['status'];
      const notes = isBorderou ? desc : '';

      return {
        movCode: r.movCode,
        companyName: r.companyName,
        supplierCode: r.supplierCode,
        supplierName: r.supplierName,
        supplierCustomerId: matched?.id || '',
        titleCode: r.titleCode,
        parcela: r.parcela,
        dueDate: r.dueDate,
        paymentDate: r.paymentDate,
        year: parseInt(r.paymentDate.slice(0, 4), 10),
        monthKey: monthKeyFromIso(r.paymentDate),
        description: r.description,
        payingAgent: r.payingAgent,
        department: r.department,
        amount: r.amount,
        status,
        notes,
        reconciledAt: isBorderou ? new Date().toISOString() : '',
      };
    });

    try {
      const result = await upsertContasPagar(toSave);
      console.log(`Contas a pagar importadas: ${result.count} processado(s), ${result.errors} erro(s).`);
      let fresh = await getContasPagar(selectedYear);
      setPayables(fresh);

      // Conciliação automática imediata após a importação
      const matches = computeAutoReconciliation(fresh, statementEntries);
      if (matches.length > 0) {
        await applyBaixaAutomatica(matches);
        fresh = await getContasPagar(selectedYear);
        setPayables(fresh);
      }
    } catch (err: any) {
      console.error('Erro ao importar contas a pagar:', err?.message || err);
    }
  };

  const handleReconcileNow = async () => {
    try {
      const matches = computeAutoReconciliation(payables, statementEntries);
      if (matches.length === 0) {
        alert('Nenhuma nova baixa automática encontrada. Os títulos em aberto não têm correspondência exata (valor + data) com lançamentos de saída ainda não utilizados no Extrato Financeiro.');
        return;
      }
      await applyBaixaAutomatica(matches);
      const fresh = await getContasPagar(selectedYear);
      setPayables(fresh);
      alert(`${matches.length} título(s) baixado(s) automaticamente com sucesso.`);
    } catch (e: any) {
      console.error('Erro na conciliação automática:', e?.message || e);
    }
  };

  // Gera código técnico sequencial para baixa: BX-AAAA-NNNNN
  const generateBaixaCode = (): string => {
    const year = new Date().getFullYear();
    const prefix = `BX-${year}-`;
    // Conta baixas existentes do mesmo ano para gerar sequencial
    const existingCodes = payables
      .filter((p) => p.baixaCode && p.baixaCode.startsWith(prefix))
      .map((p) => {
        const num = parseInt(p.baixaCode!.replace(prefix, ''), 10);
        return isNaN(num) ? 0 : num;
      });
    const nextSeq = existingCodes.length > 0 ? Math.max(...existingCodes) + 1 : 1;
    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  };

  const handleManualBaixa = async (
    id: string,
    notes?: string,
    statementEntryId?: string,
    statementSource?: string
  ) => {
    try {
      const baixaCode = generateBaixaCode();
      const now = new Date().toISOString();
      const updateFields: Partial<PayableTitle> = {
        status: 'Baixado Manual',
        notes: notes || '',
        reconciledAt: now,
        baixaCode,
      };
      // Se vier do "Encontrar no Extrato", salva o vínculo com o lançamento
      if (statementEntryId) {
        updateFields.reconciledStatementId = statementEntryId;
        updateFields.reconciledSource = statementSource || '';
      }
      await updateContaPagar(id, updateFields);
      setPayables((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: 'Baixado Manual' as const,
                notes: notes || p.notes,
                reconciledAt: now,
                baixaCode,
                reconciledStatementId: statementEntryId || p.reconciledStatementId,
                reconciledSource: statementSource || p.reconciledSource,
              }
            : p
        )
      );
    } catch (e) {
      console.error('Erro ao dar baixa manual:', e);
      alert('Erro ao dar baixa manual. Verifique o console.');
    }
  };

  const handleRevertBaixa = async (id: string) => {
    try {
      await updateContaPagar(id, {
        status: 'Em Aberto',
        reconciledStatementId: '',
        reconciledSource: '',
        reconciledAt: '',
      });
      setPayables((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: 'Em Aberto', reconciledStatementId: '', reconciledSource: '', reconciledAt: '' } : p
        )
      );
    } catch (e) {
      console.error('Erro ao estornar baixa:', e);
    }
  };

  const handleLinkSupplier = async (payableId: string, customerId: string, customerCode: string) => {
    try {
      await updateContaPagar(payableId, { supplierCustomerId: customerId });
      setPayables((prev) => prev.map((p) => (p.id === payableId ? { ...p, supplierCustomerId: customerId } : p)));
    } catch (e) {
      console.error('Erro ao vincular credor ao cliente:', e);
    }
  };

  const handleDeletePayable = async (id: string) => {
    try {
      await deleteContaPagar(id);
      setPayables((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error('Erro ao excluir título de contas a pagar:', e);
    }
  };

  const handleClearPayables = async () => {
    try {
      await clearContasPagar(selectedYear);
      setPayables([]);
    } catch (e) {
      console.error('Erro ao zerar contas a pagar:', e);
    }
  };

  // ── Handler: Salvar plano de Fluxo de Caixa (previsto manual) ─────────────
  const handleSaveCashFlowPlan = async (plan: CashFlowPlan) => {
    await saveFluxoCaixa(plan);
    // Atualiza o estado local (upsert por mês)
    setCashFlowPlans((prev) => {
      const others = prev.filter((p) => !(p.monthKey === plan.monthKey && p.year === plan.year));
      return [...others, plan];
    });
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
          <Suspense fallback={<ViewSkeleton />}>
          {activeTab === 'dashboard' && (
            <DashboardView
              economicMonths={economicData}
              financialMonths={financialData}
              customers={customers}
              delinquentTitles={delinquentTitles}
              selectedYear={selectedYear}
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
            />
          )}

          {activeTab === 'payables' && (
            <PayablesView
              payables={payables}
              statementEntries={statementEntries}
              customers={customers}
              selectedYear={selectedYear}
              onImportPayables={handleImportPayables}
              onReconcileNow={handleReconcileNow}
              onManualBaixa={handleManualBaixa}
              onRevertBaixa={handleRevertBaixa}
              onLinkSupplier={handleLinkSupplier}
              onDeletePayable={handleDeletePayable}
              onClearPayables={handleClearPayables}
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'cashflow' && (
            <CashFlowView
              plans={cashFlowPlans}
              statementEntries={statementEntries}
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
          </Suspense>
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
