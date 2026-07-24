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
  deleteDoc,
  writeBatch,
  limit
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import { INITIAL_ECONOMIC_BY_YEAR, INITIAL_FINANCIAL_BY_YEAR, INITIAL_SELLERS } from '../data/initialData';
import {
  User,
  EconomicMonthData,
  FinancialMonthData,
  Customer,
  DelinquentTitle,
  Seller,
  ApiToken,
  FinancialStatementEntry,
  PayableTitle,
  PayableStatus,
  CashFlowPlan
} from '../types';

let firestoreDb: ReturnType<typeof getFirestore>;

const ALL_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Executa uma operação do Firestore com um tempo limite (timeout) explícito.
 * Garante que a UI nunca fique "presa" indefinidamente esperando uma escrita ou
 * leitura que trave por instabilidade de rede — em vez de girar para sempre, a
 * promessa rejeita com uma mensagem clara após `ms` milissegundos, permitindo
 * que a interface se recupere e informe o usuário.
 */
const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tempo limite excedido (${Math.round(ms / 1000)}s) em: ${label}. Verifique sua conexão e tente novamente.`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
};

function createEmptyEconomicMonth(monthKey: string, year: number): EconomicMonthData {
  return {
    monthKey,
    monthLabel: `${monthKey.charAt(0).toUpperCase() + monthKey.slice(1)}/${year.toString().slice(-2)}`,
    receitaBruta: 0, cmv: 0, cmvPercent: 0, margemBruta: 0, margemPercent: 0,
    despesasFixas: 0, despesasPercent: 0, resultadoEconomico: 0, resultadoPercent: 0, pontoEquilibrio: 0,
  };
}

function createEmptyFinancialMonth(monthKey: string, year: number): FinancialMonthData {
  return {
    monthKey,
    monthLabel: `${monthKey.charAt(0).toUpperCase() + monthKey.slice(1)}/${year.toString().slice(-2)}`,
    entradasBancos: 0, entradasTesouraria: 0, totalEntradas: 0, totalSaidas: 0,
    resultadoFinanceiro: 0, resultadoPercent: 0, estoque: 0, inadimplenciaMensal: 0, inadimplenciaAcumulada: 0,
  };
}

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
    
    const initialForYear = INITIAL_ECONOMIC_BY_YEAR[year];
    const result: Record<string, EconomicMonthData> = {};
    
    ALL_MONTHS.forEach(m => {
      if (initialForYear && initialForYear[m]) {
        result[m] = { ...initialForYear[m] };
      } else {
        result[m] = createEmptyEconomicMonth(m, year);
      }
    });

    // Se o Firestore tiver registros para este ano
    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const mes_chave = data.mes_chave || '';
        if (!mes_chave) return;

        // Se para este ano temos uma definição oficial mestre (como 2026 onde jul-dez são zerados),
        // e o mês em initialForYear é zerado oficialmente, limpa/reseta o documento do Firestore
        if (initialForYear && initialForYear[mes_chave]) {
          if (initialForYear[mes_chave].receitaBruta === 0 && data.receita_bruta > 0) {
            saveEconomicLaunch(year, mes_chave, initialForYear[mes_chave]).catch(() => {});
            return;
          }
        }

        const receitaBruta = data.receita_bruta !== undefined ? data.receita_bruta : (result[mes_chave]?.receitaBruta || 0);
        const cmv = data.cmv !== undefined ? data.cmv : (result[mes_chave]?.cmv || 0);
        const margemBruta = data.margem_bruta !== undefined ? data.margem_bruta : (result[mes_chave]?.margemBruta || 0);
        const despesasFixas = data.despesas_fixas !== undefined ? data.despesas_fixas : (result[mes_chave]?.despesasFixas || 0);
        const resultadoEconomico = data.resultado_economico !== undefined ? data.resultado_economico : (result[mes_chave]?.resultadoEconomico || 0);
        
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
          pontoEquilibrio: data.ponto_equilibrio !== undefined ? data.ponto_equilibrio : (result[mes_chave]?.pontoEquilibrio || 0)
        };
      });
    } else if (initialForYear) {
      Object.entries(initialForYear).forEach(([mKey, mData]) => {
        saveEconomicLaunch(year, mKey, mData).catch((err) => console.warn('Erro ao salvar lote inicial:', err));
      });
    }

    // Para o ano de 2026, forçamos a sincronização dos dados mestres oficiais (Jan-Jun preenchidos, Jul-Dez zerados) no Firestore
    if (year === 2026 && initialForYear) {
      ALL_MONTHS.forEach((mKey) => {
        if (initialForYear[mKey]) {
          result[mKey] = { ...initialForYear[mKey] };
          saveEconomicLaunch(year, mKey, initialForYear[mKey]).catch(() => {});
        }
      });
    }
    
    return result;
  } catch (error) {
    console.error('Error fetching economic data:', error);
    const initialForYear = INITIAL_ECONOMIC_BY_YEAR[year];
    if (initialForYear) return initialForYear;
    const empty: Record<string, EconomicMonthData> = {};
    ALL_MONTHS.forEach(m => { empty[m] = createEmptyEconomicMonth(m, year); });
    return empty;
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
    
    const initialForYear = INITIAL_FINANCIAL_BY_YEAR[year];
    const result: Record<string, FinancialMonthData> = {};
    ALL_MONTHS.forEach(m => {
      if (initialForYear && initialForYear[m]) {
        result[m] = { ...initialForYear[m] };
      } else {
        result[m] = createEmptyFinancialMonth(m, year);
      }
    });
    
    // Se o Firestore tiver registros para este ano, mescla com os dados do Firestore
    if (!snapshot.empty) {
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const mes_chave = data.mes_chave || '';
        if (!mes_chave) return;

        const entradasBancos = data.entradas_bancos !== undefined ? data.entradas_bancos : (result[mes_chave]?.entradasBancos || 0);
        const entradasTesouraria = data.entradas_tesouraria !== undefined ? data.entradas_tesouraria : (result[mes_chave]?.entradasTesouraria || 0);
        const totalEntradas = data.total_entradas !== undefined ? data.total_entradas : (entradasBancos + entradasTesouraria);
        const totalSaidas = data.total_saidas !== undefined ? data.total_saidas : (result[mes_chave]?.totalSaidas || 0);
        const resultadoFinanceiro = data.resultado_financeiro !== undefined ? data.resultado_financeiro : (totalEntradas - totalSaidas);
        
        const resultadoPercent = totalEntradas > 0 ? (resultadoFinanceiro / totalEntradas) * 100 : 0;
        const monthLabel = `${mes_chave.charAt(0).toUpperCase() + mes_chave.slice(1)}/${year.toString().slice(-2)}`;
        
        result[mes_chave] = {
          monthKey: mes_chave,
          monthLabel,
          entradasBancos,
          entradasTesouraria,
          totalEntradas,
          totalSaidas,
          resultadoFinanceiro,
          resultadoPercent,
          estoque: data.estoque !== undefined ? data.estoque : (result[mes_chave]?.estoque || 0),
          inadimplenciaMensal: data.inadimplencia_mensal !== undefined ? data.inadimplencia_mensal : (result[mes_chave]?.inadimplenciaMensal || 0),
          inadimplenciaAcumulada: data.inadimplencia_acumulada !== undefined ? data.inadimplencia_acumulada : (result[mes_chave]?.inadimplenciaAcumulada || 0)
        };
      });
    } else if (initialForYear) {
      // Se não há dados no Firestore ainda para este ano, salva os dados de initialData em background
      Object.entries(initialForYear).forEach(([mKey, mData]) => {
        saveFinancialLaunch(year, mKey, mData).catch((err) => console.warn('Erro ao salvar lote inicial financeiro:', err));
      });
    }
    
    return result;
  } catch (error) {
    console.error('Error fetching financial data:', error);
    const initialForYear = INITIAL_FINANCIAL_BY_YEAR[year];
    if (initialForYear) return initialForYear;
    const empty: Record<string, FinancialMonthData> = {};
    ALL_MONTHS.forEach(m => { empty[m] = createEmptyFinancialMonth(m, year); });
    return empty;
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
        lastPurchaseDate: data.ultima_compra,
        personType: data.tipo_pessoa || '',
        cellphone: data.celular || '',
        address: data.endereco || '',
        addressNumber: data.numero || '',
        neighborhood: data.bairro || '',
        zipCode: data.cep || '',
        sellerResponsible: data.vendedor_responsavel || '',
        relationshipType: data.tipo_relacionamento || 'Nenhum',
        expenseClassification: data.classificacao_despesa || 'Nenhuma',
      };
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return [];
  }
};

// Sanitiza um valor para uso como ID de documento no Firestore (sem '/', espaços etc.)
const sanitizeDocId = (raw: string): string =>
  (raw || '').toString().trim().replace(/[\/\\#?\s]+/g, '-').replace(/^-+|-+$/g, '');

// Mapeia um Customer para o formato do Firestore (inclui campos estendidos da planilha)
const customerToFirestore = (customer: Partial<Customer>): Record<string, any> => {
  const data: Record<string, any> = {};
  if (customer.code !== undefined) data.codigo = customer.code;
  if (customer.cnpjCpf !== undefined) data.cnpj_cpf = customer.cnpjCpf;
  if (customer.name !== undefined) data.razao_social = customer.name;
  if (customer.tradeName !== undefined) data.nome_fantasia = customer.tradeName || '';
  if (customer.contactName !== undefined) data.contato_nome = customer.contactName || '';
  if (customer.phone !== undefined) data.telefone = customer.phone || '';
  if (customer.email !== undefined) data.email = customer.email || '';
  if (customer.city !== undefined) data.cidade = customer.city || '';
  if (customer.state !== undefined) data.estado = customer.state || '';
  if (customer.creditLimit !== undefined) data.limite_credito = customer.creditLimit;
  if (customer.currentBalance !== undefined) data.saldo_atual = customer.currentBalance;
  if (customer.delinquentAmount !== undefined) data.valor_inadimplente = customer.delinquentAmount;
  if (customer.status !== undefined) data.status = customer.status;
  if (customer.lastPurchaseDate !== undefined) data.ultima_compra = customer.lastPurchaseDate || null;
  if (customer.personType !== undefined) data.tipo_pessoa = customer.personType || '';
  if (customer.cellphone !== undefined) data.celular = customer.cellphone || '';
  if (customer.address !== undefined) data.endereco = customer.address || '';
  if (customer.addressNumber !== undefined) data.numero = customer.addressNumber || '';
  if (customer.neighborhood !== undefined) data.bairro = customer.neighborhood || '';
  if (customer.zipCode !== undefined) data.cep = customer.zipCode || '';
  if (customer.sellerResponsible !== undefined) data.vendedor_responsavel = customer.sellerResponsible || '';
  if (customer.relationshipType !== undefined) data.tipo_relacionamento = customer.relationshipType || 'Nenhum';
  if (customer.expenseClassification !== undefined) data.classificacao_despesa = customer.expenseClassification || 'Nenhuma';
  return data;
};

/**
 * Importa clientes em lote usando cod_cliente como chave (UPSERT).
 * - Se já existe um cliente com o mesmo código: atualiza (merge) os campos vindos da planilha,
 *   preservando saldo/inadimplência quando não fornecidos.
 * - Se não existe: cria um novo documento usando o próprio código como ID.
 * Retorna a contagem de adicionados x atualizados.
 */
export const upsertCustomersBatch = async (
  customers: Partial<Customer>[]
): Promise<{ added: number; updated: number; errors: number }> => {
  const db = getFirestoreDb();
  let added = 0, updated = 0, errors = 0;

  // Mapa código -> docId dos clientes já existentes
  const snapshot = await getDocs(collection(db, 'clientes'));
  const codeToId = new Map<string, string>();
  snapshot.forEach((d) => {
    const code = (d.data().codigo || '').toString().trim().toLowerCase();
    if (code) codeToId.set(code, d.id);
  });

  for (const customer of customers) {
    try {
      const code = (customer.code || '').toString().trim();
      if (!code) {
        // Sem código: cria documento novo com ID automático
        await addDoc(collection(db, 'clientes'), customerToFirestore(customer));
        added++;
        continue;
      }
      const existingId = codeToId.get(code.toLowerCase());
      if (existingId) {
        // Atualiza somente os campos vindos da planilha (não sobrescreve saldo/inadimplência)
        const payload = customerToFirestore(customer);
        delete payload.saldo_atual;
        delete payload.valor_inadimplente;
        await setDoc(doc(db, 'clientes', existingId), payload, { merge: true });
        updated++;
      } else {
        // Novo cliente: usa o código como ID do documento
        const newId = sanitizeDocId(code) || `cli_${Date.now()}`;
        await setDoc(doc(db, 'clientes', newId), customerToFirestore(customer), { merge: true });
        codeToId.set(code.toLowerCase(), newId);
        added++;
      }
    } catch (err) {
      console.error('Erro no upsert de cliente:', customer.code, err);
      errors++;
    }
  }

  return { added, updated, errors };
};

// Atualiza apenas os valores de inadimplência/saldo de um cliente (usado após importar títulos)
export const updateCustomerDelinquency = async (
  id: string,
  delinquentAmount: number,
  status: Customer['status']
): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await setDoc(
      doc(db, 'clientes', id),
      { valor_inadimplente: delinquentAmount, status },
      { merge: true }
    );
  } catch (error) {
    console.error('Error updating customer delinquency:', error);
  }
};

export const addCustomer = async (customer: Customer): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const code = (customer.code || '').toString().trim();
    const firestoreData = customerToFirestore(customer);
    if (code) {
      // Usa o código como ID do documento para permitir upsert futuro
      await setDoc(doc(db, 'clientes', sanitizeDocId(code)), firestoreData, { merge: true });
    } else {
      await addDoc(collection(db, 'clientes'), firestoreData);
    }
  } catch (error) {
    console.error('Error adding customer:', error);
    throw error;
  }
};

export const updateCustomer = async (id: string, customer: Partial<Customer>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docRef = doc(db, 'clientes', id);
    await setDoc(docRef, customerToFirestore(customer), { merge: true });
  } catch (error) {
    console.error('Error updating customer:', error);
    throw error;
  }
};

export const deleteCustomer = async (id: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await deleteDoc(doc(db, 'clientes', id));
  } catch (error) {
    console.error('Error deleting customer:', error);
    throw error;
  }
};

// --- Delinquent Titles ---
export const fetchDelinquentTitles = async (): Promise<DelinquentTitle[]> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'titulos_inadimplentes'));
    
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        titleNumber: data.numero_titulo || '',
        customerId: data.cliente_id || '',
        customerCode: data.codigo_cliente || data.customerCode || '',
        customerName: data.cliente_nome || '',
        sellerId: data.vendedor_id || data.sellerId || '',
        sellerCode: data.codigo_vendedor || data.sellerCode || '',
        sellerName: data.vendedor_nome || data.sellerName || '',
        cnpjCpf: data.cnpj_cpf || '',
        issueDate: data.data_emissao || '',
        dueDate: data.data_vencimento || '',
        originalAmount: data.valor_original || 0,
        updatedAmount: data.valor_atualizado || 0,
        daysOverdue: data.dias_atraso || 0,
        agingBucket: data.faixa_aging || '1-30',
        collectionStatus: data.status_cobranca || 'Aguardando',
        notes: data.observacoes || '',
        parcela: data.parcela || '',
        juros: data.juros || 0,
        multa: data.multa || 0,
      };
    });
  } catch (error) {
    console.error('Error fetching delinquent titles:', error);
    return [];
  }
};

// Mapeia um título para o formato do Firestore
const titleToFirestore = (title: Partial<DelinquentTitle>): Record<string, any> => {
  const data: Record<string, any> = {};
  if (title.titleNumber !== undefined) data.numero_titulo = title.titleNumber;
  if (title.customerId !== undefined) data.cliente_id = title.customerId || '';
  if (title.customerCode !== undefined) data.codigo_cliente = title.customerCode || '';
  if (title.customerName !== undefined) data.cliente_nome = title.customerName || '';
  if (title.sellerId !== undefined) data.vendedor_id = title.sellerId || '';
  if (title.sellerCode !== undefined) data.codigo_vendedor = title.sellerCode || '';
  if (title.sellerName !== undefined) data.vendedor_nome = title.sellerName || '';
  if (title.cnpjCpf !== undefined) data.cnpj_cpf = title.cnpjCpf || '';
  if (title.issueDate !== undefined) data.data_emissao = title.issueDate || '';
  if (title.dueDate !== undefined) data.data_vencimento = title.dueDate || '';
  if (title.originalAmount !== undefined) data.valor_original = title.originalAmount;
  if (title.updatedAmount !== undefined) data.valor_atualizado = title.updatedAmount;
  if (title.daysOverdue !== undefined) data.dias_atraso = title.daysOverdue;
  if (title.agingBucket !== undefined) data.faixa_aging = title.agingBucket;
  if (title.collectionStatus !== undefined) data.status_cobranca = title.collectionStatus;
  if (title.notes !== undefined) data.observacoes = title.notes || '';
  if (title.parcela !== undefined) data.parcela = title.parcela || '';
  if (title.juros !== undefined) data.juros = title.juros;
  if (title.multa !== undefined) data.multa = title.multa;
  return data;
};

/**
 * Importa títulos inadimplentes em lote com UPSERT.
 * Chave determinística: cod_cliente + número do título + parcela.
 * Isso evita duplicatas quando a mesma planilha é reimportada.
 */
export const upsertDelinquentTitlesBatch = async (
  titles: Omit<DelinquentTitle, 'id'>[]
): Promise<{ added: number; updated: number; errors: number }> => {
  const db = getFirestoreDb();
  let added = 0, updated = 0, errors = 0;

  // Índice das chaves já existentes -> docId
  const snapshot = await getDocs(collection(db, 'titulos_inadimplentes'));
  const keyToId = new Map<string, string>();
  snapshot.forEach((d) => {
    const data = d.data();
    const key = `${(data.codigo_cliente || '').toString().trim()}|${(data.numero_titulo || '').toString().trim()}|${(data.parcela || '').toString().trim()}`.toLowerCase();
    keyToId.set(key, d.id);
  });

  for (const title of titles) {
    try {
      const daysOverdue = title.daysOverdue > 0 ? title.daysOverdue : calcDaysOverdue(title.dueDate);
      const agingBucket = title.agingBucket || calcAgingBucket(daysOverdue);
      const updatedAmount = title.updatedAmount > 0 ? title.updatedAmount : title.originalAmount;
      const normalized = { ...title, daysOverdue, agingBucket, updatedAmount };

      const key = `${(title.customerCode || '').toString().trim()}|${(title.titleNumber || '').toString().trim()}|${(title.parcela || '').toString().trim()}`.toLowerCase();
      const payload = { ...titleToFirestore(normalized), importado_em: new Date().toISOString() };
      const existingId = keyToId.get(key);

      if (existingId) {
        await setDoc(doc(db, 'titulos_inadimplentes', existingId), payload, { merge: true });
        updated++;
      } else {
        const docRef = await addDoc(collection(db, 'titulos_inadimplentes'), payload);
        keyToId.set(key, docRef.id);
        added++;
      }
    } catch (err) {
      console.error('Erro no upsert de título:', title.titleNumber, err);
      errors++;
    }
  }

  return { added, updated, errors };
};

// Atualiza um título inadimplente (edição manual completa)
export const updateDelinquentTitle = async (id: string, title: Partial<DelinquentTitle>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await setDoc(doc(db, 'titulos_inadimplentes', id), titleToFirestore(title), { merge: true });
  } catch (error) {
    console.error('Error updating delinquent title:', error);
    throw error;
  }
};

// Exclui um título inadimplente
export const deleteDelinquentTitle = async (id: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await deleteDoc(doc(db, 'titulos_inadimplentes', id));
  } catch (error) {
    console.error('Error deleting delinquent title:', error);
    throw error;
  }
};

export const clearAllDelinquentTitles = async (): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'titulos_inadimplentes'));
    const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'titulos_inadimplentes', d.id)));
    await Promise.all(deletePromises);
  } catch (error) {
    console.error('Error clearing delinquent titles:', error);
    throw error;
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
      codigo_cliente: title.customerCode || '',
      cliente_nome: title.customerName,
      vendedor_id: title.sellerId || '',
      codigo_vendedor: title.sellerCode || '',
      vendedor_nome: title.sellerName || '',
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
      codigo_cliente: title.customerCode || '',
      cliente_nome: title.customerName,
      vendedor_id: title.sellerId || '',
      codigo_vendedor: title.sellerCode || '',
      vendedor_nome: title.sellerName || '',
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
        codigo_cliente: title.customerCode || '',
        cliente_nome: title.customerName,
        vendedor_id: title.sellerId || '',
        codigo_vendedor: title.sellerCode || '',
        vendedor_nome: title.sellerName || '',
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

// --- Extrato Financeiro (Conciliação Bancária / Caixa-Tesouraria) ---

const STATEMENT_COLLECTION = 'extrato_financeiro';

const statementToFirestore = (entry: Partial<FinancialStatementEntry>): Record<string, any> => {
  const data: Record<string, any> = {};
  if (entry.origin !== undefined) data.origem = entry.origin;
  if (entry.source !== undefined) data.fonte = entry.source;
  if (entry.sourceLabel !== undefined) data.fonte_label = entry.sourceLabel;
  if (entry.date !== undefined) data.data = entry.date;
  if (entry.year !== undefined) data.ano = entry.year;
  if (entry.monthKey !== undefined) data.mes_chave = entry.monthKey;
  if (entry.description !== undefined) data.descricao = entry.description || '';
  if (entry.clientName !== undefined) data.cliente_beneficiario = entry.clientName || '';
  if (entry.documentType !== undefined) data.tipo_documento = entry.documentType || '';
  if (entry.documentRef !== undefined) data.documento_ref = entry.documentRef || '';
  if (entry.entryAmount !== undefined) data.valor_entrada = entry.entryAmount;
  if (entry.exitAmount !== undefined) data.valor_saida = entry.exitAmount;
  if (entry.balance !== undefined) data.saldo = entry.balance;
  if (entry.notes !== undefined) data.observacoes = entry.notes || '';
  if (entry.dedupeKey !== undefined) data.chave_dedupe = entry.dedupeKey;
  return data;
};

const statementFromFirestore = (id: string, data: any): FinancialStatementEntry => ({
  id,
  origin: data.origem || 'banco',
  source: data.fonte || 'bradesco',
  sourceLabel: data.fonte_label || '',
  date: data.data || '',
  year: data.ano || 0,
  monthKey: data.mes_chave || '',
  description: data.descricao || '',
  clientName: data.cliente_beneficiario || '',
  documentType: data.tipo_documento || '',
  documentRef: data.documento_ref || '',
  entryAmount: data.valor_entrada || 0,
  exitAmount: data.valor_saida || 0,
  balance: data.saldo,
  notes: data.observacoes || '',
  dedupeKey: data.chave_dedupe || '',
  importedAt: data.importado_em || '',
});

// Busca lançamentos de extrato financeiro de um ano (ou todos, se ano omitido)
export const fetchStatementEntries = async (year?: number): Promise<FinancialStatementEntry[]> => {
  try {
    const db = getFirestoreDb();
    const q = year
      ? query(collection(db, STATEMENT_COLLECTION), where('ano', '==', year))
      : collection(db, STATEMENT_COLLECTION);
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => statementFromFirestore(d.id, d.data()))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch (error) {
    console.error('Error fetching statement entries:', error);
    return [];
  }
};

/**
 * Importa lançamentos de extrato (banco ou caixa) com UPSERT usando dedupeKey como chave.
 * Isso permite reimportar o mesmo extrato (ex: reprocessar o mês) sem gerar duplicidade.
 */
export const upsertStatementEntries = async (
  entries: Omit<FinancialStatementEntry, 'id'>[]
): Promise<{ added: number; updated: number; errors: number }> => {
  const db = getFirestoreDb();
  let added = 0, updated = 0, errors = 0;

  const snapshot = await getDocs(collection(db, STATEMENT_COLLECTION));
  const keyToId = new Map<string, string>();
  snapshot.forEach((d) => {
    const key = (d.data().chave_dedupe || '').toString();
    if (key) keyToId.set(key, d.id);
  });

  for (const entry of entries) {
    try {
      const payload = { ...statementToFirestore(entry), importado_em: new Date().toISOString() };
      const existingId = entry.dedupeKey ? keyToId.get(entry.dedupeKey) : undefined;
      if (existingId) {
        await setDoc(doc(db, STATEMENT_COLLECTION, existingId), payload, { merge: true });
        updated++;
      } else {
        const docRef = await addDoc(collection(db, STATEMENT_COLLECTION), payload);
        if (entry.dedupeKey) keyToId.set(entry.dedupeKey, docRef.id);
        added++;
      }
    } catch (err) {
      console.error('Erro no upsert de lançamento de extrato:', entry.dedupeKey, err);
      errors++;
    }
  }

  return { added, updated, errors };
};

export const deleteStatementEntry = async (id: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await deleteDoc(doc(db, STATEMENT_COLLECTION, id));
  } catch (error) {
    console.error('Error deleting statement entry:', error);
    throw error;
  }
};

// Limpa todos os lançamentos de um ano, opcionalmente filtrando por fonte (bradesco/pagseguro/tesouraria)
export const clearStatementEntries = async (year: number, source?: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const q = query(collection(db, STATEMENT_COLLECTION), where('ano', '==', year));
    const snapshot = await getDocs(q);
    const toDelete = snapshot.docs.filter((d) => !source || d.data().fonte === source);
    await Promise.all(toDelete.map((d) => deleteDoc(doc(db, STATEMENT_COLLECTION, d.id))));
  } catch (error) {
    console.error('Error clearing statement entries:', error);
    throw error;
  }
};

// --- Contas a Pagar (RFN006 — Totais Pagos por Credor) ---

const PAYABLES_COLLECTION = 'contas_a_pagar';

const payableFromFirestore = (id: string, data: any): PayableTitle => ({
  id,
  movCode: data.mov_codigo || '',
  companyName: data.empresa_nome || '',
  supplierCode: data.credor_codigo || '',
  supplierName: data.credor_nome || '',
  supplierCustomerId: data.credor_cliente_id || '',
  titleCode: data.titulo_codigo || '',
  parcela: data.parcela || '',
  dueDate: data.data_vencimento || '',
  paymentDate: data.data_pagamento || '',
  year: data.ano || 0,
  monthKey: data.mes_chave || '',
  description: data.historico || '',
  payingAgent: data.agente_pagador || '',
  department: data.departamento || '',
  amount: data.valor || 0,
  status: data.status_baixa || 'Em Aberto',
  reconciledStatementId: data.extrato_id || '',
  reconciledSource: data.extrato_fonte || '',
  reconciledAt: data.baixa_em || '',
  baixaCode: data.baixa_code || '',
  notes: data.observacoes || '',
});

export const fetchPayables = async (year?: number): Promise<PayableTitle[]> => {
  try {
    const db = getFirestoreDb();
    const q = year
      ? query(collection(db, PAYABLES_COLLECTION), where('ano', '==', year))
      : collection(db, PAYABLES_COLLECTION);
    const snapshot = await withTimeout(getDocs(q), 25000, 'buscar contas a pagar');
    return snapshot.docs
      .map((d) => payableFromFirestore(d.id, d.data()))
      .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1));
  } catch (error) {
    console.error('Error fetching payables:', error);
    return [];
  }
};

/**
 * Importa títulos de contas a pagar (RFN006) com UPSERT em lote via writeBatch
 * (blocos de 400 operações — a base tem ~6 mil linhas, gravação 1-a-1 seria inviável).
 * DocId determinístico = mov_<TituloMovCodigo>, então reimportações atualizam
 * os dados cadastrais SEM sobrescrever o status de baixa já aplicado
 * (os campos de baixa não são incluídos no payload de importação).
 */
export const upsertPayablesBatch = async (
  payables: (Omit<PayableTitle, 'id' | 'status' | 'reconciledStatementId' | 'reconciledSource' | 'reconciledAt'> & {
    status?: PayableStatus;
    notes?: string;
    reconciledAt?: string;
  })[]
): Promise<{ count: number; errors: number }> => {
  const db = getFirestoreDb();
  let count = 0, errors = 0;
  const CHUNK = 400;

  for (let i = 0; i < payables.length; i += CHUNK) {
    const chunk = payables.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const p of chunk) {
        const docId = `mov_${sanitizeDocId(p.movCode)}`;
        const payload: Record<string, any> = {
          mov_codigo: p.movCode,
          empresa_nome: p.companyName || '',
          credor_codigo: p.supplierCode || '',
          credor_nome: p.supplierName || '',
          credor_cliente_id: p.supplierCustomerId || '',
          titulo_codigo: p.titleCode || '',
          parcela: p.parcela || '',
          data_vencimento: p.dueDate || '',
          data_pagamento: p.paymentDate || '',
          ano: p.year,
          mes_chave: p.monthKey,
          historico: p.description || '',
          agente_pagador: p.payingAgent || '',
          departamento: p.department || '',
          valor: p.amount,
          importado_em: new Date().toISOString(),
        };

        if (p.status) payload.status_baixa = p.status;
        if (p.notes) payload.observacoes = p.notes;
        if (p.reconciledAt) payload.baixa_em = p.reconciledAt;

        batch.set(
          doc(db, PAYABLES_COLLECTION, docId),
          payload,
          { merge: true }
        );
      }
      await withTimeout(batch.commit(), 20000, `importar lote de contas a pagar (${chunk.length} títulos)`);
      count += chunk.length;
    } catch (err) {
      console.error('Erro no batch de contas a pagar:', err);
      errors += chunk.length;
    }
  }

  return { count, errors };
};

export const updatePayable = async (id: string, fields: Partial<PayableTitle>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const data: Record<string, any> = {};
    if (fields.status !== undefined) data.status_baixa = fields.status;
    if (fields.reconciledStatementId !== undefined) data.extrato_id = fields.reconciledStatementId;
    if (fields.reconciledSource !== undefined) data.extrato_fonte = fields.reconciledSource;
    if (fields.reconciledAt !== undefined) data.baixa_em = fields.reconciledAt;
    if (fields.notes !== undefined) data.observacoes = fields.notes;
    if (fields.baixaCode !== undefined) data.baixa_code = fields.baixaCode;
    if (fields.supplierCustomerId !== undefined) data.credor_cliente_id = fields.supplierCustomerId;
    await withTimeout(setDoc(doc(db, PAYABLES_COLLECTION, id), data, { merge: true }), 12000, 'salvar baixa do título');
  } catch (error) {
    console.error('Error updating payable:', error);
    throw error;
  }
};

// Aplica um conjunto de baixas (automáticas) em lote via writeBatch
export const applyPayablesReconciliation = async (
  updates: { id: string; statementId: string; source: string; notes?: string }[]
): Promise<void> => {
  const db = getFirestoreDb();
  const CHUNK = 400;
  const now = new Date().toISOString();
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const u of chunk) {
      const data: Record<string, any> = {
        status_baixa: 'Baixado Automático',
        extrato_id: u.statementId,
        extrato_fonte: u.source,
        baixa_em: now,
      };
      if (u.notes) {
        data.observacoes = u.notes;
      }
      batch.set(
        doc(db, PAYABLES_COLLECTION, u.id),
        data,
        { merge: true }
      );
    }
    await withTimeout(batch.commit(), 20000, `aplicar conciliação automática (${chunk.length} baixas)`);
  }
};

export const deletePayable = async (id: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await withTimeout(deleteDoc(doc(db, PAYABLES_COLLECTION, id)), 12000, 'excluir título de contas a pagar');
  } catch (error) {
    console.error('Error deleting payable:', error);
    throw error;
  }
};

export const clearPayables = async (year?: number): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const q = year
      ? query(collection(db, PAYABLES_COLLECTION), where('ano', '==', year))
      : collection(db, PAYABLES_COLLECTION);
    const snapshot = await withTimeout(getDocs(q), 25000, 'buscar contas a pagar para zerar');
    const CHUNK = 400;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      docs.slice(i, i + CHUNK).forEach((d) => batch.delete(doc(db, PAYABLES_COLLECTION, d.id)));
      await withTimeout(batch.commit(), 20000, `zerar lote de contas a pagar (${docs.slice(i, i + CHUNK).length} títulos)`);
    }
  } catch (error) {
    console.error('Error clearing payables:', error);
    throw error;
  }
};

// --- Fluxo de Caixa (Planejamento Semanal) ---
const CASHFLOW_COLLECTION = 'fluxo_caixa';

const EMPTY_WEEK = { recebimentos: 0, desembolsos: 0, aportes: 0 };
const emptyWeeks = () => ({
  sem01: { ...EMPTY_WEEK },
  sem02: { ...EMPTY_WEEK },
  sem03: { ...EMPTY_WEEK },
  sem04: { ...EMPTY_WEEK },
  sem05: { ...EMPTY_WEEK },
});

const cashFlowFromFirestore = (id: string, data: any): CashFlowPlan => ({
  id,
  year: Number(data.ano) || 0,
  monthKey: (data.mes || '').toString(),
  saldoInicial: Number(data.saldo_inicial) || 0,
  useSaldoAutomatico: !!data.saldo_automatico,
  realizadoManual: !!data.realizado_manual,
  weeks: { ...emptyWeeks(), ...(data.semanas || {}) },
  pendencias: Array.isArray(data.pendencias) ? data.pendencias : [],
  notes: data.observacoes || '',
  updatedAt: data.atualizado_em || undefined,
});

// Busca todos os planos de fluxo de caixa de um ano (um por mês).
export const fetchCashFlowPlans = async (year?: number): Promise<CashFlowPlan[]> => {
  try {
    const db = getFirestoreDb();
    const q = year
      ? query(collection(db, CASHFLOW_COLLECTION), where('ano', '==', year))
      : collection(db, CASHFLOW_COLLECTION);
    const snapshot = await withTimeout(getDocs(q), 20000, 'buscar planos de fluxo de caixa');
    return snapshot.docs.map((d) => cashFlowFromFirestore(d.id, d.data()));
  } catch (error) {
    console.error('Error fetching cash flow plans:', error);
    return [];
  }
};

// Salva (upsert) o plano previsto de um mês. Doc id = `${ano}_${mes}`.
export const saveCashFlowPlan = async (plan: CashFlowPlan): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docId = `${plan.year}_${plan.monthKey}`;
    const payload = {
      ano: plan.year,
      mes: plan.monthKey,
      saldo_inicial: plan.saldoInicial,
      saldo_automatico: !!plan.useSaldoAutomatico,
      realizado_manual: !!plan.realizadoManual,
      semanas: plan.weeks,
      pendencias: plan.pendencias || [],
      observacoes: plan.notes || '',
      atualizado_em: new Date().toISOString(),
    };
    await withTimeout(setDoc(doc(db, CASHFLOW_COLLECTION, docId), payload, { merge: true }), 12000, 'salvar plano de fluxo de caixa');
  } catch (error) {
    console.error('Error saving cash flow plan:', error);
    throw error;
  }
};

// --- Sellers ---
export const fetchSellers = async (): Promise<Seller[]> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, 'vendedores'));
    if (snapshot.empty) {
      // Seed initial sellers into Firestore so they exist as documents
      for (const seller of INITIAL_SELLERS) {
        const docRef = doc(db, 'vendedores', seller.id);
        await setDoc(docRef, {
          codigo: seller.code,
          nome: seller.name,
          email: seller.email || '',
          telefone: seller.phone || '',
          status: seller.status || 'Ativo',
          criado_em: new Date().toISOString(),
        });
      }
      return INITIAL_SELLERS;
    }
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        code: data.codigo || data.code || '',
        name: data.nome || data.name || '',
        email: data.email || '',
        phone: data.telefone || data.phone || '',
        status: data.status || 'Ativo',
        totalDelinquentAmount: data.total_inadimplente || 0,
      };
    });
  } catch (error) {
    console.error('Error fetching sellers:', error);
    return INITIAL_SELLERS;
  }
};

export const addSeller = async (seller: Seller): Promise<string> => {
  try {
    const db = getFirestoreDb();
    const firestoreData = {
      codigo: seller.code,
      nome: seller.name,
      email: seller.email || '',
      telefone: seller.phone || '',
      status: seller.status || 'Ativo',
      criado_em: new Date().toISOString(),
    };
    const docRef = await addDoc(collection(db, 'vendedores'), firestoreData);
    return docRef.id;
  } catch (error) {
    console.error('Error adding seller:', error);
    throw error;
  }
};

export const updateSeller = async (id: string, seller: Partial<Seller>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docRef = doc(db, 'vendedores', id);
    const firestoreData: any = {};
    if (seller.code !== undefined) firestoreData.codigo = seller.code;
    if (seller.name !== undefined) firestoreData.nome = seller.name;
    if (seller.email !== undefined) firestoreData.email = seller.email;
    if (seller.phone !== undefined) firestoreData.telefone = seller.phone;
    if (seller.status !== undefined) firestoreData.status = seller.status;

    await setDoc(docRef, firestoreData, { merge: true });
  } catch (error) {
    console.error('Error updating seller:', error);
    throw error;
  }
};

export const deleteSeller = async (id: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await deleteDoc(doc(db, 'vendedores', id));
  } catch (error) {
    console.error('Error deleting seller:', error);
    throw error;
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

