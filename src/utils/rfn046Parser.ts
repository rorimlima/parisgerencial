/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * rfn046Parser.ts — Leitura do relatório RFN046 (Títulos).
 *
 * O QUE ESTE RELATÓRIO É — E O QUE ELE NÃO É
 * ------------------------------------------
 * O RFN046 lista títulos EM ABERTO: compromissos autorizados que ainda não
 * foram pagos. É o oposto do RFN006 (Totais Pagos por Credor), que só mostra o
 * que já saiu do caixa. Por isso as duas bases vivem separadas no sistema:
 *   RFN006 → `contas_a_pagar`           → desembolso REALIZADO
 *   RFN046 → `contas_a_pagar_previsao`  → desembolso PREVISTO
 *
 * Juntar as duas em uma tabela só faria o mesmo compromisso ser contado duas
 * vezes no fluxo de caixa — uma como previsão e outra como realizado — que é
 * exatamente o erro que infla o desembolso do mês e derruba o saldo projetado.
 *
 * O NÚMERO QUE IMPORTA PARA O CAIXA
 * ---------------------------------
 * `Titulo_Saldo` (não `Titulo_Valor`): é o que resta a pagar depois de
 * eventuais amortizações parciais. Nos arquivos íntegros os dois batem, mas
 * quando divergem é o saldo que representa a saída futura de dinheiro.
 * A data que ancora essa saída na semana é `Titulo_DataVencimento`.
 *
 * FILTRO DE SEGURANÇA
 * -------------------
 * Linhas com `Titulo_DataPagamento` preenchida já foram quitadas e viram
 * ruído na previsão — são marcadas como inválidas na prévia com o motivo
 * explícito, para o gestor ver que foram descartadas de propósito.
 */

import { parseNumberPtBr } from './exportUtils';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Converte Date / 'YYYY-MM-DD' / 'DD/MM/AAAA' para ISO 'YYYY-MM-DD'. */
export const normalizeIsoDate = (raw: any): string => {
  if (!raw && raw !== 0) return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = raw.toString().trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return '';
};

export const monthKeyFromIsoDate = (iso: string): string => {
  const m = parseInt((iso || '').slice(5, 7), 10);
  return isNaN(m) || m < 1 || m > 12 ? '' : MONTH_KEYS[m - 1];
};

export interface RawForecastRow {
  titleCode: string;
  movType: string;
  companyCode: string;
  companyName: string;
  titleNumber: string;
  supplierCode: string;
  supplierName: string;
  parcela: string;
  titleType: string;
  issueDate: string;
  entryDate: string;
  dueDate: string;
  paymentDate: string;
  amount: number;
  balance: number;
  status: string;
  invoiceCode: string;
  fiscalNoteCode: string;
  nossoNumero: string;
  observation: string;
  managementAccount: string;
  launchClass: string;
  departmentCode: string;
  department: string;
  collectionAgent: string;
  collectionType: string;
  operationNature: string;
  year: number;
  monthKey: string;
}

export type ForecastPreviewRow = RawForecastRow & {
  rowNumber: number;
  valid: boolean;
  errors: string[];
};

const txt = (v: any): string => (v === null || v === undefined ? '' : v.toString().trim());

/**
 * Converte as linhas cruas da planilha (saída do XLSX.utils.sheet_to_json) em
 * linhas validadas, prontas para a prévia. Nenhuma linha é descartada aqui: as
 * inválidas voltam marcadas com o motivo, para o gestor ver o que ficou de fora.
 */
export const parseRfn046Rows = (rows: any[]): ForecastPreviewRow[] => {
  return rows.map((row, idx) => {
    const errors: string[] = [];

    const titleCode = txt(row['Titulo_Codigo']);
    const movType = txt(row['Titulo_MovimentoFinanceiro']);
    const dueDate = normalizeIsoDate(row['Titulo_DataVencimento']);
    const paymentDate = normalizeIsoDate(row['Titulo_DataPagamento']);
    const amount = Math.abs(parseNumberPtBr(row['Titulo_Valor'] ?? 0));
    const rawBalance = Math.abs(parseNumberPtBr(row['Titulo_Saldo'] ?? 0));
    // Saldo zerado com valor preenchido = título já baixado no ERP; o que
    // sobra a pagar é zero e ele não deve entrar na previsão.
    const balance = rawBalance > 0 ? rawBalance : 0;

    if (!titleCode) errors.push('Titulo_Codigo (chave única) ausente');
    if (!dueDate) errors.push('Titulo_DataVencimento ausente ou inválida');
    if (balance <= 0) errors.push('Titulo_Saldo zerado — título já quitado ou sem saldo a pagar');
    if (paymentDate) errors.push(`Título já pago em ${paymentDate} — pertence ao RFN006, não à previsão`);
    if (movType && movType.toUpperCase() !== 'P')
      errors.push(`Movimento financeiro "${movType}" não é de pagamento (esperado "P")`);

    return {
      rowNumber: idx + 1,
      titleCode,
      movType,
      companyCode: txt(row['Titulo_EmpresaCod']),
      companyName: txt(row['Titulo_EmpresaNom']),
      titleNumber: txt(row['Titulo_Numero']),
      supplierCode: txt(row['Titulo_PessoaCod']),
      supplierName: txt(row['Titulo_PessoaNom']),
      parcela: txt(row['Titulo_NumeroParcela']),
      titleType: txt(row['Titulo_TipoTituloDes']),
      issueDate: normalizeIsoDate(row['Titulo_DataEmissao']),
      entryDate: normalizeIsoDate(row['Titulo_DataEntrada']),
      dueDate,
      paymentDate,
      amount,
      balance,
      status: txt(row['Titulo_Status']),
      invoiceCode: txt(row['Titulo_FaturaCod']),
      fiscalNoteCode: txt(row['Titulo_NotaFiscalCod']),
      nossoNumero: txt(row['Titulo_NossoNumero']),
      observation: txt(row['Titulo_Observacao']),
      managementAccount: txt(row['Titulo_ContaGerencialCod']),
      launchClass: txt(row['Titulo_ClassificacaoLancamento']),
      departmentCode: txt(row['Titulo_DepartamentoCod']),
      department: txt(row['Titulo_DepartamentoDes']),
      collectionAgent: txt(row['Titulo_AgenteCobradorDes']),
      collectionType: txt(row['Titulo_TipoCobrancaDes']),
      operationNature: txt(row['Titulo_NaturezaOperacaoDes']),
      year: parseInt(dueDate.slice(0, 4), 10) || 0,
      monthKey: monthKeyFromIsoDate(dueDate),
      valid: errors.length === 0,
      errors,
    };
  });
};

/**
 * Confere se a planilha enviada é mesmo um RFN046. Sem isso, subir o RFN006
 * por engano geraria uma base de previsão inteira com saldo zero e vencimentos
 * vazios — e o gestor só descobriria olhando o total previsto zerado.
 */
export const looksLikeRfn046 = (rows: any[]): boolean => {
  if (!rows || rows.length === 0) return false;
  const keys = Object.keys(rows[0] || {});
  return keys.includes('Titulo_Codigo') && keys.includes('Titulo_DataVencimento') && keys.includes('Titulo_Saldo');
};
