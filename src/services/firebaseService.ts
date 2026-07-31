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
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { firebaseConfig } from '../firebaseConfig';
import { statementDocId } from '../utils/statementKeys';
import { planFromFirestore, planToFirestore, normalizePlan } from '../utils/cashFlowPersistence';
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
  CashFlowPlan
} from '../types';

let firestoreDb: ReturnType<typeof getFirestore>;
let firebaseAuthInstance: ReturnType<typeof getAuth>;

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
  firebaseAuthInstance = getAuth(app);
  return firestoreDb;
};

export const getFirestoreDb = () => {
  if (!firestoreDb) {
    return initFirebase();
  }
  return firestoreDb;
};

export const getFirebaseAuthInstance = () => {
  if (!firebaseAuthInstance) {
    initFirebase();
  }
  return firebaseAuthInstance;
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

        // Se para este ano temos uma definição oficial mestre (como 2026, com Jan-Jun
        // oficiais e Jul-Dez zerados), e o mês em initialForYear é zerado oficialmente
        // mas o Firestore tem um lançamento manual divergente, limpa/reseta o documento
        // (mesma proteção já aplicada em fetchEconomicData para o Resultado Econômico)
        if (initialForYear && initialForYear[mes_chave]) {
          const official = initialForYear[mes_chave];
          const firestoreEntradas = (data.entradas_bancos || 0) + (data.entradas_tesouraria || 0);
          if (official.totalEntradas === 0 && firestoreEntradas > 0) {
            saveFinancialLaunch(year, mes_chave, official).catch(() => {});
            return;
          }
        }

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

    // Para o ano de 2026, forçamos a sincronização dos dados mestres oficiais (Jan-Jun
    // preenchidos, Jul-Dez zerados) no Firestore — corrige lançamentos manuais incorretos
    // feitos via LaunchModal e evita que voltem a divergir da planilha oficial.
    if (year === 2026 && initialForYear) {
      ALL_MONTHS.forEach((mKey) => {
        if (initialForYear[mKey]) {
          result[mKey] = { ...initialForYear[mKey] };
          saveFinancialLaunch(year, mKey, initialForYear[mKey]).catch(() => {});
        }
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

  // PERFORMANCE: antes cada cliente era gravado com um `await setDoc` dentro do
  // laço — uma viagem de rede por registro. Importar 4.000 clientes eram 4.000
  // idas ao servidor em série (minutos de espera e a tela "congelada"). Agora as
  // gravações são acumuladas e enviadas em lotes de 450, o teto do Firestore:
  // as mesmas 4.000 linhas viram ~9 requisições.
  const pending: { id: string; data: Record<string, any> }[] = [];

  for (const customer of customers) {
    try {
      const code = (customer.code || '').toString().trim();
      if (!code) {
        // Sem código não há chave para deduplicar: cria com ID automático.
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
        pending.push({ id: existingId, data: payload });
        updated++;
      } else {
        // Novo cliente: usa o código como ID do documento
        const newId = sanitizeDocId(code) || `cli_${Date.now()}`;
        pending.push({ id: newId, data: customerToFirestore(customer) });
        codeToId.set(code.toLowerCase(), newId);
        added++;
      }
    } catch (err) {
      console.error('Erro no upsert de cliente:', customer.code, err);
      errors++;
    }
  }

  const BATCH_SIZE = 450;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    try {
      const batch = writeBatch(db);
      pending.slice(i, i + BATCH_SIZE).forEach((p) =>
        batch.set(doc(db, 'clientes', p.id), p.data, { merge: true })
      );
      await batch.commit();
    } catch (err) {
      console.error('Erro ao gravar lote de clientes:', err);
      errors += Math.min(BATCH_SIZE, pending.length - i);
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
        // RFN029 — campos completos do relatório de títulos atrasados
        dedupeKey: data.chave_dedupe || '',
        lancamento: data.lancamento || '',
        companyName: data.empresa_nome || '',
        customerPhone: data.devedor_telefone || '',
        sellerPhone: data.vendedor_telefone || '',
        endossoName: data.endosso_nome || '',
        endossoCode: data.endosso_codigo || '',
        endossoPhone: data.endosso_telefone || '',
        collectionAgent: data.agente_cobrador || '',
        paymentType: data.tipo_pagamento || '',
        collectionTypeDescription: data.tipo_cobranca || '',
        department: data.departamento || '',
        orderNumber: data.nro_pedido || '',
        chassi: data.chassi || '',
        currency: data.moeda || '',
        nfseNumber: data.nfse_numero || '',
        invoiceNumber: data.nota_fiscal_numero || '',
        lastHistoryDate: data.historico_data || '',
        lastHistoryCode: data.historico_codigo || '',
        occurrence: data.ocorrencia || '',
        importedAt: data.importado_em || '',
        // Vínculo com acordo de negociação (gravado pelo agreementsService)
        agreementId: data.acordo_id || '',
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
  // RFN029 — nenhuma coluna do relatório é descartada na gravação
  if (title.dedupeKey !== undefined) data.chave_dedupe = title.dedupeKey || '';
  if (title.lancamento !== undefined) data.lancamento = title.lancamento || '';
  if (title.companyName !== undefined) data.empresa_nome = title.companyName || '';
  if (title.customerPhone !== undefined) data.devedor_telefone = title.customerPhone || '';
  if (title.sellerPhone !== undefined) data.vendedor_telefone = title.sellerPhone || '';
  if (title.endossoName !== undefined) data.endosso_nome = title.endossoName || '';
  if (title.endossoCode !== undefined) data.endosso_codigo = title.endossoCode || '';
  if (title.endossoPhone !== undefined) data.endosso_telefone = title.endossoPhone || '';
  if (title.collectionAgent !== undefined) data.agente_cobrador = title.collectionAgent || '';
  if (title.paymentType !== undefined) data.tipo_pagamento = title.paymentType || '';
  if (title.collectionTypeDescription !== undefined) data.tipo_cobranca = title.collectionTypeDescription || '';
  if (title.department !== undefined) data.departamento = title.department || '';
  if (title.orderNumber !== undefined) data.nro_pedido = title.orderNumber || '';
  if (title.chassi !== undefined) data.chassi = title.chassi || '';
  if (title.currency !== undefined) data.moeda = title.currency || '';
  if (title.nfseNumber !== undefined) data.nfse_numero = title.nfseNumber || '';
  if (title.invoiceNumber !== undefined) data.nota_fiscal_numero = title.invoiceNumber || '';
  if (title.lastHistoryDate !== undefined) data.historico_data = title.lastHistoryDate || '';
  if (title.lastHistoryCode !== undefined) data.historico_codigo = title.lastHistoryCode || '';
  if (title.occurrence !== undefined) data.ocorrencia = title.occurrence || '';
  if (title.agreementId !== undefined) data.acordo_id = title.agreementId || '';
  return data;
};

/**
 * Chave de identidade de um título no Firestore.
 *
 * Preferimos `chave_dedupe` (empresa|lançamento), que vem do parser do RFN029 e
 * é única de verdade. O fallback `cod_cliente|título|parcela` só existe para
 * títulos gravados antes desse campo e para lançamentos manuais — ele colapsa
 * carnês parcelados (o ERP repete o mesmo número de título com parcela 1 em
 * todas as parcelas), então não serve como chave principal.
 */
const titleDedupeKey = (t: { dedupeKey?: string; customerCode?: string; titleNumber?: string; parcela?: string; dueDate?: string }): string => {
  if (t.dedupeKey && t.dedupeKey.trim()) return t.dedupeKey.trim().toLowerCase();
  return `${(t.customerCode || '').toString().trim()}|${(t.titleNumber || '').toString().trim()}|${(t.parcela || '').toString().trim()}|${(t.dueDate || '').toString().trim()}`.toLowerCase();
};

/**
 * Importa títulos inadimplentes em lote com UPSERT.
 * Chave determinística: veja `titleDedupeKey`.
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
    keyToId.set(
      titleDedupeKey({
        dedupeKey: data.chave_dedupe,
        customerCode: data.codigo_cliente,
        titleNumber: data.numero_titulo,
        parcela: data.parcela,
        dueDate: data.data_vencimento,
      }),
      d.id
    );
  });

  // Mesma otimização aplicada aos clientes: acumula e grava em lotes em vez de
  // uma requisição por título. Títulos novos recebem um ID determinístico
  // derivado da própria chave (cliente|título|parcela) — assim, além de rápido,
  // fica impossível criar duas vezes o mesmo título se a importação for repetida.
  const pending: { id: string; data: Record<string, any> }[] = [];

  for (const title of titles) {
    try {
      const daysOverdue = title.daysOverdue > 0 ? title.daysOverdue : calcDaysOverdue(title.dueDate);
      const agingBucket = title.agingBucket || calcAgingBucket(daysOverdue);
      const updatedAmount = title.updatedAmount > 0 ? title.updatedAmount : title.originalAmount;
      const normalized = { ...title, daysOverdue, agingBucket, updatedAmount };

      const key = titleDedupeKey(title);
      const payload = { ...titleToFirestore(normalized), importado_em: new Date().toISOString() };
      const existingId = keyToId.get(key);

      if (existingId) {
        pending.push({ id: existingId, data: payload });
        updated++;
      } else {
        const newId = sanitizeDocId(key) || `tit_${Date.now()}_${added}`;
        pending.push({ id: newId, data: payload });
        keyToId.set(key, newId);
        added++;
      }
    } catch (err) {
      console.error('Erro no upsert de título:', title.titleNumber, err);
      errors++;
    }
  }

  const BATCH_SIZE = 450;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    try {
      const batch = writeBatch(db);
      pending.slice(i, i + BATCH_SIZE).forEach((p) =>
        batch.set(doc(db, 'titulos_inadimplentes', p.id), p.data, { merge: true })
      );
      await batch.commit();
    } catch (err) {
      console.error('Erro ao gravar lote de títulos:', err);
      errors += Math.min(BATCH_SIZE, pending.length - i);
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
  // RFN019: conta de caixa e marcação de transferência interna. Sem estes
  // campos não dá para separar Caixa 30108 de Tesouraria 30101, nem excluir
  // remanejo entre contas do cálculo de entradas.
  if (entry.accountCode !== undefined) data.conta_codigo = entry.accountCode || '';
  if (entry.accountLabel !== undefined) data.conta_label = entry.accountLabel || '';
  if (entry.managementAccount !== undefined) data.conta_gerencial = entry.managementAccount || '';
  if (entry.isInternalTransfer !== undefined) data.transferencia_interna = !!entry.isInternalTransfer;
  if (entry.counterAccountCode !== undefined) data.conta_contrapartida = entry.counterAccountCode || '';
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
  accountCode: data.conta_codigo || '',
  accountLabel: data.conta_label || '',
  managementAccount: data.conta_gerencial || '',
  isInternalTransfer: !!data.transferencia_interna,
  counterAccountCode: data.conta_contrapartida || '',
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
 * Importa lançamentos de extrato (banco ou caixa) com UPSERT por dedupeKey.
 *
 * PERFORMANCE — por que este código mudou (não voltar atrás)
 * ----------------------------------------------------------
 * A versão anterior fazia UMA leitura da coleção inteira e depois UM `await
 * setDoc/addDoc` por lançamento, em série. Importar os dois extratos RFN019
 * (2.125 linhas) custava a leitura de tudo que já existia + 2.125 idas ao
 * servidor, uma esperando a outra: minutos de tela travada, e a cota de leitura
 * do Firestore indo embora à toa.
 *
 * Agora o ID do documento é DETERMINÍSTICO, derivado da própria chave
 * (`statementDocId`). Com isso o upsert é resolvido pelo banco: `set(...,
 * {merge:true})` cria se não existe e atualiza se existe. Não é preciso ler
 * nada antes para saber quem já está lá, e as escritas vão em lotes de 400 —
 * as mesmas 2.125 linhas viram 6 requisições.
 *
 * Compatibilidade com o que já foi gravado: os lançamentos antigos (Bradesco,
 * PagSeguro) foram criados com `addDoc`, ou seja, ID aleatório. Se
 * simplesmente gravássemos no ID novo, o mesmo lançamento passaria a existir
 * duas vezes — o problema que estamos justamente evitando. Por isso, antes de
 * gravar, buscamos os documentos APENAS dos anos que estão sendo importados
 * (`where('ano','in',...)`, não a coleção toda) e reaproveitamos o ID antigo
 * quando a chave já existir lá. Conforme os extratos vão sendo reimportados, a
 * base migra sozinha para os IDs determinísticos.
 */
export const upsertStatementEntries = async (
  entries: Omit<FinancialStatementEntry, 'id'>[]
): Promise<{ added: number; updated: number; errors: number }> => {
  const db = getFirestoreDb();
  if (entries.length === 0) return { added: 0, updated: 0, errors: 0 };

  let added = 0, updated = 0, errors = 0;

  // Mapa chave→ID apenas dos anos envolvidos, para reaproveitar documentos
  // legados de ID aleatório. `in` do Firestore aceita até 30 valores; acima
  // disso (cenário irreal para extrato) cai para a leitura completa.
  const years = Array.from(new Set(entries.map((e) => e.year).filter(Boolean)));
  const legacyKeyToId = new Map<string, string>();
  try {
    const ref = collection(db, STATEMENT_COLLECTION);
    const snap = await withTimeout(
      getDocs(years.length > 0 && years.length <= 30 ? query(ref, where('ano', 'in', years)) : ref),
      25000,
      'ler extrato existente para conciliar chaves'
    );
    snap.forEach((d) => {
      const key = (d.data().chave_dedupe || '').toString();
      if (key) legacyKeyToId.set(key, d.id);
    });
  } catch (err) {
    // Sem o índice de legados seguimos com IDs determinísticos: o pior caso é
    // um lançamento antigo continuar existindo em paralelo, nunca perder dado.
    console.warn('Não foi possível indexar o extrato existente; seguindo com IDs determinísticos.', err);
  }

  const importedAt = new Date().toISOString();
  const CHUNK = 400;

  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const payload = { ...statementToFirestore(entry), importado_em: importedAt };
        const legacyId = entry.dedupeKey ? legacyKeyToId.get(entry.dedupeKey) : undefined;
        const docId = legacyId || statementDocId(entry.dedupeKey);
        if (legacyId) updated++;
        else added++;
        batch.set(doc(db, STATEMENT_COLLECTION, docId), payload, { merge: true });
      }
      await withTimeout(batch.commit(), 20000, `gravar lote de extrato (${chunk.length} lançamentos)`);
    } catch (err) {
      console.error('Erro ao gravar lote de extrato:', err);
      errors += chunk.length;
      added -= chunk.length;
    }
  }

  return { added: Math.max(0, added), updated, errors };
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

// --- Títulos Financeiros (RFN046) ---
//
// Contas a Receber e Contas a Pagar MUDARAM DE ENDEREÇO: vivem em
// `services/titulosService.ts`, com um modelo único (`TituloFinanceiro`) para
// os dois lados do movimento. O que existia aqui eram duas implementações
// paralelas — uma para o RFN006 (pago) e outra para o RFN046 (previsto) — que
// liam relatórios diferentes e por isso nunca fechavam entre si.
//
// Continuam aqui só os utilitários compartilhados pelo restante do arquivo.

/**
 * Tira do payload as chaves vazias. Com `merge: true`, mandar '' MESCLA o vazio
 * por cima do que já estava gravado: uma reimportação em que o ERP veio sem o
 * departamento apagaria o departamento que já existia no banco. Enviando só o
 * que tem conteúdo, o import ACRESCENTA e ATUALIZA, nunca esvazia. Campos
 * numéricos (inclusive zero) continuam passando.
 */
const stripEmpty = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
};

/**
 * Lê os IDs já existentes de uma coleção. Uma leitura a mais por importação,
 * em troca de saber quantos registros são NOVOS e quantos foram ATUALIZADOS —
 * informação que o gestor precisa para confiar que a base não duplicou.
 */
const fetchExistingIds = async (collectionName: string): Promise<Set<string>> => {
  try {
    const db = getFirestoreDb();
    const snapshot = await withTimeout(getDocs(collection(db, collectionName)), 25000, `conferir base ${collectionName}`);
    return new Set(snapshot.docs.map((d) => d.id));
  } catch (error) {
    console.error(`Não foi possível conferir os IDs existentes de ${collectionName}:`, error);
    return new Set();
  }
};

// Silencia o aviso de "declarado e não usado" enquanto nenhuma outra seção
// deste arquivo precisar do índice de IDs existentes.
void fetchExistingIds;
void stripEmpty;


// --- Fluxo de Caixa (Planejamento Semanal) ---
const CASHFLOW_COLLECTION = 'fluxo_caixa';

// Leitura e escrita compartilham o MESMO normalizador (ver
// utils/cashFlowPersistence.ts). Quando os dois lados tinham cada um a sua
// versão do formato, o banco acumulava documentos com campos faltando e o
// valor digitado pelo gestor "voltava" ao antigo na leitura seguinte.
const cashFlowFromFirestore = (id: string, data: any): CashFlowPlan =>
  planFromFirestore(id, data);

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

/**
 * Salva o plano do mês. Doc id = `${ano}_${mes}` — uma gravação, um documento.
 *
 * A gravação é ABSOLUTA: `setDoc` SEM `merge`. Isso é uma correção deliberada,
 * não descuido.
 *
 * Antes usava-se `{ merge: true }`, e no Firestore merge faz DEEP MERGE em
 * mapas aninhados. `semanas` é um mapa: todo sub-campo ausente no objeto novo
 * mantinha o valor ANTIGO gravado. Na prática, o gestor corrigia um
 * recebimento, saía da tela, voltava, e encontrava o número velho de volta —
 * sem erro, sem aviso, sem rastro. Fluxo de caixa que reescreve sozinho o que
 * foi digitado não é fonte de decisão; é armadilha.
 *
 * Com `merge` desligado + payload normalizado (todas as semanas com todos os
 * campos, sempre), o documento no banco passa a ser o espelho exato da tela.
 * O que sumiu da tela some do banco. O que está na tela está no banco.
 *
 * Devolve o plano normalizado com o carimbo de `updatedAt` para que o chamador
 * atualize o estado local sem precisar reler a coleção inteira — uma gravação
 * de fluxo de caixa custa 1 write e 0 reads.
 */
export const saveCashFlowPlan = async (plan: CashFlowPlan): Promise<CashFlowPlan> => {
  try {
    const db = getFirestoreDb();
    const docId = `${plan.year}_${plan.monthKey}`;
    const updatedAt = new Date().toISOString();
    const payload = planToFirestore(plan, updatedAt);

    await withTimeout(
      setDoc(doc(db, CASHFLOW_COLLECTION, docId), payload),
      12000,
      'salvar plano de fluxo de caixa'
    );

    return { ...normalizePlan(plan), id: docId, updatedAt };
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
        role: data.funcao || 'analista',
        avatar: data.avatar || undefined,
        status: data.status || 'active',
        createdAt: data.criado_em || undefined,
      } as User;
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
};

export const addUser = async (user: Partial<User>): Promise<string> => {
  try {
    const db = getFirestoreDb();
    const emailNorm = (user.email || '').trim().toLowerCase();
    if (!emailNorm) throw new Error('E-mail é obrigatório');

    const docId = emailNorm.replace(/[^a-z0-9]/g, '_');

    const payload = {
      nome: user.name || '',
      email: emailNorm,
      funcao: user.role || 'analista',
      avatar: user.avatar || null,
      status: (user as any).status || 'active',
      criado_em: new Date().toISOString(),
    };

    await setDoc(doc(db, 'usuarios', docId), payload, { merge: true });

    try {
      await setDoc(
        doc(db, 'usuarios_index', emailNorm),
        {
          email: emailNorm,
          funcao: user.role || 'analista',
          nome: user.name || '',
          atualizado_em: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (idxErr) {
      console.warn('Nao foi possivel atualizar usuarios_index:', idxErr);
    }

    return docId;
  } catch (error) {
    console.error('Error adding user:', error);
    throw error;
  }
};

export const updateUser = async (id: string, user: Partial<User>): Promise<void> => {
  try {
    const db = getFirestoreDb();
    const docRef = doc(db, 'usuarios', id);
    const firestoreData: any = {
      atualizado_em: new Date().toISOString(),
    };
    if (user.name !== undefined) firestoreData.nome = user.name;
    if (user.email !== undefined) firestoreData.email = user.email.trim().toLowerCase();
    if (user.role !== undefined) firestoreData.funcao = user.role;
    if (user.avatar !== undefined) firestoreData.avatar = user.avatar;
    if ((user as any).status !== undefined) firestoreData.status = (user as any).status;

    await setDoc(docRef, firestoreData, { merge: true });

    if (user.email) {
      const emailNorm = user.email.trim().toLowerCase();
      try {
        await setDoc(
          doc(db, 'usuarios_index', emailNorm),
          {
            email: emailNorm,
            funcao: user.role || 'analista',
            nome: user.name || '',
            atualizado_em: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (idxErr) {
        console.warn('Nao foi possivel sincronizar usuarios_index:', idxErr);
      }
    }
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

export const deleteUser = async (id: string, email?: string): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await deleteDoc(doc(db, 'usuarios', id));

    if (email) {
      const emailNorm = email.trim().toLowerCase();
      try {
        await deleteDoc(doc(db, 'usuarios_index', emailNorm));
      } catch (idxErr) {
        console.warn('Nao foi possivel remover de usuarios_index:', idxErr);
      }
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

// --- Autenticação (Firebase Auth) ---
// A coleção `usuarios` no Firestore é a fonte da verdade de QUEM pode acessar
// o sistema e com qual perfil (role) — isso nunca deve vir de um campo enviado
// pelo formulário de login.
//
// Exceção: o MASTER_ADMIN_EMAIL abaixo é o dono do sistema e tem acesso de
// administrador garantido em código. Isso evita o problema do "ovo e galinha"
// (ninguém consegue entrar para cadastrar o primeiro admin) e mantém o acesso
// do dono mesmo se a coleção `usuarios` estiver vazia, indisponível ou se a
// cota do Firestore estourar.
//
// SEGURANÇA: o e-mail é lido de variável de ambiente (VITE_MASTER_ADMIN_EMAIL)
// para não ficar exposto no repositório Git público. Defina no arquivo .env
// local e nas variáveis de ambiente do Firebase Hosting.
export const MASTER_ADMIN_EMAIL = (
  import.meta.env.VITE_MASTER_ADMIN_EMAIL || ''
).trim().toLowerCase();

const buildMasterAdmin = (name?: string | null, avatar?: string | null): User => ({
  id: 'master_admin',
  name: name || 'Administrador Master',
  email: MASTER_ADMIN_EMAIL,
  role: 'admin',
  avatar: avatar || undefined,
});

/**
 * Garante que o admin master também exista na coleção `usuarios`, para que ele
 * apareça nas telas de gestão de usuários do sistema. É "best-effort": se a
 * escrita falhar (cota excedida, offline, permissão), o login NÃO é bloqueado,
 * porque o acesso do master já está garantido em código.
 */
const ensureMasterAdminRegistered = async (name?: string | null, avatar?: string | null): Promise<void> => {
  try {
    const db = getFirestoreDb();
    await setDoc(
      doc(db, 'usuarios', 'master_admin'),
      {
        nome: name || 'Rorim (Administrador Master)',
        email: MASTER_ADMIN_EMAIL,
        funcao: 'admin',
        avatar: avatar || null,
        master: true,
        atualizado_em: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Nao foi possivel registrar o admin master no Firestore (acesso segue liberado):', err);
  }
};

/**
 * Decide se um e-mail autenticado pode entrar e com qual perfil.
 * Master admin sempre entra. Os demais precisam constar em `usuarios`.
 */
const resolveAuthorizedUser = async (
  email: string,
  displayName?: string | null,
  photoURL?: string | null
): Promise<User> => {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail === MASTER_ADMIN_EMAIL) {
    await ensureMasterAdminRegistered(displayName, photoURL);
    return buildMasterAdmin(displayName, photoURL);
  }

  const users = await fetchUsers();
  const authorizedUser = users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!authorizedUser) {
    throw new Error(
      `A conta ${normalizedEmail} nao tem acesso a este sistema. Peca ao administrador para cadastrar seu e-mail.`
    );
  }
  return {
    ...authorizedUser,
    avatar: photoURL || authorizedUser.avatar,
  };
};

/**
 * Login com a conta Google (Gmail). Método principal de acesso ao sistema.
 * Depois do popup do Google, o e-mail retornado ainda passa pela checagem de
 * autorização — ter uma conta Google válida não basta para entrar.
 */
export const signInWithGoogleAccount = async (): Promise<User> => {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let credential;
  try {
    credential = await signInWithPopup(auth, provider);
  } catch (err: any) {
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      throw new Error('Login cancelado.');
    }
    if (err.code === 'auth/popup-blocked') {
      throw new Error('O navegador bloqueou a janela do Google. Libere os pop-ups para este site e tente novamente.');
    }
    if (err.code === 'auth/unauthorized-domain') {
      throw new Error('Este dominio nao esta autorizado no Firebase Auth. Avise o administrador.');
    }
    throw new Error(err.message || 'Erro ao entrar com o Google.');
  }

  const { email, displayName, photoURL } = credential.user;
  if (!email) {
    await signOut(auth);
    throw new Error('Nao foi possivel obter o e-mail da sua conta Google.');
  }

  try {
    return await resolveAuthorizedUser(email, displayName, photoURL);
  } catch (authErr) {
    // Conta Google válida, mas sem permissão no sistema: desloga para não
    // deixar uma sessão do Firebase Auth ativa sem acesso.
    await signOut(auth);
    throw authErr;
  }
};

// Login por e-mail/senha (mantido como alternativa ao Google).
//
// Estratégia de migração sem backend/Admin SDK: como os usuários existentes
// nunca tiveram senha real cadastrada, o primeiro login bem-sucedido de um
// e-mail autorizado "reivindica" a conta — a senha digitada nesse primeiro
// acesso vira a senha definitiva a partir daí. Login funciona assim:
//   1. Tenta CRIAR a conta no Firebase Auth com o e-mail/senha digitados.
//      Se o e-mail ainda não tinha conta, a criação funciona e o acesso é
//      liberado (primeiro acesso).
//   2. Se a criação falhar com 'auth/email-already-in-use', a conta já existe
//      — faz o login normal (senha precisa bater com a já cadastrada).
//
// ORDEM: AUTENTICA PRIMEIRO, AUTORIZA DEPOIS
// ------------------------------------------
// Esta função já perguntou "esse e-mail está autorizado?" ANTES de autenticar.
// Duas razões para ter invertido:
//
//   1. SEGURANÇA DO BANCO. Com as regras do Firestore apertadas
//      (firestore.rules), a coleção `usuarios` só é legível por quem já está
//      autenticado. Perguntar antes do login agora devolveria lista vazia e
//      ninguém entraria.
//   2. VAZAMENTO DE CADASTRO. Consultar `usuarios` sem sessão permitia a
//      qualquer pessoa descobrir, e-mail por e-mail, quem tem acesso ao
//      sistema e com qual papel — e a mensagem de erro diferenciada
//      ("não tem acesso" x "senha incorreta") transformava o login num
//      enumerador de contas.
//
// A ordem nova é: autentica no Firebase Auth → confere autorização →
// se não estiver autorizado, DESLOGA na hora. Ter conta no projeto deixa de
// significar ter acesso ao sistema; é o mesmo desenho já usado no login
// com Google.
export const signInAuthorizedUser = async (email: string, password: string): Promise<User> => {
  const normalizedEmail = email.trim().toLowerCase();
  const auth = getFirebaseAuthInstance();

  try {
    await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  } catch (createErr: any) {
    if (createErr.code !== 'auth/email-already-in-use') {
      if (createErr.code === 'auth/weak-password') {
        throw new Error('Primeiro acesso: use uma senha com pelo menos 6 caracteres.');
      }
      if (createErr.code === 'auth/invalid-email') {
        throw new Error('E-mail invalido.');
      }
      throw new Error(createErr.message || 'Erro ao autenticar. Tente novamente.');
    }
    // Conta já existe — segue com login normal
    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (signInErr: any) {
      if (signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/invalid-credential') {
        throw new Error('Senha incorreta.');
      }
      if (signInErr.code === 'auth/too-many-requests') {
        throw new Error('Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
      }
      throw new Error(signInErr.message || 'Erro ao autenticar. Tente novamente.');
    }
  }

  // Autenticado. Só agora a autorização é consultada — e uma sessão sem
  // permissão nunca fica de pé.
  try {
    return await resolveAuthorizedUser(normalizedEmail);
  } catch (authErr) {
    await signOut(auth).catch(() => undefined);
    throw authErr;
  }
};

export const signOutUser = async (): Promise<void> => {
  const auth = getFirebaseAuthInstance();
  await signOut(auth);
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

