/**
 * Firebase Service - Camada de integração com Firestore
 * Re-exporta funções do serviço Firestore com aliases usados pelo App.tsx
 */
import {
  initFirebase,
  fetchEconomicData,
  fetchFinancialData,
  fetchCustomers,
  fetchDelinquentTitles,
  fetchSellers,
  fetchApiTokens,
  fetchUsers,
  saveEconomicLaunch,
  saveFinancialLaunch,
  addCustomer,
  updateCustomer as _updateCustomer,
  deleteCustomer as _deleteCustomer,
  addSeller as _addSeller,
  updateSeller as _updateSeller,
  deleteSeller as _deleteSeller,
  addDelinquentTitle,
  addApiToken,
  checkFirestoreConnection,
  clearAllDelinquentTitles as _clearAllDelinquentTitles,
  saveBatchCustomers as _saveBatchCustomers,
  saveBatchDelinquentTitles as _saveBatchDelinquentTitles,
  saveDelinquentTitlesBatch as _saveDelinquentTitlesBatch,
  upsertCustomersBatch as _upsertCustomersBatch,
  upsertDelinquentTitlesBatch as _upsertDelinquentTitlesBatch,
  updateCustomerDelinquency as _updateCustomerDelinquency,
  updateDelinquentTitle as _updateDelinquentTitle,
  deleteDelinquentTitle as _deleteDelinquentTitle,
  fetchStatementEntries,
  upsertStatementEntries as _upsertStatementEntries,
  deleteStatementEntry as _deleteStatementEntry,
  clearStatementEntries as _clearStatementEntries,
  fetchCashFlowPlans,
  saveCashFlowPlan as _saveCashFlowPlan,
  fetchPayables,
  upsertPayablesBatch as _upsertPayablesBatch,
  updatePayable as _updatePayable,
  applyPayablesReconciliation as _applyPayablesReconciliation,
  deletePayable as _deletePayable,
  clearPayables as _clearPayables,
  signInAuthorizedUser,
  signOutUser,
} from './services/firebaseService';

import { ApiToken, Customer, DelinquentTitle, EconomicMonthData, FinancialMonthData, Seller, User } from './types';

// Inicializa Firebase ao carregar o módulo
initFirebase();

// ── Leitura de dados ────────────────────────────────────────────────────────
export const getEconomicData = fetchEconomicData;
export const getFinancialData = fetchFinancialData;
export const getClientes = fetchCustomers;
export const getTitulosInadimplentes = fetchDelinquentTitles;
export const getVendedores = fetchSellers;
export const getApiTokens = fetchApiTokens;
export const getUsuarios = fetchUsers;

// ── Persistência de dados ───────────────────────────────────────────────────
export const saveEconomicMonth = async (
  year: number,
  monthKey: string,
  data: EconomicMonthData
): Promise<void> => {
  await saveEconomicLaunch(year, monthKey, data);
};

export const saveFinancialMonth = async (
  year: number,
  monthKey: string,
  data: FinancialMonthData
): Promise<void> => {
  await saveFinancialLaunch(year, monthKey, data);
};

export const saveCliente = async (customer: Customer): Promise<void> => {
  await addCustomer(customer);
};

export const updateCliente = _updateCustomer;
export const deleteCliente = _deleteCustomer;

export const saveVendedor = _addSeller;
export const updateVendedor = _updateSeller;
export const deleteVendedor = _deleteSeller;

export const clearInadimplencia = _clearAllDelinquentTitles;

export const createApiToken = async (name: string): Promise<ApiToken> => {
  const newToken: ApiToken = {
    id: `tok_${Date.now()}`,
    name,
    token: `pdg_live_${Math.random().toString(36).substring(2, 18)}`,
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  await addApiToken(newToken);
  return newToken;
};

// ── Autenticação (Firebase Auth real) ─────────────────────────────────────────
export const loginFirebase = async (
  email: string,
  password: string
): Promise<{ user: User }> => {
  const user = await signInAuthorizedUser(email, password);
  return { user };
};

export const logoutFirebase = async (): Promise<void> => {
  await signOutUser();
};

// ── Verificação de conexão ──────────────────────────────────────────────────
export const testFirestoreConnection = checkFirestoreConnection;

// ── Importação em Lote ──────────────────────────────────────────────────────
export const saveBatchCustomers = _saveBatchCustomers;
export const saveBatchDelinquentTitles = _saveBatchDelinquentTitles;
export const saveDelinquentTitle = addDelinquentTitle;
export const saveDelinquentTitlesBatch = _saveDelinquentTitlesBatch;

// ── Importação com UPSERT (usa cod_cliente como chave) ───────────────────────
export const upsertClientes = _upsertCustomersBatch;
export const upsertTitulos = _upsertDelinquentTitlesBatch;
export const updateClienteInadimplencia = _updateCustomerDelinquency;

// ── CRUD de Títulos de Inadimplência ─────────────────────────────────────────
export const addTitulo = addDelinquentTitle;
export const updateTitulo = _updateDelinquentTitle;
export const deleteTitulo = _deleteDelinquentTitle;

// ── Extrato Financeiro (Conciliação Bancária / Caixa-Tesouraria) ────────────
export const getExtratoFinanceiro = fetchStatementEntries;
export const upsertExtratoFinanceiro = _upsertStatementEntries;
export const deleteExtratoFinanceiro = _deleteStatementEntry;
export const clearExtratoFinanceiro = _clearStatementEntries;

// ── Fluxo de Caixa (Planejamento Semanal Previsto x Realizado) ──────────────
export const getFluxoCaixa = fetchCashFlowPlans;
export const saveFluxoCaixa = _saveCashFlowPlan;

// ── Contas a Pagar (RFN006 — Totais Pagos por Credor) ───────────────────────
export const getContasPagar = fetchPayables;
export const upsertContasPagar = _upsertPayablesBatch;
export const updateContaPagar = _updatePayable;
export const applyBaixaAutomatica = _applyPayablesReconciliation;
export const deleteContaPagar = _deletePayable;
export const clearContasPagar = _clearPayables;

