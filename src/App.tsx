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

import {
  getEconomicData,
  getFinancialData,
  getClientes,
  getTitulosInadimplentes,
  getApiTokens,
  saveEconomicMonth,
  saveFinancialMonth,
  saveCliente,
  createApiToken,
  loginFirebase,
  logoutFirebase,
  saveBatchCustomers,
  saveBatchDelinquentTitles,
} from './firebaseService';

import {
  ApiToken,
  Customer,
  DelinquentTitle,
  DelinquencyValidationRowResult,
  EconomicMonthData,
  FinancialMonthData,
  PostgresConfig,
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
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
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
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
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
      const [ecoData, finData, cliData, titData, tokData] = await Promise.all([
        getEconomicData(year),
        getFinancialData(year),
        getClientes(),
        getTitulosInadimplentes(),
        getApiTokens(),
      ]);
      setEconomicData(ecoData);
      setFinancialData(finData);
      setCustomers(cliData);
      setDelinquentTitles(titData);
      setApiTokens(tokData);
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
      // Importação em lote de clientes
      // validateCustomerRows mapeia: rawDate=código, rawType=nome, rawDescription=fantasia,
      // rawValue=limite, rawCustomer=cnpj, + extras em rawContact/rawPhone/rawEmail/rawCity/rawState
      const newCustomers: Customer[] = validEntries.map((entry, idx) => {
        const row = entry as any;
        const code = (row.rawDate || '').trim();       // código do cliente
        const name = (row.rawType || '').trim();       // razão social
        const fantasia = (row.rawDescription || '').trim(); // nome fantasia
        const cnpjCpf = (row.rawCustomer || '').trim();     // cnpj/cpf
        const rawLimitStr = (row.rawValue || '0').toString();
        const creditLimit = parseFloat(
          rawLimitStr.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()
        ) || 0;

        return {
          id: `cli_import_${Date.now()}_${idx}`,
          code: code || `IMP-${String(idx + 1).padStart(4, '0')}`,
          name: name || 'Cliente Importado',
          cnpjCpf,
          tradeName: fantasia,
          contactName: (row.rawContact || '').trim(),
          phone: (row.rawPhone || '').trim(),
          email: (row.rawEmail || '').trim(),
          city: (row.rawCity || '').trim(),
          state: (row.rawState || '').trim(),
          creditLimit,
          currentBalance: 0,
          delinquentAmount: 0,
          status: 'Adimplente' as const,
          lastPurchaseDate: new Date().toISOString().split('T')[0],
        };
      });

      setCustomers((prev) => [...newCustomers, ...prev]);
      await saveBatchCustomers(newCustomers).catch((e) =>
        console.error('Erro ao salvar clientes em lote:', e)
      );
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

  // ── Handler: Importação de Inadimplência ────────────────────────────────────
  const handleCommitDelinquencyImport = async (
    validEntries: DelinquencyValidationRowResult[]
  ) => {
    const titlesToSave: DelinquentTitle[] = validEntries
      .filter((e) => e.parsedTitle)
      .map((e, i) => {
        const customerCode = (e.parsedTitle!.customerCode as string) || (e as any).rawCustomerCode || '';

        // Tenta vincular cliente por código, depois por nome
        const matchedCustomer = customers.find(
          (c) =>
            (customerCode && c.code.toLowerCase() === customerCode.toLowerCase()) ||
            c.name.toLowerCase() === e.rawCustomerName.toLowerCase()
        );

        return {
          id: `imported_${Date.now()}_${i}`,
          titleNumber: e.parsedTitle!.titleNumber || `IMP-${Date.now()}`,
          customerId: matchedCustomer?.id || e.parsedTitle!.customerId || '',
          customerCode: matchedCustomer?.code || customerCode,
          customerName: matchedCustomer?.name || e.rawCustomerName,
          cnpjCpf: e.parsedTitle!.cnpjCpf || e.rawCnpjCpf || matchedCustomer?.cnpjCpf || '',
          issueDate: e.parsedTitle!.issueDate || '',
          dueDate: e.parsedTitle!.dueDate || e.rawDueDate,
          originalAmount: e.parsedTitle!.originalAmount || 0,
          updatedAmount: e.parsedTitle!.updatedAmount || e.parsedTitle!.originalAmount || 0,
          daysOverdue: e.parsedTitle!.daysOverdue || 0,
          agingBucket: (e.parsedTitle!.agingBucket as DelinquentTitle['agingBucket']) || '1-30',
          collectionStatus: (e.parsedTitle!.collectionStatus as DelinquentTitle['collectionStatus']) || 'Aguardando',
          notes: e.parsedTitle!.notes || '',
        };
      });

    if (titlesToSave.length === 0) return;

    try {
      await saveBatchDelinquentTitles(titlesToSave);
      setDelinquentTitles((prev) => [...titlesToSave, ...prev]);
    } catch (err: any) {
      console.error('Erro ao importar inadimplência:', err.message);
    }
  };

  // ── Handler: Novo Cliente ─────────────────────────────────────────────────
  const handleAddCustomer = async (custData: Partial<Customer>) => {
    const newCust: Customer = {
      id: `cli_${Date.now()}`,
      code: `CLI-${Math.floor(1000 + Math.random() * 9000)}`,
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
    };

    // Atualiza state local
    setCustomers((prev) => [newCust, ...prev]);

    // Persiste no Firestore
    await saveCliente(newCust).catch((e) =>
      console.error('Erro ao salvar cliente no Firestore:', e)
    );
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
              userRole={currentUser.role}
            />
          )}

          {activeTab === 'delinquency' && (
            <DelinquencyReportView titles={delinquentTitles} selectedYear={selectedYear} />
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
