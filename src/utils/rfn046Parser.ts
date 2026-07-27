/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * rfn046Parser.ts — Leitor único do relatório RFN046 (Títulos).
 *
 * UM RELATÓRIO, DUAS PONTAS DO CAIXA
 * ==================================
 * O RFN046 é exportado duas vezes no ERP — uma filtrando entradas, outra
 * saídas — e volta com o MESMO cabeçalho de 34 colunas nas duas. A única
 * coluna que diz de que lado o dinheiro anda é `Titulo_MovimentoFinanceiro`:
 *
 *      'R'  →  ENTRADA  →  contas a receber
 *      'P'  →  SAÍDA    →  contas a pagar
 *
 * Este arquivo é o único lugar do sistema que traduz a planilha para o modelo
 * `TituloFinanceiro`. O roteamento entre receber e pagar é feito pela própria
 * coluna, então o gestor não precisa acertar um seletor na tela: subir o
 * arquivo errado na aba errada é impossível, porque a aba não decide nada.
 *
 * O QUE VIRA DINHEIRO E O QUE VIRA COMPROMISSO
 * --------------------------------------------
 * `Titulo_Status = 'Pago'` é a chave do fluxo de caixa automático: o título
 * passa a valer como movimento REALIZADO na `Titulo_DataPagamento`. Qualquer
 * outro status é compromisso e vale como PREVISTO na `Titulo_DataVencimento`.
 * Nenhuma linha é descartada por causa disso — as duas convivem na mesma base,
 * separadas pelo status, porque é exatamente essa separação que permite
 * comparar previsto contra realizado sem contar o mesmo título duas vezes.
 *
 * NENHUMA LINHA SOME EM SILÊNCIO
 * ------------------------------
 * Linhas com problema voltam marcadas `valid: false` com o motivo escrito, para
 * a prévia mostrar o que ficou de fora e por quê. Descartar linha sem avisar é
 * como o total importado passa a divergir do total do ERP sem ninguém notar.
 *
 * VALOR × SALDO — A ARMADILHA
 * ---------------------------
 * `Titulo_Valor` é o valor do título; `Titulo_Saldo` é o que ainda falta
 * liquidar. Num título pago o saldo vem zero — somar saldo para medir o que foi
 * pago dá zero, e somar valor para medir o que falta pagar infla a previsão.
 * Regra do sistema: PAGO usa `amount`; EM ABERTO usa `balance` (com fallback
 * para `amount` quando o ERP manda saldo zerado sem data de pagamento).
 */

import {
  TituloFinanceiro,
  TituloImportSummary,
  TituloMovType,
  TituloPreviewRow,
} from '../types';
import { parseNumberPtBr } from './exportUtils';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Cabeçalho oficial do RFN046, na ordem exportada pelo ERP. */
export const RFN046_EXPECTED_HEADERS = [
  'Titulo_Codigo',
  'Titulo_MovimentoFinanceiro',
  'Titulo_EmpresaCod',
  'Titulo_Numero',
  'Titulo_EmpresaNom',
  'Titulo_PessoaCod',
  'Titulo_PessoaNom',
  'Titulo_NumeroParcela',
  'Titulo_TipoTituloDes',
  'Titulo_DataEmissao',
  'Titulo_DataEntrada',
  'Titulo_DataVencimento',
  'Titulo_DataPagamento',
  'Titulo_Valor',
  'Titulo_FaturaCod',
  'Titulo_NotaFiscalCod',
  'Titulo_NotaFiscalCod_Vinculada',
  'Titulo_NossoNumero',
  'Titulo_Saldo',
  'Titulo_Observacao',
  'Titulo_Status',
  'Titulo_ContaGerencialCod',
  'Titulo_ClassificacaoLancamento',
  'Titulo_MovValorPen',
  'Titulo_DepartamentoCod',
  'Titulo_DepartamentoDes',
  'Titulo_LoteMovimentoCod',
  'Titulo_LoteMovimentoDes',
  'Titulo_AgenteCobradorCod',
  'Titulo_AgenteCobradorDes',
  'Titulo_TipoCobrancaCod',
  'Titulo_TipoCobrancaDes',
  'Titulo_NaturezaOperacaoCod',
  'Titulo_NaturezaOperacaoDes',
] as const;

/** Converte Date / 'YYYY-MM-DD' / 'DD/MM/AAAA' / serial Excel para ISO. */
export const normalizeIsoDate = (raw: any): string => {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Serial do Excel (dias desde 30/12/1899). Só é tratado como data quando cai
  // numa faixa plausível — um código numérico solto não deve virar 1970.
  if (typeof raw === 'number' && raw > 20000 && raw < 60000) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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

export const yearFromIsoDate = (iso: string): number => parseInt((iso || '').slice(0, 4), 10) || 0;

const txt = (v: any): string => (v === null || v === undefined ? '' : v.toString().trim());

/**
 * Normaliza o status do ERP. O relatório às vezes volta 'PAGO', 'Pago' ou
 * 'pago ' com espaço — comparar a string crua faria título pago virar título em
 * aberto, que é o erro que some com dinheiro do realizado.
 */
const isPagoStatus = (status: string): boolean =>
  status
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'pago';

/** Lê o movimento financeiro da linha ('R' ou 'P'), tolerante a caixa e espaço. */
export const readMovType = (raw: any): TituloMovType | '' => {
  const v = txt(raw).toUpperCase();
  if (v === 'R') return 'R';
  if (v === 'P') return 'P';
  return '';
};

export const MOV_LABEL: Record<TituloMovType, string> = {
  R: 'Contas a Receber (entrada)',
  P: 'Contas a Pagar (saída)',
};

/**
 * Converte UMA linha crua da planilha em `TituloFinanceiro` + diagnóstico.
 *
 * `expectedMov` opcional: quando informado, uma linha de movimento diferente é
 * marcada inválida em vez de entrar na base errada. É a trava que impede a
 * planilha de saídas de contaminar o contas a receber numa importação distraída.
 */
export const parseTituloRow = (
  row: Record<string, any>,
  index: number,
  expectedMov?: TituloMovType
): TituloPreviewRow => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const titleCode = txt(row['Titulo_Codigo']);
  const movType = readMovType(row['Titulo_MovimentoFinanceiro']);
  const dueDate = normalizeIsoDate(row['Titulo_DataVencimento']);
  const paymentDate = normalizeIsoDate(row['Titulo_DataPagamento']);
  const erpStatus = txt(row['Titulo_Status']);
  const isPaid = isPagoStatus(erpStatus);

  const amount = Math.abs(parseNumberPtBr(row['Titulo_Valor'] ?? 0));
  const rawBalance = Math.abs(parseNumberPtBr(row['Titulo_Saldo'] ?? 0));
  // Título em aberto com saldo zerado é inconsistência do ERP, não título
  // quitado: sem o fallback para o valor cheio, o compromisso desapareceria da
  // previsão e o gestor planejaria o mês com uma saída a menos.
  const balance = isPaid ? rawBalance : rawBalance > 0 ? rawBalance : amount;

  if (!titleCode) errors.push('Titulo_Codigo (chave única) ausente');
  if (!movType) errors.push('Titulo_MovimentoFinanceiro ausente — não dá para saber se é entrada (R) ou saída (P)');
  if (expectedMov && movType && movType !== expectedMov)
    errors.push(
      `Linha de ${MOV_LABEL[movType]} em um arquivo de ${MOV_LABEL[expectedMov]} — importação bloqueada para não misturar as bases`
    );
  if (!dueDate) errors.push('Titulo_DataVencimento ausente ou inválida');
  if (amount <= 0) errors.push('Titulo_Valor zerado ou inválido');
  if (!erpStatus) errors.push('Titulo_Status ausente — sem ele não há como saber se entra no realizado do caixa');

  // Avisos: não bloqueiam a carga, mas ficam visíveis na prévia.
  if (isPaid && !paymentDate)
    warnings.push('Status "Pago" sem Titulo_DataPagamento — o realizado do caixa vai usar o vencimento');
  if (!isPaid && paymentDate)
    warnings.push(`Status "${erpStatus}" com pagamento em ${paymentDate} — tratado como EM ABERTO (o status manda)`);
  if (isPaid && rawBalance > 0)
    warnings.push(`Título pago ainda com saldo de ${rawBalance.toFixed(2)} — possível baixa parcial no ERP`);
  if (!txt(row['Titulo_PessoaCod']))
    warnings.push('Titulo_PessoaCod ausente — o título não vai se vincular ao cadastro de clientes');

  // Datas de referência: o vencimento manda na competência; o pagamento manda
  // no caixa. Quando o título está pago sem data, o vencimento cobre o buraco.
  const cashDate = isPaid ? paymentDate || dueDate : '';

  const titulo: TituloFinanceiro = {
    id: '',
    dedupeKey: `${movType || 'X'}_${titleCode}`,

    titleCode,
    movType: (movType || 'P') as TituloMovType,
    companyCode: txt(row['Titulo_EmpresaCod']),
    companyName: txt(row['Titulo_EmpresaNom']),
    titleNumber: txt(row['Titulo_Numero']),
    parcela: txt(row['Titulo_NumeroParcela']),
    titleType: txt(row['Titulo_TipoTituloDes']),

    personCode: txt(row['Titulo_PessoaCod']),
    personName: txt(row['Titulo_PessoaNom']),
    customerId: '',

    issueDate: normalizeIsoDate(row['Titulo_DataEmissao']),
    entryDate: normalizeIsoDate(row['Titulo_DataEntrada']),
    dueDate,
    paymentDate,
    year: yearFromIsoDate(dueDate),
    monthKey: monthKeyFromIsoDate(dueDate),
    paidYear: yearFromIsoDate(cashDate),
    paidMonthKey: monthKeyFromIsoDate(cashDate),

    amount,
    balance,
    penaltyAmount: Math.abs(parseNumberPtBr(row['Titulo_MovValorPen'] ?? 0)),

    erpStatus,
    isPaid,

    invoiceCode: txt(row['Titulo_FaturaCod']),
    fiscalNoteCode: txt(row['Titulo_NotaFiscalCod']),
    linkedFiscalNoteCode: txt(row['Titulo_NotaFiscalCod_Vinculada']),
    nossoNumero: txt(row['Titulo_NossoNumero']),
    observation: txt(row['Titulo_Observacao']),

    managementAccount: txt(row['Titulo_ContaGerencialCod']),
    launchClass: txt(row['Titulo_ClassificacaoLancamento']),
    departmentCode: txt(row['Titulo_DepartamentoCod']),
    department: txt(row['Titulo_DepartamentoDes']),
    batchCode: txt(row['Titulo_LoteMovimentoCod']),
    batchDescription: txt(row['Titulo_LoteMovimentoDes']),
    collectionAgentCode: txt(row['Titulo_AgenteCobradorCod']),
    collectionAgent: txt(row['Titulo_AgenteCobradorDes']),
    collectionTypeCode: txt(row['Titulo_TipoCobrancaCod']),
    collectionType: txt(row['Titulo_TipoCobrancaDes']),
    operationNatureCode: txt(row['Titulo_NaturezaOperacaoCod']),
    operationNature: txt(row['Titulo_NaturezaOperacaoDes']),

    status: 'Em Aberto',
  };

  return { rowNumber: index + 1, titulo, valid: errors.length === 0, errors, warnings };
};

/** Converte a planilha inteira (saída de `XLSX.utils.sheet_to_json`). */
export const parseRfn046Rows = (
  rows: any[],
  expectedMov?: TituloMovType
): TituloPreviewRow[] => rows.map((row, idx) => parseTituloRow(row, idx, expectedMov));

/**
 * Descobre sozinho se o arquivo é de entrada ou de saída, olhando a coluna de
 * movimento. Devolve o tipo dominante e se o arquivo veio misturado — um
 * arquivo misto não é erro do sistema, mas o gestor precisa saber antes de
 * gravar, porque metade vai para cada base.
 */
export const detectMovType = (
  rows: any[]
): { movType: TituloMovType | ''; counts: { R: number; P: number; indefinido: number }; mixed: boolean } => {
  const counts = { R: 0, P: 0, indefinido: 0 };
  for (const r of rows) {
    const m = readMovType(r['Titulo_MovimentoFinanceiro']);
    if (m === 'R') counts.R += 1;
    else if (m === 'P') counts.P += 1;
    else counts.indefinido += 1;
  }
  const movType: TituloMovType | '' = counts.R === 0 && counts.P === 0 ? '' : counts.R >= counts.P ? 'R' : 'P';
  return { movType, counts, mixed: counts.R > 0 && counts.P > 0 };
};

/** Confere se a planilha enviada é mesmo um RFN046 antes de tentar interpretá-la. */
export const looksLikeRfn046 = (rows: any[]): boolean => {
  if (!rows || rows.length === 0) return false;
  const keys = new Set(Object.keys(rows[0] || {}));
  return (
    keys.has('Titulo_Codigo') &&
    keys.has('Titulo_MovimentoFinanceiro') &&
    keys.has('Titulo_DataVencimento') &&
    keys.has('Titulo_Status')
  );
};

/** Colunas do layout oficial que faltaram no arquivo enviado. */
export const missingRfn046Headers = (rows: any[]): string[] => {
  if (!rows || rows.length === 0) return [...RFN046_EXPECTED_HEADERS];
  const keys = new Set(Object.keys(rows[0] || {}));
  return RFN046_EXPECTED_HEADERS.filter((h) => !keys.has(h));
};

/**
 * Retrato da importação. É este bloco que o gestor confere contra o rodapé do
 * relatório do ERP antes de mandar gravar — se o total não bate aqui, não
 * adianta procurar a diferença depois, com a base já misturada.
 */
export const summarizeTitulos = (
  preview: TituloPreviewRow[],
  movType: TituloMovType,
  linkedCount = 0
): TituloImportSummary => {
  const valid = preview.filter((p) => p.valid).map((p) => p.titulo);
  const paid = valid.filter((t) => t.isPaid);
  const open = valid.filter((t) => !t.isPaid);
  const dates = valid.map((t) => t.dueDate).filter(Boolean).sort();

  return {
    movType,
    totalRows: preview.length,
    validRows: valid.length,
    invalidRows: preview.length - valid.length,
    paidRows: paid.length,
    openRows: open.length,
    totalAmount: valid.reduce((a, t) => a + t.amount, 0),
    paidAmount: paid.reduce((a, t) => a + t.amount, 0),
    openBalance: open.reduce((a, t) => a + t.balance, 0),
    linkedToCustomer: linkedCount,
    periodStart: dates[0] || '',
    periodEnd: dates[dates.length - 1] || '',
  };
};

/** Compat: as telas antigas chamavam a linha da prévia de `ForecastPreviewRow`. */
export type ForecastPreviewRow = TituloPreviewRow;
export type RawForecastRow = TituloFinanceiro;
