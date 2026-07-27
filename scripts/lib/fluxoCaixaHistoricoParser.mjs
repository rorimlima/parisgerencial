/**
 * Extrai os planos mensais de Fluxo de Caixa da planilha legada
 * "FLUXO DE CAIXA (1).xlsx" ("Fluxo de caixa " — com espaço no final, é o
 * nome real da aba) para o mesmo formato que `saveCashFlowPlan` grava no
 * Firestore (coleção `fluxo_caixa`; ver src/services/firebaseService.ts).
 *
 * ESTRUTURA DA PLANILHA (um bloco por mês, empilhados verticalmente)
 * -------------------------------------------------------------------------
 *   "Período" (col A) / nome do mês (col B)
 *   "Saldo inicial R$" (col A) / valor (col B) — às vezes fórmula somando o
 *       saldo final realizado do mês anterior (ex.: "=R74")
 *   "PENDÊNCIAS" ou "TOTAL PENDÊNCIAS" (col E) — lista de obrigações em
 *       aberto entre esta linha e a linha "SEMANA 01". Formato inconsistente
 *       entre meses (é planilha manual, não banco de dados):
 *         - às vezes descrição em E + valor numérico em F (ex.: maio/2025)
 *         - às vezes descrição em E + valor numérico em G (meses de 2026)
 *         - às vezes só uma string com o valor embutido, tipo
 *           "R$26.000 - ADEFABIO", sem coluna numérica própria
 *         - a coluna I ("RESERVA") às vezes também carrega uma pendência de
 *           verdade (ex.: "R$20.000 - ALUGUEL"), não só o rótulo da seção
 *   "SEMANA 01".."SEMANA 05" com sub-colunas PREVISTO/REALIZADO:
 *       sem01 = B(prev)/C(real), sem02 = E/F, sem03 = H/I, sem04 = K/L,
 *       sem05 = N/O — mesmo layout nas 5 semanas em todo bloco.
 *   "Recebimentos" / "Desembolsos" (linhas, col A) com os valores acima.
 *   "APORTES" (linha) — um único valor por semana (não há aporte
 *       previsto x realizado separados; o schema do app também não separa).
 *   "Geração de caixa" / "Saldo de caixa" — DERIVADOS, não gravados: o app
 *       recalcula os dois a partir de Recebimentos/Desembolsos/Aportes.
 *
 * ANO DE CADA BLOCO
 * -------------------------------------------------------------------------
 * A planilha não repete o ano em cada bloco — os meses simplesmente se
 * sucedem (Março, Abril, ..., Dezembro, Fevereiro, Março, ...). O ano muda
 * exatamente quando o mês "volta no calendário" em relação ao bloco
 * anterior (Dezembro → Fevereiro). `anoInicial` é o ano do PRIMEIRO bloco
 * (Março) — quem chama precisa confirmar esse ano com o gestor, porque não
 * há como derivá-lo da planilha sozinha.
 *
 * Usa os VALORES CALCULADOS (cache do Excel), não reavalia fórmulas: células
 * como "=24701.95+37500+27500+10775.5+16250" ou "=R74" já têm o resultado
 * gravado no arquivo pelo Excel/Sheets na hora de salvar, e é isso que a
 * biblioteca `xlsx` expõe em `cell.v`.
 */
import * as XLSX from 'xlsx';
import fs from 'fs';

const MONTH_MAP = {
  JANEIRO: 'jan', FEVEREIRO: 'fev', MARÇO: 'mar', ABRIL: 'abr', MAIO: 'mai', JUNHO: 'jun',
  JULHO: 'jul', AGOSTO: 'ago', SETEMBRO: 'set', OUTUBRO: 'out', NOVEMBRO: 'nov', DEZEMBRO: 'dez',
};
const MONTH_ORDER = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

const HEADER_LABELS = new Set([
  'PENDÊNCIAS', 'TOTAL PENDÊNCIAS', 'RESERVA', 'RESERVA ',
  'DESCRIÇÃO RECEBIMENTO', 'DESCRIÇÃO PAGAMENTO',
]);

const extractEmbeddedAmount = (text) => {
  const m = text.match(/R\$\s*([\d.,]+)/i);
  if (!m) return 0;
  const s = m[1].replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

/**
 * @param {string} filePath caminho do .xlsx
 * @param {number} anoInicial ano do primeiro bloco (mês "Março") — CONFIRMAR
 *   com o gestor antes de gravar; a planilha não guarda essa informação.
 * @param {string} sheetName nome exato da aba (padrão: a aba principal)
 */
export function extractFluxoCaixaHistorico(filePath, anoInicial, sheetName = 'Fluxo de caixa ') {
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);

  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellFormula: true });
  const ws = workbook.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Aba "${sheetName}" não encontrada. Abas disponíveis: ${workbook.SheetNames.join(', ')}`);
  }
  const ref = XLSX.utils.decode_range(ws['!ref']);

  const cellAt = (r, c) => ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
  const val = (r, c) => {
    const cl = cellAt(r, c);
    return cl ? cl.v : undefined;
  };
  const num = (r, c) => {
    const v = val(r, c);
    return typeof v === 'number' ? v : 0;
  };
  const str = (r, c) => {
    const v = val(r, c);
    return typeof v === 'string' ? v.trim() : '';
  };

  const periodRows = [];
  for (let r = ref.s.r + 1; r <= ref.e.r + 1; r++) {
    if (str(r, 1) === 'Período') periodRows.push(r);
  }
  if (periodRows.length === 0) {
    throw new Error('Nenhum bloco mensal encontrado (procurei "Período" na coluna A).');
  }

  const monthLabels = periodRows.map((r) => str(r, 2).toUpperCase());
  const years = (() => {
    const out = [];
    let year = anoInicial;
    let prevIdx = -1;
    for (const m of monthLabels) {
      const idx = MONTH_ORDER.indexOf(m);
      if (prevIdx !== -1 && idx <= prevIdx) year += 1;
      out.push(year);
      prevIdx = idx;
    }
    return out;
  })();

  return periodRows.map((periodRow, idx) => {
    const monthLabel = monthLabels[idx];
    const monthKey = MONTH_MAP[monthLabel] || '';
    const year = years[idx];
    const nextPeriodRow = periodRows[idx + 1] || ref.e.r + 2;

    let saldoInicialRow = null, recebRow = null, desembRow = null, aportesRow = null, semanaHeaderRow = null;
    for (let r = periodRow; r < nextPeriodRow; r++) {
      const label = str(r, 1);
      if (label === 'Saldo inicial R$') saldoInicialRow = r;
      if (label === 'Recebimentos' && !recebRow) recebRow = r;
      if (label === 'Desembolsos' && !desembRow) desembRow = r;
      if (label.startsWith('APORTES') && !aportesRow) aportesRow = r;
      if (str(r, 2) === 'SEMANA 01' && !semanaHeaderRow) semanaHeaderRow = r;
    }

    const saldoInicial = saldoInicialRow ? num(saldoInicialRow, 2) : 0;

    const weekCols = [
      ['sem01', 2, 3], ['sem02', 5, 6], ['sem03', 8, 9], ['sem04', 11, 12], ['sem05', 14, 15],
    ];
    const weeks = {};
    for (const [key, prevCol, realCol] of weekCols) {
      weeks[key] = {
        recebimentos: recebRow ? num(recebRow, prevCol) : 0,
        desembolsos: desembRow ? num(desembRow, prevCol) : 0, // já negativo na planilha
        aportes: aportesRow ? num(aportesRow, prevCol) : 0,
        recebRealizado: recebRow ? num(recebRow, realCol) : 0,
        desembRealizado: desembRow ? num(desembRow, realCol) : 0,
      };
    }

    const pendencias = [];
    if (saldoInicialRow && semanaHeaderRow) {
      for (let r = saldoInicialRow; r < semanaHeaderRow; r++) {
        for (const col of [5, 9]) {
          const cl = cellAt(r, col);
          if (!cl || cl.f) continue; // pula fórmulas (linhas de total)
          const text = str(r, col);
          if (!text || HEADER_LABELS.has(text.toUpperCase())) continue;

          let valor = 0;
          for (const vcol of [6, 7]) {
            const vcl = cellAt(r, vcol);
            const v = val(r, vcol);
            if (vcl && !vcl.f && typeof v === 'number' && v > 0) {
              valor = v;
              break;
            }
          }
          if (valor === 0) valor = extractEmbeddedAmount(text);
          if (valor > 0 || text) pendencias.push({ descricao: text, valor });
        }
      }
    }

    return {
      id: `${year}_${monthKey}`,
      year,
      monthKey,
      monthLabel,
      saldoInicial,
      useSaldoAutomatico: false,
      realizadoManual: true,
      weeks,
      pendencias,
    };
  });
}
