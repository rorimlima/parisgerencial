/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App.tsx — Paris Dakar Gerencial
 * Todos os dados vêm do Firestore (Firebase). Sem dados hardcoded.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { CustomerManagementView } from './components/CustomerManagementView';
import { DashboardView } from './components/DashboardView';
import { DelinquencyReportView } from './components/DelinquencyReportView';
import { EconomicView } from './components/EconomicView';
import { FinancialView } from './components/FinancialView';
import { ImportDataView } from './components/ImportDataView';
import { LaunchModal } from './components/LaunchModal';
import { LoginModal } from './components/LoginModal';
import { Navbar } from './components/Navbar';
import { PwaInstallBanner } from './components/PwaBanners';
import { Sidebar } from './components/Sidebar';
import { SellersManagementView } from './components/SellersManagementView';
import { ApiIntegrationDocsView } from './components/ApiIntegrationDocsView';
import { PostgresSettingsView } from './components/PostgresSettingsView';
import { FinancialStatementView } from './components/FinancialStatementView';
import { PayablesView, RawPayableRow } from './components/PayablesView';

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
} from './firebaseService';

import {
  ApiToken,
  Customer,
  DelinquentTitle,
  DelinquencyValidationRowResult,
  EconomicMonthData,
  FinancialMonthData,
  FinancialStatementEntry,
  PayableTitle,
  PostgresConfig,
  Seller,
  StatementSource,
  UserRole,
  ValidationRowResult,
  ViewTab,
  User,
} from './types';

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [importTargetModule, setImportTargetModule] = useState<'financial' | 'economic' | 'customers' | 'delinquency'>('financial');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // ── Autenticação ──────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User>({
    id: 'usr_default',
    name: 'Rorim (Administrador)',
    email: 'rorim@parisdakar.com.br',
    role: 'admin',
  });
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
  const [loginError, setLoginError] = useState<string>('');

  // Config Postgres mantida apenas para exibição da tela de configurações
  const [postgresConfig] = useState<PostgresConfig>({
    host: import.meta.env.VITE_PGHOST || 'Firebase Firestore',
    port: 5432,
    database: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'paris-dakar-gerencial',
    user: 'firebase-auth',
    ssl: true,
    isConnected: true,
  });

  // ── Carrega dados do Firestore quando o ano mudar ─────────────────────────
  const loadAllData = useCallback(async (year: number) => {
    setIsLoading(true);
    try {
      const [ecoData, finData, cliData, titData, vendData, tokData, stmtData, payData] = await Promise.all([
        getEconomicData(year),
        getFinancialData(year),
        getClientes(),
        getTitulosInadimplentes(),
        getVendedores(),
        getApiTokens(),
        getExtratoFinanceiro(year),
        getContasPagar(year),
      ]);
      setEconomicData(ecoData);
      setFinancialData(finData);
      setCustomers(cliData);
      setDelinquentTitles(titData);
      setSellers(vendData);
      setApiTokens(tokData);
      setStatementEntries(stmtData);
      setPayables(payData);
    } catch (err: any) {
      console.error('Erro ao carregar dados do Firestore:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData(selectedYear);
  }, [selectedYear, loadAllData]);



  // ── Handler: Login via Firebase Auth ─────────────────────────────────────
  const handleLoginSuccess = async (credentials: { email: string; password: string; role: UserRole }) => {
    setLoginError('');
    try {
      const result = await loginFirebase(credentials.email, credentials.password);
      if (result) {
        setCurrentUser({
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: credentials.role || result.user.role,
        });
        setIsLoginModalOpen(false);
      }
    } catch (err: any) {
      setLoginError(err.message || 'Erro ao autenticar. Verifique as credenciais.');
    }
  };

  const handleLogout = async () => {
    await logoutFirebase();
    setCurrentUser({ id: 'usr_default', name: 'Rorim (Administrador)', email: 'rorim@parisdakar.com.br', role: 'admin' });
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

  // ── Handler: Importação de Inadimplência (UPSERT + recálculo por cod_cliente) ─
  const handleCommitDelinquencyImport = async (
    validEntries: DelinquencyValidationRowResult[]
  ) => {
    const titlesToSave: Omit<DelinquentTitle, 'id'>[] = validEntries
      .filter((e) => e.parsedTitle)
      .map((e) => {
        const p = e.parsedTitle!;
        const customerCode = (p.customerCode as string) || (e as any).rawCustomerCode || '';

        // Vincula cliente por cod_cliente e, como fallback, por nome
        const matchedCustomer = customers.find(
          (c) =>
            (customerCode && c.code.toLowerCase() === customerCode.toLowerCase()) ||
            c.name.toLowerCase() === e.rawCustomerName.toLowerCase()
        );

        return {
          titleNumber: p.titleNumber || `IMP-${Date.now()}`,
          parcela: p.parcela || '',
          customerId: matchedCustomer?.id || p.customerId || '',
          customerCode: matchedCustomer?.code || customerCode,
          customerName: matchedCustomer?.name || e.rawCustomerName,
          sellerId: p.sellerId || '',
          sellerCode: p.sellerCode || '',
          sellerName: p.sellerName || '',
          cnpjCpf: p.cnpjCpf || e.rawCnpjCpf || matchedCustomer?.cnpjCpf || '',
          issueDate: p.issueDate || '',
          dueDate: p.dueDate || e.rawDueDate,
          originalAmount: p.originalAmount || 0,
          updatedAmount: p.updatedAmount || p.originalAmount || 0,
          juros: p.juros || 0,
          multa: p.multa || 0,
          daysOverdue: p.daysOverdue || 0,
          agingBucket: (p.agingBucket as DelinquentTitle['agingBucket']) || '1-30',
          collectionStatus: (p.collectionStatus as DelinquentTitle['collectionStatus']) || 'Aguardando',
          notes: p.notes || '',
        };
      });

    if (titlesToSave.length === 0) return;

    try {
      const result = await upsertTitulos(titlesToSave);
      console.log(`Títulos importados: ${result.added} novos, ${result.updated} atualizados.`);
      // Recarrega títulos reais do Firestore e recalcula a dívida dos clientes
      const freshTitles = await getTitulosInadimplentes();
      setDelinquentTitles(freshTitles);
      await applyDelinquencyToCustomers(freshTitles, customers);
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
    setSellers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...sellerData } : s))
    );
    await updateVendedor(id, sellerData).catch((e) =>
      console.error('Erro ao atualizar vendedor no Firestore:', e)
    );
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
      const status = isBorderou ? 'Baixado Manual' : 'Em Aberto';
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

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          userRole={currentUser.role}
        />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
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

          {activeTab === 'import' && (
            <ImportDataView
              onCommitImport={handleCommitImport}
              onCommitDelinquencyImport={handleCommitDelinquencyImport}
              selectedYear={selectedYear}
              initialModule={importTargetModule}
            />
          )}

          {activeTab === 'customers' && (
            <CustomerManagementView
              customers={customers}
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
        loginError={loginError}
      />

      {/* PWA — Banner de Instalação */}
      <PwaInstallBanner />
    </div>
  );
}
