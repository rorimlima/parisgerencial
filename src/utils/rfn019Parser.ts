/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * rfn019Parser.ts — Leitura do relatório RFN019 (Extrato de Conta / Tesouraria).
 *
 * MAPEAMENTO OFICIAL (conferido linha a linha nos dois extratos reais)
 * -------------------------------------------------------------------
 *   Tesouraria_DataCaixa   → data do lançamento
 *   Tesouraria_Observacao  → descrição (o histórico que o operador digitou)
 *   Debito                 → valor PAGO   → saída
 *   Credito                → valor RECEBIDO → entrada
 *   Tesouraria_TipoDocumentoDes → tipo (DINHEIRO em 100% das linhas dos dois arquivos)
 *   ClienteBeneficiario    → cliente/beneficiário
 *   Tesouraria_Codigo      → identificador único do movimento (vira a chave)
 *
 * A ARMADILHA QUE MUDA O RESULTADO DA EMPRESA
 * -------------------------------------------
 * No extrato do Caixa 30108, 797 das 1.950 linhas têm
 * `ContaGerencial_Identificador = 30101` e classificação "CAIXA 301.01
 * TESOURARIA": são TRANSFERÊNCIAS INTERNAS, dinheiro saindo da tesouraria e
 * entrando no caixa da mesma empresa. São R$ 1.203.042,27 dos R$ 1.231.432,27
 * de créditos do arquivo — 97,7%.
 *
 * Somar isso como "Entradas de Tesouraria" no Resultado Financeiro infla o
 * caixa com dinheiro que nenhum cliente pagou: é a mesma nota trocando de
 * bolso. Só em 2026 seriam R$ 42.543,77 de entrada inexistente — e, pior, o
 * caixa 30108 não teve NENHUM recebimento real de cliente em 2026, então o
 * número seria 100% ficção.
 *
 * Por isso todo lançamento é importado (o extrato precisa fechar com o saldo da
 * conta, senão não serve para conciliar), mas os de transferência vêm marcados
 * com `isInternalTransfer` e são excluídos do cálculo de entradas. Regra de
 * detecção: conta gerencial começando em "301" (faixa das contas de
 * caixa/tesouraria) ou classificação citando CAIXA 301/TESOURARIA.
 */

import {
  TESOURARIA_ACCOUNTS,
  buildTesourariaDedupeKey,
  extractCashAccountFromText,
  isCashAccountCode,
  normalizeKeyText,
} from './statementKeys';

export interface Rfn019Row {
  date: string;              // YYYY-MM-DD
  description: string;       // Tesouraria_Observacao
  clientName: string;        // ClienteBeneficiario
  documentType: string;      // DINHEIRO
  documentRef: string;       // Tesouraria_Codigo
  entryAmount: number;       // Credito
  exitAmount: number;        // Debito
  notes: string;
  dedupeKey: string;
  accountCode: string;
  accountLabel: string;
  managementAccount: string;
  isInternalTransfer: boolean;
  counterAccountCode: string;   // conta 301.xx do outro lado da transferência
}

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const monthKeyFromIso = (dateStr: string): string => {
  if (!dateStr) return '';
  const m = parseInt(dateStr.split('-')[1] || '', 10);
  return MONTH_KEYS[m - 1] || '';
};

/**
 * Datas do RFN019 chegam como Date (XLSX com cellDates), serial do Excel, ISO
 * ou DD/MM/AAAA dependendo de como o arquivo foi salvo. Todas viram YYYY-MM-DD.
 */
export const normalizeRfn019Date = (raw: any): string => {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Serial do Excel (dias desde 30/12/1899)
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }
  const s = raw.toString().trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return '';
};

/** Aceita 1.234,56 (pt-BR), 1234.56 e número puro. */
export const toAmount = (raw: any): number => {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Math.abs(raw);
  let s = raw.toString().trim().replace(/R\$\s*/i, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.abs(n);
};

/**
 * Transferência interna entre contas da própria empresa (caixa ↔ tesouraria).
 * Duas evidências independentes, porque o ERP nem sempre preenche as duas:
 * o identificador da conta gerencial na faixa 301xx, ou o texto da
 * classificação citando a conta de destino.
 *
 * Vale para QUALQUER conta 301.xx, não só as já cadastradas. No extrato da
 * tesouraria 30101 as entradas vêm dos caixas 301.07 e 301.10 — o mesmo
 * dinheiro que já saiu de lá. Reconhecer só 301.01 e 301.08 (como era antes)
 * deixava essas entradas passarem como recebimento real.
 */
export const isInternalTransferRow = (managementId: any, managementDesc: any): boolean => {
  if (isCashAccountCode(managementId)) return true;
  const desc = normalizeKeyText(managementDesc);
  return /caixa\s*301|tesouraria\s*301|301\s*\.\s*\d{2}/.test(desc);
};

/**
 * Qual conta de caixa está do outro lado da transferência. Guardar isso é o
 * que permite auditar depois "quanto do extrato 30101 é dinheiro que veio do
 * 30107" sem reabrir a planilha original.
 */
export const counterCashAccountOf = (managementId: any, managementDesc: any): string => {
  const digits = (managementId ?? '').toString().replace(/\D/g, '');
  if (isCashAccountCode(digits)) return digits;
  return extractCashAccountFromText(managementDesc);
};

/**
 * Converte as linhas cruas do RFN019 (já em objeto por nome de coluna) no
 * formato normalizado do Extrato Financeiro.
 *
 * `accountCode` é obrigatório e vem de fora: o relatório não diz de qual conta
 * ele é (ver statementKeys.ts). Passar a conta errada aqui joga o dinheiro na
 * conta errada, então a tela obriga a escolha antes de habilitar a importação.
 */
export const parseRfn019Rows = (rows: any[], accountCode: string): Rfn019Row[] => {
  const account = TESOURARIA_ACCOUNTS[accountCode];
  const accountLabel = account ? account.label : `Conta ${accountCode}`;
  const out: Rfn019Row[] = [];

  for (const row of rows) {
    const date = normalizeRfn019Date(row['Tesouraria_DataCaixa']);
    if (!date) continue;

    const codigo = (row['Tesouraria_Codigo'] ?? '').toString().trim();
    if (!codigo) continue; // sem identificador não há como garantir não-duplicidade

    const credito = toAmount(row['Credito']);
    const debito = toAmount(row['Debito']);

    // Fallback: planilhas antigas do RFN019 traziam só Tesouraria_Valor +
    // Multiplicador (-1 = saída). Mantido para não quebrar arquivos legados.
    let entryAmount = credito;
    let exitAmount = debito;
    if (credito === 0 && debito === 0) {
      const valor = toAmount(row['Tesouraria_Valor']);
      if (valor === 0) continue;
      if (Number(row['Tesouraria_Multiplicador']) < 0) exitAmount = valor;
      else entryAmount = valor;
    }

    const observacao = (row['Tesouraria_Observacao'] ?? '').toString().replace(/\s+/g, ' ').trim();
    const cliente = (row['ClienteBeneficiario'] ?? '').toString().trim();
    const tipoDoc = (row['Tesouraria_TipoDocumentoDes'] || 'DINHEIRO').toString().trim() || 'DINHEIRO';
    const classificacao = (row['Tesouraria_ContagerencialDesClassificacao'] ?? '').toString().trim();
    const transfer = isInternalTransferRow(row['ContaGerencial_Identificador'], classificacao);
    const counterAccountCode = transfer
      ? counterCashAccountOf(row['ContaGerencial_Identificador'], classificacao)
      : '';

    out.push({
      date,
      // A descrição é a observação do operador. Quando o ERP não preencheu,
      // cai para a classificação gerencial — melhor que uma linha em branco na
      // conciliação, e deixa claro do que se trata.
      description: observacao || classificacao || tipoDoc,
      clientName: cliente,
      documentType: tipoDoc,
      documentRef: codigo,
      entryAmount,
      exitAmount,
      notes: classificacao,
      dedupeKey: buildTesourariaDedupeKey(accountCode, codigo),
      accountCode,
      accountLabel,
      managementAccount: classificacao,
      isInternalTransfer: transfer,
      counterAccountCode,
    });
  }

  return out;
};

/** Quebra das transferências internas por conta de contrapartida. */
export interface CounterAccountBreakdown {
  accountCode: string;
  label: string;
  count: number;
  entrada: number;
  saida: number;
}

/**
 * Linhas que repetem data + valor + contrapartida dentro do mesmo arquivo.
 *
 * O `Tesouraria_Codigo` já impede que a MESMA linha do ERP entre duas vezes na
 * base. O que este detector procura é outra coisa: dois códigos diferentes
 * lançando o mesmo valor, no mesmo dia, contra a mesma conta — o padrão típico
 * de um repasse digitado em duplicidade no ERP. Não apagamos nada por conta
 * própria (pode ser um repasse legítimo repetido no mesmo dia); o número é
 * mostrado para o gestor decidir.
 */
export interface DuplicateGroup {
  date: string;
  amount: number;
  counterAccountCode: string;
  count: number;
  refs: string[];
}

export const findDuplicateGroups = (rows: Rfn019Row[]): DuplicateGroup[] => {
  const map = new Map<string, DuplicateGroup>();
  for (const r of rows) {
    const amount = r.entryAmount || r.exitAmount;
    if (amount <= 0) continue;
    const key = `${r.date}|${amount.toFixed(2)}|${r.counterAccountCode}|${r.entryAmount > 0 ? 'E' : 'S'}`;
    const cur = map.get(key);
    if (cur) {
      cur.count += 1;
      cur.refs.push(r.documentRef);
    } else {
      map.set(key, {
        date: r.date,
        amount,
        counterAccountCode: r.counterAccountCode,
        count: 1,
        refs: [r.documentRef],
      });
    }
  }
  return [...map.values()].filter((g) => g.count > 1).sort((a, b) => b.amount * b.count - a.amount * a.count);
};

/** Resumo usado na prévia da importação e no relatório do seeder. */
export const summarizeRfn019 = (rows: Rfn019Row[]) => {
  const real = rows.filter((r) => !r.isInternalTransfer);
  const transfers = rows.filter((r) => r.isInternalTransfer);

  const byCounter = new Map<string, CounterAccountBreakdown>();
  for (const r of transfers) {
    const code = r.counterAccountCode || 'outros';
    const cur = byCounter.get(code) || {
      accountCode: code,
      label: TESOURARIA_ACCOUNTS[code]?.label || (code === 'outros' ? 'Conta não identificada' : `Conta ${code}`),
      count: 0,
      entrada: 0,
      saida: 0,
    };
    cur.count += 1;
    cur.entrada += r.entryAmount;
    cur.saida += r.exitAmount;
    byCounter.set(code, cur);
  }

  const duplicates = findDuplicateGroups(rows);

  return {
    total: rows.length,
    entradasReais: real.reduce((a, r) => a + r.entryAmount, 0),
    saidasReais: real.reduce((a, r) => a + r.exitAmount, 0),
    transferenciasCount: transfers.length,
    transferenciasEntrada: transfers.reduce((a, r) => a + r.entryAmount, 0),
    transferenciasSaida: transfers.reduce((a, r) => a + r.exitAmount, 0),
    porContraparte: [...byCounter.values()].sort((a, b) => b.entrada + b.saida - (a.entrada + a.saida)),
    duplicadosCount: duplicates.reduce((a, g) => a + (g.count - 1), 0),
    duplicadosValor: duplicates.reduce((a, g) => a + g.amount * (g.count - 1), 0),
    duplicados: duplicates.slice(0, 50),
    anos: Array.from(new Set(rows.map((r) => r.date.slice(0, 4)))).sort(),
  };
};
