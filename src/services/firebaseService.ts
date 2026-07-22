import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  query, 
  where, 
  setDoc, 
  doc, 
  addDoc, 
  updateDoc,
  limit 
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import {
  User,
  EconomicMonthData,
  FinancialMonthData,
  Customer,
  DelinquentTitle,
  ApiToken
} from '../types';

let firestoreDb: ReturnType<typeof getFirestore>;

export const initFirebase = () => {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  firestoreDb = getFirestore(app);
  return firestoreDb;
};

export const getFirestoreDb = () => {
  if (!firestoreDb) {
    return initFirebase();
  }
  return firestoreDb;
};

// --- Economic Data ---
export const fetchEconomicData = async (year: number): Promise<Record<string, EconomicMonthData>> => {
  try {
    const db = getFirestoreDb();
    const q = query(collection(db, 'resultado_economico'), where('ano', '==', year));
    const snapshot = await getDocs(q);
    
    const result: Record<string, EconomicMonthData> = {};
    
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const mes_chave = data.mes_chave || '';
      const receitaBruta = data.receita_bruta || 0;
      const cmv = data.cmv || 0;
      const margemBruta = data.margem_bruta || 0;
      const despesasFixas = data.despesas_fixas || 0;
      const resultadoEconomico = data.resultado_economico || 0;
      
      const cmvPercent = receitaBruta > 0 ? (cmv / receitaBruta) * 100 : 0;
      const margemPercent = receitaBruta > 0 ? (margemBruta / receitaBruta) * 100 : 0;
      const despesasPercent = receitaBruta > 0 ? (despesasFixas / receitaBruta) * 100 : 0;
      const resultadoPercent = receitaBruta > 0 ? (resultadoEconomico / receitaBruta) * 100 : 0;

      const monthLabel = `${mes_chave.charAt(0).toUpperCase() + mes_chave.slice(1)}/${year.toString().slice(-2)}`;
      
      result[mes_chave] = {
        monthKey: mes_chave,
        monthLabel,
        receitaBruta,
        cmv,
        cmvPercent,
        margemBruta,
        margemPercent,
        despesasFixas,
        despesasPercent,
        resultadoEconomico,
        resultadoPercent,
        pontoEquilibrio: data.ponto_equilibrio || 0
      };
    });
    
    return result;
  } catch (error) {
    console.error('Error fetching economic data:', error);
    return {};
  }
};

export const saveEconomicLaunch = async (year: number, monthKey: string, data: Partial<EconomicMonthData>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docId = `${year}-${monthKey}`;
    const docRef = doc(db, 'resultado_economico', docId);
    
    const firestoreData: any = {
      ano: year,
      mes_chave: monthKey,
    };
    if (data.receitaBruta !== undefined) firestoreData.receita_bruta = data.receitaBruta;
    if (data.cmv !== undefined) firestoreData.cmv = data.cmv;
    if (data.margemBruta !== undefined) firestoreData.margem_bruta = data.margemBruta;
    if (data.despesasFixas !== undefined) firestoreData.despesas_fixas = data.despesasFixas;
    if (data.resultadoEconomico !== undefined) firestoreData.resultado_economico = data.resultadoEconomico;
    if (data.pontoEquilibrio !== undefined) firestoreData.ponto_equilibrio = data.pontoEquilibrio;

    await setDoc(docRef, firestoreData, { merge: true });
  } catch (error) {
    console.error('Error saving economic launch:', error);
    throw error;
  }
};

// --- Financial Data ---
export const fetchFinancialData = async (year: number): Promise<Record<string, FinancialMonthData>> => {
  try {
    const db = getFirestoreDb();
    const q = query(collection(db, 'resultado_financeiro'), where('ano', '==', year));
    const snapshot = await getDocs(q);
    
    const result: Record<string, FinancialMonthData> = {};
    
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const mes_chave = data.mes_chave || '';
      const entradasBancos = data.entradas_bancos || 0;
      const entradasTesouraria = data.entradas_tesouraria || 0;
      const totalEntradas = data.total_entradas || 0;
      const resultadoFinanceiro = data.resultado_financeiro || 0;
      
      const resultadoPercent = totalEntradas > 0 ? (resultadoFinanceiro / totalEntradas) * 100 : 0;
      const monthLabel = `${mes_chave.charAt(0).toUpperCase() + mes_chave.slice(1)}/${year.toString().slice(-2)}`;
      
      result[mes_chave] = {
        monthKey: mes_chave,
        monthLabel,
        entradasBancos,
        entradasTesouraria,
        totalEntradas,
        totalSaidas: data.total_saidas || 0,
        resultadoFinanceiro,
        resultadoPercent,
        estoque: data.estoque || 0,
        inadimplenciaMensal: data.inadimplencia_mensal || 0,
        inadimplenciaAcumulada: data.inadimplencia_acumulada || 0
      };
    });
    
    return result;
  } catch (error) {
    console.error('Error fetching financial data:', error);
    return {};
  }
};

export const saveFinancialLaunch = async (year: number, monthKey: string, data: Partial<FinancialMonthData>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docId = `${year}-${monthKey}`;
    const docRef = doc(db, 'resultado_financeiro', docId);
    
    const firestoreData: any = {
      ano: year,
      mes_chave: monthKey,
    };
    if (data.entradasBancos !== undefined) firestoreData.entradas_bancos = data.entradasBancos;
    if (data.entradasTesouraria !== undefined) firestoreData.entradas_tesouraria = data.entradasTesouraria;
    if (data.totalEntradas !== undefined) firestoreData.total_entradas = data.totalEntradas;
    if (data.totalSaidas !== undefined) firestoreData.total_saidas = data.totalSaidas;
    if (data.resultadoFinanceiro !== undefined) firestoreData.resultado_financeiro = data.resultadoFinanceiro;
    if (data.estoque !== undefined) firestoreData.estoque = data.estoque;
    if (data.inadimplenciaMensal !== undefined) firestoreData.inadimplencia_mensal = data.inadimplenciaMensal;
    if (data.inadimplenciaAcumulada !== undefined) firestoreData.inadimplencia_acumulada = data.inadimplenciaAcumulada;

    await setDoc(docRef, firestoreData, { merge: true });
  } catch (error) {
    console.error('Error saving financial launch:', error);
    throw error;
  }
};

// --- Customers ---
export const fetchCustomers = async (): Promise<Customer[]> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'clientes'));
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        code: data.codigo || '',
        cnpjCpf: data.cnpj_cpf || '',
        name: data.razao_social || '',
        tradeName: data.nome_fantasia || '',
        contactName: data.contato_nome || '',
        phone: data.telefone || '',
        email: data.email || '',
        city: data.cidade || '',
        state: data.estado || '',
        creditLimit: data.limite_credito || 0,
        currentBalance: data.saldo_atual || 0,
        delinquentAmount: data.valor_inadimplente || 0,
        status: data.status || 'Adimplente',
        lastPurchaseDate: data.ultima_compra
      };
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return [];
  }
};

export const addCustomer = async (customer: Customer): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const firestoreData = {
      codigo: customer.code,
      cnpj_cpf: customer.cnpjCpf,
      razao_social: customer.name,
      nome_fantasia: customer.tradeName || '',
      contato_nome: customer.contactName,
      telefone: customer.phone,
      email: customer.email,
      cidade: customer.city,
      estado: customer.state,
      limite_credito: customer.creditLimit,
      saldo_atual: customer.currentBalance,
      valor_inadimplente: customer.delinquentAmount,
      status: customer.status,
      ultima_compra: customer.lastPurchaseDate || null
    };
    await addDoc(collection(db, 'clientes'), firestoreData);
  } catch (error) {
    console.error('Error adding customer:', error);
    throw error;
  }
};

// --- Delinquent Titles ---
export const fetchDelinquentTitles = async (): Promise<DelinquentTitle[]> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'titulos_inadimplentes'));
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        titleNumber: data.numero_titulo || '',
        customerId: data.cliente_id || '',
        customerCode: data.codigo_cliente || '',
        customerName: data.cliente_nome || '',
        cnpjCpf: data.cnpj_cpf || '',
        issueDate: data.data_emissao || '',
        dueDate: data.data_vencimento || '',
        originalAmount: data.valor_original || 0,
        updatedAmount: data.valor_atualizado || 0,
        daysOverdue: data.dias_atraso || 0,
        agingBucket: data.faixa_aging || '1-30',
        collectionStatus: data.status_cobranca || 'Aguardando',
        notes: data.observacoes || ''
      };
    });
  } catch (error) {
    console.error('Error fetching delinquent titles:', error);
    return [];
  }
};

// Calcula automaticamente os dias em atraso a partir da data de vencimento
const calcDaysOverdue = (dueDate: string): number => {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const today = new Date();
  if (isNaN(due.getTime())) return 0;
  const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
};

// Classifica o aging bucket com base nos dias em atraso
const calcAgingBucket = (days: number): DelinquentTitle['agingBucket'] => {
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '>90';
};

// Salva um único título inadimplente no Firestore (titulos_inadimplentes)
export const saveDelinquentTitle = async (title: Omit<DelinquentTitle, 'id'>): Promise<string> => {
  try {
    const db = getFirestoreDb();

    // Calcula dias e aging automaticamente se não fornecidos
    const daysOverdue = title.daysOverdue > 0 ? title.daysOverdue : calcDaysOverdue(title.dueDate);
    const agingBucket = title.agingBucket || calcAgingBucket(daysOverdue);
    const updatedAmount = title.updatedAmount > 0 ? title.updatedAmount : title.originalAmount;

    const firestoreData = {
      numero_titulo: title.titleNumber,
      cliente_id: title.customerId || '',
      cliente_nome: title.customerName,
      cnpj_cpf: title.cnpjCpf,
      data_emissao: title.issueDate || '',
      data_vencimento: title.dueDate,
      valor_original: title.originalAmount,
      valor_atualizado: updatedAmount,
      dias_atraso: daysOverdue,
      faixa_aging: agingBucket,
      status_cobranca: title.collectionStatus || 'Aguardando',
      observacoes: title.notes || '',
      importado_em: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, 'titulos_inadimplentes'), firestoreData);
    return docRef.id;
  } catch (error) {
    console.error('Error saving delinquent title:', error);
    throw error;
  }
};

// Salva um lote de títulos inadimplentes (importação em massa)
export const saveDelinquentTitlesBatch = async (
  titles: Omit<DelinquentTitle, 'id'>[]
): Promise<{ saved: number; errors: number }> => {
  let saved = 0;
  let errors = 0;

  for (const title of titles) {
    try {
      await saveDelinquentTitle(title);
      saved++;
    } catch {
      errors++;
    }
  }

  return { saved, errors };
};

export const updateDelinquentTitleStatus = async (id: string, status: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docRef = doc(db, 'titulos_inadimplentes', id);
    await updateDoc(docRef, { status_cobranca: status });
  } catch (error) {
    console.error('Error updating delinquent title status:', error);
    throw error;
  }
};

export const addDelinquentTitle = async (title: DelinquentTitle): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const firestoreData = {
      numero_titulo: title.titleNumber,
      cliente_id: title.customerId,
      cliente_nome: title.customerName,
      cnpj_cpf: title.cnpjCpf,
      data_emissao: title.issueDate,
      data_vencimento: title.dueDate,
      valor_original: title.originalAmount,
      valor_atualizado: title.updatedAmount,
      dias_atraso: title.daysOverdue,
      faixa_aging: title.agingBucket,
      status_cobranca: title.collectionStatus,
      observacoes: title.notes || ''
    };
    await addDoc(collection(db, 'titulos_inadimplentes'), firestoreData);
  } catch (error) {
    console.error('Error adding delinquent title:', error);
    throw error;
  }
};

export const saveBatchCustomers = async (customers: Customer[]): Promise<void> => {
  const db = getFirestoreDb();
  for (const customer of customers) {
    try {
      const firestoreData = {
        codigo: customer.code,
        cnpj_cpf: customer.cnpjCpf,
        razao_social: customer.name,
        nome_fantasia: customer.tradeName || '',
        contato_nome: customer.contactName,
        telefone: customer.phone,
        email: customer.email,
        cidade: customer.city,
        estado: customer.state,
        limite_credito: customer.creditLimit,
        saldo_atual: customer.currentBalance,
        valor_inadimplente: customer.delinquentAmount,
        status: customer.status,
        ultima_compra: customer.lastPurchaseDate || null
      };
      await addDoc(collection(db, 'clientes'), firestoreData);
    } catch (error) {
      console.error('Error saving batch customer:', customer.code, error);
    }
  }
};

export const saveBatchDelinquentTitles = async (titles: DelinquentTitle[]): Promise<void> => {
  const db = getFirestoreDb();
  for (const title of titles) {
    try {
      const firestoreData = {
        numero_titulo: title.titleNumber,
        cliente_id: title.customerId,
        cliente_nome: title.customerName,
        cnpj_cpf: title.cnpjCpf,
        data_emissao: title.issueDate,
        data_vencimento: title.dueDate,
        valor_original: title.originalAmount,
        valor_atualizado: title.updatedAmount,
        dias_atraso: title.daysOverdue,
        faixa_aging: title.agingBucket,
        status_cobranca: title.collectionStatus,
        observacoes: title.notes || ''
      };
      await addDoc(collection(db, 'titulos_inadimplentes'), firestoreData);
    } catch (error) {
      console.error('Error saving batch title:', title.titleNumber, error);
    }
  }
};

// --- Users ---
export const fetchUsers = async (): Promise<User[]> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'usuarios'));
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.nome || '',
        email: data.email || '',
        role: data.funcao || 'viewer',
        avatar: data.avatar || undefined
      };
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
};

// --- API Tokens ---
export const fetchApiTokens = async (): Promise<ApiToken[]> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'api_tokens'));
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || '',
        token: data.token || '',
        createdAt: data.createdAt || '',
        lastUsed: data.lastUsed || undefined,
        status: data.status || 'active'
      };
    });
  } catch (error) {
    console.error('Error fetching api tokens:', error);
    return [];
  }
};

export const addApiToken = async (token: ApiToken): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const firestoreData = {
      name: token.name,
      token: token.token,
      createdAt: token.createdAt,
      lastUsed: token.lastUsed || null,
      status: token.status
    };
    await addDoc(collection(db, 'api_tokens'), firestoreData);
  } catch (error) {
    console.error('Error adding API token:', error);
    throw error;
  }
};

// --- System ---
export const checkFirestoreConnection = async (): Promise<{isConnected: boolean; error?: string}> => {
  try {
    const db = getFirestoreDb();
    const q = query(collection(db, 'usuarios'), limit(1));
    await getDocs(q);
    return { isConnected: true };
  } catch (error: any) {
    console.error('Firestore connection check failed:', error);
    return { isConnected: false, error: error.message };
  }
};
