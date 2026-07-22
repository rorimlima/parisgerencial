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
  fetchApiTokens,
  fetchUsers,
  saveEconomicLaunch,
  saveFinancialLaunch,
  addCustomer,
  addDelinquentTitle,
  addApiToken,
  checkFirestoreConnection,
  saveBatchCustomers as _saveBatchCustomers,
  saveBatchDelinquentTitles as _saveBatchDelinquentTitles,
  saveDelinquentTitlesBatch as _saveDelinquentTitlesBatch,
} from './services/firebaseService';

import { ApiToken, Customer, DelinquentTitle, EconomicMonthData, FinancialMonthData, User } from './types';

// Inicializa Firebase ao carregar o módulo
initFirebase();

// ── Leitura de dados ────────────────────────────────────────────────────────
export const getEconomicData = fetchEconomicData;
export const getFinancialData = fetchFinancialData;
export const getClientes = fetchCustomers;
export const getTitulosInadimplentes = fetchDelinquentTitles;
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

// ── Autenticação (simplificada — sem Firebase Auth por ora) ──────────────────
export const loginFirebase = async (
  email: string,
  password: string
): Promise<{ user: User }> => {
  // Busca usuários do Firestore e verifica credenciais
  const users = await fetchUsers();
  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );

  if (!user) {
    throw new Error('Usuário não encontrado. Verifique o e-mail informado.');
  }

  // Para demonstração, aceita qualquer senha
  return { user };
};

export const logoutFirebase = async (): Promise<void> => {
  // Logout local
  console.log('Logout realizado.');
};

// ── Verificação de conexão ──────────────────────────────────────────────────
export const testFirestoreConnection = checkFirestoreConnection;

// ── Importação em Lote ──────────────────────────────────────────────────────
export const saveBatchCustomers = _saveBatchCustomers;
export const saveBatchDelinquentTitles = _saveBatchDelinquentTitles;
export const saveDelinquentTitle = addDelinquentTitle;
export const saveDelinquentTitlesBatch = _saveDelinquentTitlesBatch;
