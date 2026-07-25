/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * sheetParsers — leitura COMPLETA dos cabeçalhos das planilhas do ERP.
 *
 * Princípio: nenhuma coluna é descartada na importação. Mesmo os campos que
 * ainda não têm tela (chave da NF-e, dados de cancelamento, RG/IE, endereço
 * completo, classificações ABC) são lidos e gravados, porque relatório fiscal,
 * auditoria e curva ABC vão precisar deles depois — e reimportar histórico é
 * caro. Os cabeçalhos são reconhecidos por nome normalizado, então mudanças de
 * acentuação, espaços ou maiúsculas no export do ERP não quebram a carga.
 */

import { DelinquentTitle, InvoiceRecord, SaleItem, StockItem } from '../types';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Normaliza o nome de uma coluna: minúsculas, sem acento, sem separadores. */
export const normalizeHeader = (h: string): string =>
  (h || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Constrói um acessor por nome de coluna tolerante a variações. Recebe a linha
 * já convertida em objeto pelo SheetJS e devolve funções de leitura tipadas.
 */
export function createRowReader(row: Record<string, any>) {
  const map = new Map<string, any>();
  Object.entries(row).forEach(([k, v]) => map.set(normalizeHeader(k), v));

  const raw = (...names: string[]): any => {
    for (const n of names) {
      const v = map.get(normalizeHeader(n));
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
  };

  const str = (...names: string[]): string => {
    const v = raw(...names);
    return v === undefined ? '' : String(v).trim();
  };

  const num = (...names: string[]): number => {
    const v = raw(...names);
    if (v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    // aceita "1.234,56" (pt-BR) e "1234.56" (en-US)
    let s = String(v).trim().replace(/[R$\s]/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const bool = (...names: string[]): boolean => {
    const v = raw(...names);
    if (v === undefined) return false;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === 's' || s === 'sim' || s === '1';
  };

  return { raw, str, num, bool, map };
}

/**
 * Converte data do ERP para ISO (YYYY-MM-DD). Aceita:
 *  • Date (quando o SheetJS lê com cellDates)
 *  • 'DD/MM/AAAA' e 'DD/MM/AAAA HH:MM:SS'
 *  • 'AAAA-MM-DD'
 *  • serial numérico do Excel
 * Devolve '' quando não há data (ex.: nota não cancelada).
 */
export function toIsoDate(value: any): string {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && value > 0) {
    // serial do Excel: dias desde 30/12/1899
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    return '';
  }
  const s = String(value).trim();
  if (!s) return '';
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

/** Ano e mês ('jan'..'dez') a partir de uma data ISO. */
export function yearMonthFromIso(iso: string): { year: number; monthKey: string } {
  if (!iso || iso.length < 7) return { year: 0, monthKey: '' };
  const year = parseInt(iso.slice(0, 4), 10) || 0;
  const monthIdx = parseInt(iso.slice(5, 7), 10) - 1;
  return { year, monthKey: MONTH_KEYS[monthIdx] || '' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPR014 — NOTAS FISCAIS (FATURAMENTO)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Colunas esperadas no RPR014. Serve tanto de documentação quanto de checagem
 * de aderência do arquivo enviado (a tela avisa se o layout mudou).
 */
export const RPR014_EXPECTED_HEADERS = [
  'EmpresaCod', 'EmpresaNome', 'NotaFiscalCod', 'NotaFiscalNum', 'NotaFiscalSer',
  'PessoaCod', 'PessoaNome', 'PessoaDocIdent', 'PessoaTipoEndCodRelac',
  'NaturezaOperacaoCod', 'NaturezaOperacaoDescr', 'DepartamentoCod', 'DepartamentoDescr',
  'DepartamentoSigla', 'CondicaoPagamentoCod', 'CondicaoPagamentoDescr', 'TipoDocumentoCod',
  'TipoDocumentoDescr', 'FuncionarioCod', 'FuncionarioNome', 'VendedorCod', 'VendedorNome',
  'SegmentoMercadoCod', 'SegmentoMercadoDescr', 'OSCod', 'NotaFiscalPropria', 'NotaFiscalStatus',
  'DataEmissao', 'DataMovimento', 'NotaFiscalOrigem', 'ChaveNFE', 'ValorTotal',
  'NotaFiscal_Movimento', 'ContaGerencialCod', 'ContaGerencialDescr', 'ContaGerencialIdent',
  'DataCadastro', 'CFOP', 'Total_ICMS', 'Total_ICMSST', 'Total_ISS', 'Total_PIS', 'Total_IPI',
  'Total_COFINS', 'Total_CSLL', 'DataCancelamento', 'UsuNomeCancelamento', 'SeqOrder',
  'PessoaDocRGIE', 'PessoaEndTipoLogrDescr', 'PessoaEndLogradouro', 'PessoaEndNumero',
  'PessoaEndMunicipioDescr', 'PessoaEndEstadoCod', 'ObsCancelamento',
];

export interface ParsedInvoiceSheet {
  records: InvoiceRecord[];
  errors: { rowNumber: number; message: string }[];
  missingHeaders: string[];
  extraHeaders: string[];
  duplicateKeys: number;
}

/**
 * Converte as linhas cruas do RPR014 em InvoiceRecord.
 *
 * A chave de deduplicação é `EmpresaCod|NotaFiscalCod|SeqOrder`. Usar só o
 * número da nota daria colisão: no arquivo real a NF 12633 aparece duas vezes,
 * uma linha de R$150 (CFOP 5102) e outra de R$250 — são valores diferentes da
 * MESMA nota e as duas precisam existir. Já duplicatas verdadeiras (mesma
 * chave repetida dentro do arquivo) são colapsadas, valendo a última ocorrência.
 */
export function parseInvoiceRows(rows: Record<string, any>[]): ParsedInvoiceSheet {
  const records = new Map<string, InvoiceRecord>();
  const errors: ParsedInvoiceSheet['errors'] = [];
  let duplicateKeys = 0;

  const presentHeaders = new Set<string>();
  if (rows.length) Object.keys(rows[0]).forEach((h) => presentHeaders.add(normalizeHeader(h)));
  const missingHeaders = RPR014_EXPECTED_HEADERS.filter((h) => !presentHeaders.has(normalizeHeader(h)));
  const expectedSet = new Set(RPR014_EXPECTED_HEADERS.map(normalizeHeader));
  const extraHeaders = rows.length
    ? Object.keys(rows[0]).filter((h) => !expectedSet.has(normalizeHeader(h)))
    : [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2; // +1 do cabeçalho, +1 porque planilha começa em 1
    try {
      const r = createRowReader(row);

      const invoiceCode = r.str('NotaFiscalCod');
      const companyCode = r.str('EmpresaCod');
      const seqOrder = r.num('SeqOrder');
      if (!invoiceCode) {
        errors.push({ rowNumber, message: 'NotaFiscalCod vazio — linha ignorada' });
        return;
      }

      const issueDate = toIsoDate(r.raw('DataEmissao'));
      if (!issueDate) {
        errors.push({ rowNumber, message: `DataEmissao inválida na nota ${invoiceCode}` });
        return;
      }
      const { year, monthKey } = yearMonthFromIso(issueDate);
      const registerRaw = r.str('DataCadastro');
      const dedupeKey = `${companyCode}|${invoiceCode}|${seqOrder}`;

      const rec: InvoiceRecord = {
        id: dedupeKey,
        dedupeKey,
        companyCode,
        companyName: r.str('EmpresaNome'),
        invoiceCode,
        invoiceNumber: r.str('NotaFiscalNum'),
        invoiceSeries: r.str('NotaFiscalSer'),
        seqOrder,
        personCode: r.str('PessoaCod'),
        personName: r.str('PessoaNome'),
        personDocument: r.str('PessoaDocIdent'),
        personDocRgIe: r.str('PessoaDocRGIE'),
        personAddressRelType: r.str('PessoaTipoEndCodRelac'),
        addressStreetType: r.str('PessoaEndTipoLogrDescr'),
        addressStreet: r.str('PessoaEndLogradouro'),
        addressNumber: r.str('PessoaEndNumero'),
        addressCity: r.str('PessoaEndMunicipioDescr'),
        addressState: r.str('PessoaEndEstadoCod'),
        operationCode: r.str('NaturezaOperacaoCod'),
        operationDescription: r.str('NaturezaOperacaoDescr'),
        departmentCode: r.str('DepartamentoCod'),
        departmentDescription: r.str('DepartamentoDescr'),
        departmentAcronym: r.str('DepartamentoSigla'),
        paymentTermCode: r.str('CondicaoPagamentoCod'),
        paymentTermDescription: r.str('CondicaoPagamentoDescr'),
        documentTypeCode: r.str('TipoDocumentoCod'),
        documentTypeDescription: r.str('TipoDocumentoDescr'),
        marketSegmentCode: r.str('SegmentoMercadoCod'),
        marketSegmentDescription: r.str('SegmentoMercadoDescr'),
        serviceOrderCode: r.str('OSCod'),
        origin: r.str('NotaFiscalOrigem'),
        isOwnInvoice: r.bool('NotaFiscalPropria'),
        status: r.str('NotaFiscalStatus'),
        movement: r.str('NotaFiscal_Movimento'),
        employeeCode: r.str('FuncionarioCod'),
        employeeName: r.str('FuncionarioNome'),
        sellerCode: r.str('VendedorCod'),
        sellerName: r.str('VendedorNome'),
        issueDate,
        movementDate: toIsoDate(r.raw('DataMovimento')),
        registerDate: toIsoDate(r.raw('DataCadastro')),
        registerDateTime: registerRaw,
        cancelDate: toIsoDate(r.raw('DataCancelamento')),
        year,
        monthKey,
        totalValue: r.num('ValorTotal'),
        cfop: r.str('CFOP'),
        nfeKey: r.str('ChaveNFE'),
        totalIcms: r.num('Total_ICMS'),
        totalIcmsSt: r.num('Total_ICMSST'),
        totalIss: r.num('Total_ISS'),
        totalPis: r.num('Total_PIS'),
        totalIpi: r.num('Total_IPI'),
        totalCofins: r.num('Total_COFINS'),
        totalCsll: r.num('Total_CSLL'),
        managerialAccountCode: r.str('ContaGerencialCod'),
        managerialAccountName: r.str('ContaGerencialDescr'),
        managerialAccountIdent: r.str('ContaGerencialIdent'),
        cancelUserName: r.str('UsuNomeCancelamento'),
        cancelNotes: r.str('ObsCancelamento'),
        importedAt: new Date().toISOString(),
      };

      if (records.has(dedupeKey)) duplicateKeys++;
      records.set(dedupeKey, rec);
    } catch (err: any) {
      errors.push({ rowNumber, message: err?.message || 'Erro ao ler a linha' });
    }
  });

  return { records: [...records.values()], errors, missingHeaders, extraHeaders, duplicateKeys };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPR053 — LISTA DE PREÇO (ESTOQUE)
// ═══════════════════════════════════════════════════════════════════════════

export const RPR053_EXPECTED_HEADERS = [
  'Empresa_Nome', 'Estoque_Descricao', 'TipoProduto_Descricao', 'Produto_Codigo',
  'Produto_Descricao', 'ProdutoMarca_Referencia', 'Produto_DescricaoDetalhada',
  'LocalizacaoProduto_Identificador', 'Unidade_Sigla', 'GrupoProduto_Codigo',
  'GrupoLucratividade_Letra', 'ProdutoEstoque_ClasABCLetraPopularidade',
  'ProdutoEstoque_ClasABCLetraVenda', 'ProdutoEstoque_ClasABCLetraEstoque',
  'ProdutoEstoque_QtdeDisponivel', 'ValorPublicoSugerido', 'ValorPublicoSugeridoTotal',
  'ValorGarantia', 'ValorGarantiaTotal', 'ValorReposicao', 'ValorReposicaoTotal',
  'ValorVenda', 'ValorVendaTotal',
];

export interface ParsedStockSheet {
  items: StockItem[];
  errors: { rowNumber: number; message: string }[];
  missingHeaders: string[];
  extraHeaders: string[];
  duplicateKeys: number;
}

/**
 * Converte as linhas do RPR053 em StockItem. Chave = Produto_Codigo.
 *
 * Os totais (`ValorReposicaoTotal`, `ValorVendaTotal`) vêm zerados no export do
 * ERP quando o saldo é zero, então recalculamos custo × quantidade aqui —
 * confere com o arquivo real (R$ 3.064.370,67 a custo) e garante consistência
 * mesmo se o relatório vier sem os totais preenchidos.
 */
export function parseStockRows(rows: Record<string, any>[]): ParsedStockSheet {
  const items = new Map<string, StockItem>();
  const errors: ParsedStockSheet['errors'] = [];
  let duplicateKeys = 0;

  const presentHeaders = new Set<string>();
  if (rows.length) Object.keys(rows[0]).forEach((h) => presentHeaders.add(normalizeHeader(h)));
  const missingHeaders = RPR053_EXPECTED_HEADERS.filter((h) => !presentHeaders.has(normalizeHeader(h)));
  const expectedSet = new Set(RPR053_EXPECTED_HEADERS.map(normalizeHeader));
  const extraHeaders = rows.length
    ? Object.keys(rows[0]).filter((h) => !expectedSet.has(normalizeHeader(h)))
    : [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    try {
      const r = createRowReader(row);
      const productCode = r.str('Produto_Codigo');
      if (!productCode) {
        errors.push({ rowNumber, message: 'Produto_Codigo vazio — linha ignorada' });
        return;
      }

      const companyName = r.str('Empresa_Nome');
      const stockDescription = r.str('Estoque_Descricao');
      const availableQty = r.num('ProdutoEstoque_QtdeDisponivel');
      const replacementCost = r.num('ValorReposicao');
      const salePrice = r.num('ValorVenda');
      const dedupeKey = `${companyName}|${stockDescription}|${productCode}`;

      const item: StockItem = {
        id: productCode,
        dedupeKey,
        companyName,
        stockDescription,
        productTypeDescription: r.str('TipoProduto_Descricao'),
        productCode,
        productDescription: r.str('Produto_Descricao'),
        brandReference: r.str('ProdutoMarca_Referencia'),
        detailedDescription: r.str('Produto_DescricaoDetalhada'),
        locationIdentifier: r.str('LocalizacaoProduto_Identificador'),
        unit: r.str('Unidade_Sigla'),
        productGroupCode: r.str('GrupoProduto_Codigo'),
        profitabilityGroup: r.str('GrupoLucratividade_Letra'),
        abcPopularity: r.str('ProdutoEstoque_ClasABCLetraPopularidade'),
        abcSales: r.str('ProdutoEstoque_ClasABCLetraVenda'),
        abcStock: r.str('ProdutoEstoque_ClasABCLetraEstoque'),
        availableQty,
        publicPrice: r.num('ValorPublicoSugerido'),
        publicPriceTotal: r.num('ValorPublicoSugeridoTotal'),
        warrantyPrice: r.num('ValorGarantia'),
        warrantyPriceTotal: r.num('ValorGarantiaTotal'),
        replacementCost,
        replacementCostTotal: r.num('ValorReposicaoTotal'),
        salePrice,
        salePriceTotal: r.num('ValorVendaTotal'),
        stockValueAtCost: availableQty * replacementCost,
        stockValueAtSale: availableQty * salePrice,
        markupPercent: replacementCost > 0 ? (salePrice / replacementCost - 1) * 100 : 0,
        marginPercent: salePrice > 0 ? ((salePrice - replacementCost) / salePrice) * 100 : 0,
        importedAt: new Date().toISOString(),
      };

      if (items.has(productCode)) duplicateKeys++;
      items.set(productCode, item);
    } catch (err: any) {
      errors.push({ rowNumber, message: err?.message || 'Erro ao ler a linha' });
    }
  });

  return { items: [...items.values()], errors, missingHeaders, extraHeaders, duplicateKeys };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RFN029 — TÍTULOS ATRASADOS POR VENDEDOR (INADIMPLÊNCIA)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cabeçalhos do RFN029, na ordem do export do ERP.
 *
 * Dois detalhes do layout que já causaram erro de leitura e ficam registrados
 * aqui:
 *  • `Lançamento` é um NÚMERO (código interno do lançamento, ex.: 198518), não
 *    uma data. Usá-lo como fallback de "Emissão" gera datas absurdas.
 *  • `Emissão` e `Lançamento` têm acento. Comparação literal de chave falha
 *    quando o arquivo vem com acentuação decomposta (NFD), por isso toda
 *    leitura aqui passa por `normalizeHeader`.
 */
export const RFN029_EXPECTED_HEADERS = [
  'Registro', 'EmpresaNome', 'Vendedor', 'Vencimento', 'Devedor', 'DevedorCpfCnpj',
  'Titulo_Numero', 'Titulo_Parcela', 'Lançamento', 'Emissão', 'Atr', 'Valor', 'Endosso',
  'Titulo_AgenteCobradorDes', 'Tipo', 'Departamento', 'Nro_Pedido', 'Chassi',
  'TituloHistorico_Data', 'TituloHistorico_Codigo', 'TituloHistorico_Observacao',
  'Ocorrencia', 'Juros', 'Multa', 'moeda_descricao', 'TipoCobranca_Descricao',
  'NotaFiscalEletServico_NroNFSe', 'NotaFiscal_Numero', 'VendedorTelefone',
  'Pessoa_CodigoDevedor', 'DevedorTelefone', 'Pessoa_CodigoEndosso', 'EndossoTelefone',
];

export interface ParsedDelinquencySheet {
  titles: Omit<DelinquentTitle, 'id' | 'customerId'>[];
  errors: { rowNumber: number; message: string }[];
  missingHeaders: string[];
  extraHeaders: string[];
  duplicateKeys: number;
  ignoredOccurrenceRows: number; // linhas Registro='O' (histórico), não são títulos
}

/** Faixa de aging a partir dos dias em atraso. */
export const agingFromDays = (days: number): DelinquentTitle['agingBucket'] =>
  days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '>90';

/**
 * Telefone em formato E.164 para link do WhatsApp. O ERP grava "85 988765430"
 * (DDD + número, sem país). Devolve '' quando o que sobra não tem cara de
 * telefone brasileiro — melhor não oferecer o botão do que abrir conversa errada.
 */
export const toWhatsAppNumber = (raw: string): string => {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return '';
};

/** Telefone legível: (85) 98876-5430. Fora do padrão, devolve o original. */
export const formatPhoneBr = (raw: string): string => {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return (raw || '').trim();
};

/** Data + hora do histórico para ISO completo (mantém o horário da ocorrência). */
function toIsoDateTime(value: any): string {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const iso = toIsoDate(value);
  return iso || '';
}

/**
 * Converte o RFN029 em títulos de inadimplência.
 *
 * A coluna `Registro` separa duas naturezas de linha: 'T' é o título em si e
 * 'O' é uma ocorrência do histórico (criação, pagamento, alteração). No arquivo
 * real são 410 títulos para 993 linhas — importar tudo triplicaria a dívida.
 * Só as linhas 'T' viram títulos; as 'O' são contadas e descartadas.
 *
 * Chave de deduplicação: `EmpresaNome|Lançamento`. O `Lançamento` é o código
 * interno do lançamento no ERP e é o único campo realmente único por título —
 * no arquivo real são 410 lançamentos distintos para 410 títulos. Já
 * `Titulo_Numero`+`Titulo_Parcela` NÃO serve: em carnê parcelado o ERP repete o
 * mesmo número de título com parcela sempre 1 (o título 5822 aparece 6 vezes,
 * uma por vencimento mensal), e usá-lo como chave colapsava 24 títulos e
 * escondia R$ 27 mil de dívida. Sem `Lançamento`, cai para
 * `Titulo_Numero|Parcela|Vencimento`. Reimportar o relatório atualiza os
 * títulos no lugar de duplicá-los.
 */
export function parseDelinquencyRows(rows: Record<string, any>[]): ParsedDelinquencySheet {
  const titles = new Map<string, Omit<DelinquentTitle, 'id' | 'customerId'>>();
  const errors: ParsedDelinquencySheet['errors'] = [];
  let duplicateKeys = 0;
  let ignoredOccurrenceRows = 0;

  const presentHeaders = new Set<string>();
  if (rows.length) Object.keys(rows[0]).forEach((h) => presentHeaders.add(normalizeHeader(h)));
  const missingHeaders = RFN029_EXPECTED_HEADERS.filter((h) => !presentHeaders.has(normalizeHeader(h)));
  const expectedSet = new Set(RFN029_EXPECTED_HEADERS.map(normalizeHeader));
  const extraHeaders = rows.length
    ? Object.keys(rows[0]).filter((h) => !expectedSet.has(normalizeHeader(h)))
    : [];

  // Se o arquivo não tiver a coluna Registro (export antigo/manual), todas as
  // linhas são tratadas como título.
  const hasRegistro = presentHeaders.has(normalizeHeader('Registro'));
  const importedAt = new Date().toISOString();
  const today = new Date();

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    try {
      const r = createRowReader(row);

      if (hasRegistro && r.str('Registro').toUpperCase() !== 'T') {
        ignoredOccurrenceRows++;
        return;
      }

      const customerName = r.str('Devedor', 'Cliente', 'cliente_nome', 'Nome');
      if (!customerName) {
        errors.push({ rowNumber, message: 'Devedor vazio — linha ignorada' });
        return;
      }

      const dueDate = toIsoDate(r.raw('Vencimento', 'data_vencimento', 'Due Date'));
      if (!dueDate) {
        errors.push({ rowNumber, message: `Vencimento inválido no título de ${customerName}` });
        return;
      }

      const originalAmount = r.num('Valor', 'valor_original', 'Valor Original');
      if (originalAmount <= 0) {
        errors.push({ rowNumber, message: `Valor inválido no título de ${customerName}` });
        return;
      }

      const companyName = r.str('EmpresaNome', 'Empresa_Nome', 'Empresa');
      const titleNumber = r.str('Titulo_Numero', 'numero_titulo', 'Nº Título', 'Titulo');
      const parcela = r.str('Titulo_Parcela', 'parcela');
      const lancamento = r.str('Lançamento', 'Lancamento', 'lancamento');
      const dedupeKey = lancamento
        ? `${companyName}|${lancamento}`
        : `${companyName}|${titleNumber}|${parcela}|${dueDate}`;

      // "Atr" já vem calculado pelo ERP; se vier vazio, calculamos pelo vencimento.
      let daysOverdue = Math.trunc(r.num('Atr', 'dias_atraso', 'Dias Atraso', 'Atraso'));
      if (!daysOverdue) {
        const due = new Date(`${dueDate}T00:00:00`);
        if (!isNaN(due.getTime())) {
          daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
        }
      }

      const juros = r.num('Juros');
      const multa = r.num('Multa');
      const updatedAmount = r.num('valor_atualizado', 'Valor Atualizado') || originalAmount + juros + multa;

      // Pessoa_CodigoDevedor é a chave que amarra o título ao cadastro de
      // clientes (Customer.code) e alimenta o relatório de dívida do cliente.
      const customerCode = r.str('Pessoa_CodigoDevedor', 'cod_cliente', 'codigo_cliente');

      const title: Omit<DelinquentTitle, 'id' | 'customerId'> = {
        dedupeKey,
        titleNumber: titleNumber || `IMP-${rowNumber}`,
        parcela,
        lancamento,
        companyName,
        customerCode,
        customerName,
        cnpjCpf: r.str('DevedorCpfCnpj', 'cnpj_cpf', 'CNPJ/CPF'),
        customerPhone: r.str('DevedorTelefone'),
        sellerCode: '',
        sellerName: r.str('Vendedor', 'vendedor_nome'),
        sellerPhone: r.str('VendedorTelefone'),
        endossoName: r.str('Endosso'),
        endossoCode: r.str('Pessoa_CodigoEndosso'),
        endossoPhone: r.str('EndossoTelefone'),
        issueDate: toIsoDate(r.raw('Emissão', 'Emissao', 'data_emissao')),
        dueDate,
        originalAmount,
        updatedAmount,
        juros,
        multa,
        daysOverdue,
        agingBucket: agingFromDays(daysOverdue),
        collectionStatus: 'Aguardando',
        collectionAgent: r.str('Titulo_AgenteCobradorDes'),
        paymentType: r.str('Tipo'),
        collectionTypeDescription: r.str('TipoCobranca_Descricao'),
        department: r.str('Departamento'),
        orderNumber: r.str('Nro_Pedido'),
        chassi: r.str('Chassi'),
        currency: r.str('moeda_descricao'),
        nfseNumber: r.str('NotaFiscalEletServico_NroNFSe'),
        invoiceNumber: r.str('NotaFiscal_Numero'),
        lastHistoryDate: toIsoDateTime(r.raw('TituloHistorico_Data')),
        lastHistoryCode: r.str('TituloHistorico_Codigo'),
        occurrence: r.str('Ocorrencia'),
        notes: r.str('TituloHistorico_Observacao', 'observacoes', 'Observações'),
        importedAt,
      };

      if (titles.has(dedupeKey)) duplicateKeys++;
      titles.set(dedupeKey, title);
    } catch (err: any) {
      errors.push({ rowNumber, message: err?.message || 'Erro ao ler a linha' });
    }
  });

  return {
    titles: [...titles.values()],
    errors,
    missingHeaders,
    extraHeaders,
    duplicateKeys,
    ignoredOccurrenceRows,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPR001 — VENDA PRODUTO INTERMEDIÁRIO (VENDAS POR PRODUTO)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cabeçalhos do RPR001, na ordem do export do ERP. Todos os 57 são lidos.
 *
 * Três colunas exigem cuidado e estão documentadas em `SaleItem` (types.ts):
 *  • `NFItem_VlBruto` é UNITÁRIO, não total — e diverge de `NFItem_VlUnit` em
 *    2,3% das linhas. A base de cálculo confiável é `NFItem_VlUnit`.
 *  • `NF_ProdCusto` é o custo TOTAL da linha, não o unitário.
 *  • `NFItem_PercMargemGer` vem como fração (0,73) e `NFItem_PercMargemCont`
 *    como percentual (73,56) — mesmo número, escala 100x diferente.
 */
export const RPR001_EXPECTED_HEADERS = [
  'Tipo', 'NF_NatOperCod', 'NF_Status', 'NFItem_PercNF', 'NaturezaOperacao', 'NF_Origem',
  'NF_OsTipo', 'NF_OsTipoDes', 'NF_VendedorCod', 'NFItem_EstoqueCod', 'NF_Serie', 'NF_Codigo',
  'NF_PessoaCod', 'NF_PessoaNom', 'NF_CondPagCod', 'NF_CondPagDes', 'NF_OsCod', 'NF_OsNum',
  'NFItem_PercDesc', 'NFItem_QtdeEstoque', 'NFItem_VlMargemCont', 'NFItem_VlMargemGer',
  'NFItem_ProdutoDes', 'NF_Numero', 'NF_UsuNomVendedor', 'NFItem_VlDesc', 'NFItem_VlAcres',
  'NFItem_Qtde', 'NFItem_VlUnit', 'NF_EmpresaCod', 'NFItem_ProdutoCod', 'NF_Dataemis',
  'NF_DataMov', 'NFItem_Cod', 'NF_ProdCusto', 'ProdPrecoValor', 'ProdMarcaReferencia',
  'ProdTipoCod', 'ProdLucratLetra', 'ProdEstoqueClasABC', 'EmpNome', 'NFMoedaCod',
  'ValorICMS', 'ValorICMSST', 'ValorICMSDIFAL', 'ValorPisCofins', 'ValorLucroBruto',
  'NFItem_VlTotal', 'ValorPis', 'ValorCofins', 'ValorIss', 'PedidoIntermediario', 'ValorIPI',
  'Os_Valor', 'NFItem_VlBruto', 'NFItem_PercMargemCont', 'NFItem_PercMargemGer',
];

export interface ParsedSalesSheet {
  items: SaleItem[];
  errors: { rowNumber: number; message: string }[];
  missingHeaders: string[];
  extraHeaders: string[];
  duplicateKeys: number;
  /** Linhas descartadas por não terem nota ou item identificáveis. */
  skippedRows: number;
  /** Diagnóstico de integridade do próprio arquivo, exibido na importação. */
  integrity: {
    /** NFItem_VlTotal ≠ VlUnit × Qtde − Desc + Acres */
    totalMismatch: number;
    /** NFItem_VlBruto ≠ NFItem_VlUnit (preço unitário informado divergente) */
    unitPriceMismatch: number;
    /** Margem do ERP não fecha com Total − Custo − Impostos */
    marginMismatch: number;
    marginMismatchAmount: number;
    /** Linhas com custo zerado (margem aparente de 100%) */
    zeroCost: number;
  };
}

/**
 * Converte as linhas do RPR001 em `SaleItem`.
 *
 * A chave `${NF_EmpresaCod}|${NF_Codigo}|${NFItem_Cod}` foi validada contra o
 * arquivo real de 16.593 linhas: nenhuma colisão. Reimportar o mesmo relatório
 * — ou um recorte que se sobreponha — atualiza a linha em vez de duplicá-la.
 *
 * Além de converter, a função MEDE a integridade do arquivo. Isso não é
 * enfeite: o relatório traz três inconsistências sistemáticas (preço unitário
 * divergente, margem que não fecha, custo zerado) e a tela de importação
 * precisa dizer isso ao gestor antes de ele tomar decisão em cima do número.
 */
export function parseSalesRows(rows: Record<string, any>[]): ParsedSalesSheet {
  const items = new Map<string, SaleItem>();
  const errors: ParsedSalesSheet['errors'] = [];
  const integrity = {
    totalMismatch: 0,
    unitPriceMismatch: 0,
    marginMismatch: 0,
    marginMismatchAmount: 0,
    zeroCost: 0,
  };
  let duplicateKeys = 0;
  let skippedRows = 0;

  const presentHeaders = new Set<string>();
  if (rows.length) Object.keys(rows[0]).forEach((h) => presentHeaders.add(normalizeHeader(h)));
  const missingHeaders = RPR001_EXPECTED_HEADERS.filter((h) => !presentHeaders.has(normalizeHeader(h)));
  const expectedSet = new Set(RPR001_EXPECTED_HEADERS.map(normalizeHeader));
  const extraHeaders = rows.length
    ? Object.keys(rows[0]).filter((h) => !expectedSet.has(normalizeHeader(h)))
    : [];

  const importedAt = new Date().toISOString();

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    try {
      const r = createRowReader(row);

      const companyCode = r.str('NF_EmpresaCod');
      const invoiceCode = r.str('NF_Codigo');
      const itemCode = r.str('NFItem_Cod');
      if (!invoiceCode || !itemCode) {
        skippedRows++;
        errors.push({ rowNumber, message: 'NF_Codigo ou NFItem_Cod vazio — linha ignorada' });
        return;
      }

      const dedupeKey = `${companyCode}|${invoiceCode}|${itemCode}`;

      const issueDate = toIsoDate(r.raw('NF_Dataemis'));
      const { year, monthKey } = yearMonthFromIso(issueDate);

      const quantity = r.num('NFItem_Qtde');
      const unitPrice = r.num('NFItem_VlUnit');
      const reportedUnitGross = r.num('NFItem_VlBruto');
      const discountAmount = r.num('NFItem_VlDesc');
      const surchargeAmount = r.num('NFItem_VlAcres');
      const netAmount = r.num('NFItem_VlTotal');
      const lineCost = r.num('NF_ProdCusto');

      // Base de preço: SEMPRE VlUnit × Qtde. Confirmado contra o arquivo real —
      // essa fórmula fecha com NFItem_VlTotal em 100% das 16.593 linhas,
      // enquanto NFItem_VlBruto falha em 377 delas.
      const grossAmount = unitPrice * quantity;

      const taxIcms = r.num('ValorICMS');
      const taxIcmsSt = r.num('ValorICMSST');
      const taxIcmsDifal = r.num('ValorICMSDIFAL');
      const taxPis = r.num('ValorPis');
      const taxCofins = r.num('ValorCofins');
      const taxPisCofins = r.num('ValorPisCofins');
      const taxIss = r.num('ValorIss');
      const taxIpi = r.num('ValorIPI');
      // ValorPisCofins já é ValorPis + ValorCofins (conferido: zero divergência
      // no arquivo). Somar os três triplicaria o PIS/COFINS.
      const taxTotal = taxIcms + taxIcmsSt + taxIcmsDifal + taxPisCofins + taxIss + taxIpi;

      const marginErp = r.num('NFItem_VlMargemCont');
      const marginCalculated = netAmount - lineCost - taxTotal;

      const item: SaleItem = {
        id: dedupeKey,
        dedupeKey,
        companyCode,
        companyName: r.str('EmpNome'),
        invoiceCode,
        invoiceNumber: r.str('NF_Numero'),
        invoiceSeries: r.str('NF_Serie'),
        itemCode,
        status: r.str('NF_Status'),
        movementType: r.str('Tipo'),
        origin: r.str('NF_Origem'),
        operationCode: r.str('NF_NatOperCod'),
        operationDescription: r.str('NaturezaOperacao'),
        currencyCode: r.str('NFMoedaCod'),
        itemSharePercent: r.num('NFItem_PercNF'),
        osCode: r.str('NF_OsCod'),
        osNumber: r.str('NF_OsNum'),
        osType: r.str('NF_OsTipo'),
        osTypeDescription: r.str('NF_OsTipoDes'),
        osValue: r.num('Os_Valor'),
        intermediateOrder: r.str('PedidoIntermediario'),
        customerCode: r.str('NF_PessoaCod'),
        customerName: r.str('NF_PessoaNom'),
        paymentTermCode: r.str('NF_CondPagCod'),
        paymentTermDescription: r.str('NF_CondPagDes'),
        sellerCode: r.str('NF_VendedorCod'),
        sellerName: r.str('NF_UsuNomVendedor'),
        productCode: r.str('NFItem_ProdutoCod'),
        productDescription: r.str('NFItem_ProdutoDes'),
        brandReference: r.str('ProdMarcaReferencia'),
        productTypeCode: r.str('ProdTipoCod'),
        profitabilityLetter: r.str('ProdLucratLetra'),
        abcStock: r.str('ProdEstoqueClasABC'),
        stockCode: r.str('NFItem_EstoqueCod'),
        listPrice: r.num('ProdPrecoValor'),
        issueDate,
        movementDate: toIsoDate(r.raw('NF_DataMov')),
        year,
        monthKey,
        quantity,
        stockQuantity: r.num('NFItem_QtdeEstoque'),
        unitPrice,
        reportedUnitGross,
        grossAmount,
        discountAmount,
        discountPercent: grossAmount > 0 ? (discountAmount / grossAmount) * 100 : 0,
        reportedDiscountPercent: r.num('NFItem_PercDesc'),
        surchargeAmount,
        netAmount,
        lineCost,
        unitCost: quantity > 0 ? lineCost / quantity : lineCost,
        taxIcms,
        taxIcmsSt,
        taxIcmsDifal,
        taxPis,
        taxCofins,
        taxPisCofins,
        taxIss,
        taxIpi,
        taxTotal,
        marginErp,
        marginErpManagerial: r.num('NFItem_VlMargemGer'),
        grossProfitErp: r.num('ValorLucroBruto'),
        marginPercentErp: r.num('NFItem_PercMargemCont'),
        marginCalculated,
        marginPercentCalculated: netAmount > 0 ? (marginCalculated / netAmount) * 100 : 0,
        marginDivergence: marginErp - marginCalculated,
        importedAt,
      };

      // ── Diagnóstico de integridade do arquivo ──────────────────────────────
      if (Math.abs(netAmount - (grossAmount - discountAmount + surchargeAmount)) > 0.01) {
        integrity.totalMismatch++;
      }
      if (reportedUnitGross > 0 && Math.abs(reportedUnitGross - unitPrice) > 0.01) {
        integrity.unitPriceMismatch++;
      }
      if (Math.abs(item.marginDivergence) > 0.01) {
        integrity.marginMismatch++;
        integrity.marginMismatchAmount += item.marginDivergence;
      }
      if (lineCost <= 0 && netAmount > 0) integrity.zeroCost++;

      if (items.has(dedupeKey)) duplicateKeys++;
      items.set(dedupeKey, item);
    } catch (err: any) {
      errors.push({ rowNumber, message: err?.message || 'Erro ao ler a linha' });
    }
  });

  return {
    items: [...items.values()],
    errors,
    missingHeaders,
    extraHeaders,
    duplicateKeys,
    skippedRows,
    integrity,
  };
}
