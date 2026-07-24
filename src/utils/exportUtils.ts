/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return 'R$ 0,00';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '0,00%';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function parseNumberPtBr(valueStr: string | number): number {
  if (typeof valueStr === 'number') return valueStr;
  if (!valueStr) return 0;

  let cleaned = valueStr.toString().trim().replace('R$', '').replace('%', '').trim();
  // Handle PT-BR decimal format: 1.234.567,89 -> 1234567.89
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  summaryCards?: { label: string; value: string; color?: string }[];
  headers: string[];
  rows: (string | number)[][];
  filename?: string;
}

export const MONTH_NAMES_FULL: Record<string, string> = {
  jan: 'Janeiro', fev: 'Fevereiro', mar: 'Março', abr: 'Abril',
  mai: 'Maio', jun: 'Junho', jul: 'Julho', ago: 'Agosto',
  set: 'Setembro', out: 'Outubro', nov: 'Novembro', dez: 'Dezembro',
};

export const MONTH_KEYS_LIST = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface CorporatePdfSection {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
  columnStyles?: Record<number, any>;
}

export interface CorporatePdfOptions {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  summaryCards?: { label: string; value: string; color?: string }[];
  sections: CorporatePdfSection[];
  orientation?: 'landscape' | 'portrait';
  filename?: string;
}

export function exportCorporatePdf(options: CorporatePdfOptions) {
  const orientation = options.orientation || 'landscape';
  const doc = new jsPDF({
    orientation: orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = orientation === 'landscape' ? 297 : 210;
  const pageHeight = orientation === 'landscape' ? 210 : 297;

  const primaryDark: [number, number, number] = [30, 41, 59]; // Slate 800
  const goldAccent: [number, number, number] = [193, 154, 107]; // Paris Dakar Gold

  // Top Header Banner
  doc.setFillColor(...primaryDark);
  doc.rect(0, 0, pageWidth, 22, 'F');

  // Gold Stripe
  doc.setFillColor(...goldAccent);
  doc.rect(0, 22, pageWidth, 1.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PARIS DAKAR GERENCIAL', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Relatório Corporativo de Gestão Financeira & Econômica', 14, 17);

  const nowStr = new Date().toLocaleString('pt-BR');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(`Gerado em: ${nowStr}`, pageWidth - 14, 11, { align: 'right' });
  if (options.periodLabel) {
    doc.setFontSize(8);
    doc.setTextColor(193, 154, 107);
    doc.text(options.periodLabel, pageWidth - 14, 17, { align: 'right' });
  }

  // Report Main Title Block
  let currentY = 30;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(options.title, 14, currentY);

  if (options.subtitle) {
    currentY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(options.subtitle, 14, currentY);
  }

  currentY += 6;

  // Summary Cards Box
  if (options.summaryCards && options.summaryCards.length > 0) {
    const cardCount = options.summaryCards.length;
    const gap = 4;
    const availableWidth = pageWidth - 28;
    const cardWidth = Math.min(52, (availableWidth - (cardCount - 1) * gap) / cardCount);
    const cardHeight = 15;

    options.summaryCards.forEach((card, idx) => {
      const xPos = 14 + idx * (cardWidth + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(xPos, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

      // Top decorative line in card
      doc.setFillColor(...goldAccent);
      doc.rect(xPos, currentY, cardWidth, 1, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(card.label.toUpperCase(), xPos + 3, currentY + 5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(card.value, xPos + 3, currentY + 11.5);
    });

    currentY += cardHeight + 7;
  }

  // Sections and Tables
  options.sections.forEach((section) => {
    if (currentY > pageHeight - 40) {
      doc.addPage();
      currentY = 18;
    }

    if (section.title) {
      // Section Header Bar
      doc.setFillColor(241, 245, 249);
      doc.rect(14, currentY, pageWidth - 28, 6, 'F');

      doc.setFillColor(...goldAccent);
      doc.rect(14, currentY, 3, 6, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text(section.title, 19, currentY + 4.2);

      currentY += 8;
    }

    autoTable(doc, {
      startY: currentY,
      head: [section.headers],
      body: section.rows,
      theme: 'grid',
      headStyles: {
        fillColor: primaryDark,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'center',
        valign: 'middle',
      },
      bodyStyles: {
        fontSize: 7.5,
        textColor: [30, 41, 59],
        valign: 'middle',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: section.columnStyles,
      margin: { left: 14, right: 14 },
      didDrawPage: (data) => {
        const pageCount = doc.getNumberOfPages();
        doc.setDrawColor(226, 232, 240);
        doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Página ${data.pageNumber} de ${pageCount} | Documento Corporativo Paris Dakar Gerencial`,
          14,
          pageHeight - 6
        );
        doc.text(`Banco de Dados: parisgerencial`, pageWidth - 14, pageHeight - 6, { align: 'right' });
      },
    });

    currentY = (doc as any).lastAutoTable.finalY + 7;
  });

  const fname = options.filename || `Paris_Dakar_Relatorio_${Date.now()}.pdf`;
  doc.save(fname);
}

export function exportReportToPdf(options: PdfExportOptions) {
  exportCorporatePdf({
    title: options.title,
    subtitle: options.subtitle,
    summaryCards: options.summaryCards,
    sections: [
      {
        headers: options.headers,
        rows: options.rows,
      },
    ],
    filename: options.filename,
  });
}

// ─── DRE EXPORTERS ────────────────────────────────────────────────────────────

export function exportEconomicPdfGeral(
  economicMonths: Record<string, any>,
  selectedYear: number
) {
  const monthKeys = MONTH_KEYS_LIST;
  const totalReceita = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.receitaBruta || 0), 0);
  const totalCmv = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.cmv || 0), 0);
  const totalMargem = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.margemBruta || 0), 0);
  const totalDespesas = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.despesasFixas || 0), 0);
  const totalResEco = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.resultadoEconomico || 0), 0);

  const avgReceita = totalReceita / 12;
  const avgCmv = totalCmv / 12;
  const avgMargem = totalMargem / 12;
  const avgDespesas = totalDespesas / 12;
  const avgResEco = totalResEco / 12;

  const totalCmvPct = totalReceita > 0 ? (totalCmv / totalReceita) * 100 : 0;
  const totalMargemPct = totalReceita > 0 ? (totalMargem / totalReceita) * 100 : 0;
  const totalDespesasPct = totalReceita > 0 ? (totalDespesas / totalReceita) * 100 : 0;
  const totalResEcoPct = totalReceita > 0 ? (totalResEco / totalReceita) * 100 : 0;

  const headers = ['Indicador DRE', ...monthKeys.map((m) => m.toUpperCase()), 'Total Ano', 'Média Mês'];

  const rows = [
    [
      'Receita Bruta',
      ...monthKeys.map((m) => formatCurrency(economicMonths[m]?.receitaBruta)),
      formatCurrency(totalReceita),
      formatCurrency(avgReceita),
    ],
    [
      'CMV (Custos)',
      ...monthKeys.map(
        (m) => `${formatCurrency(economicMonths[m]?.cmv)} (${formatPercent(economicMonths[m]?.cmvPercent)})`
      ),
      `${formatCurrency(totalCmv)} (${formatPercent(totalCmvPct)})`,
      formatCurrency(avgCmv),
    ],
    [
      'Margem Bruta',
      ...monthKeys.map(
        (m) => `${formatCurrency(economicMonths[m]?.margemBruta)} (${formatPercent(economicMonths[m]?.margemPercent)})`
      ),
      `${formatCurrency(totalMargem)} (${formatPercent(totalMargemPct)})`,
      formatCurrency(avgMargem),
    ],
    [
      'Despesas Fixas',
      ...monthKeys.map(
        (m) => `${formatCurrency(economicMonths[m]?.despesasFixas)} (${formatPercent(economicMonths[m]?.despesasPercent)})`
      ),
      `${formatCurrency(totalDespesas)} (${formatPercent(totalDespesasPct)})`,
      formatCurrency(avgDespesas),
    ],
    [
      'Resultado Econômico',
      ...monthKeys.map(
        (m) => `${formatCurrency(economicMonths[m]?.resultadoEconomico)} (${formatPercent(economicMonths[m]?.resultadoPercent)})`
      ),
      `${formatCurrency(totalResEco)} (${formatPercent(totalResEcoPct)})`,
      formatCurrency(avgResEco),
    ],
    [
      'Ponto de Equilíbrio',
      ...monthKeys.map((m) => formatCurrency(economicMonths[m]?.pontoEquilibrio)),
      '-',
      formatCurrency(avgDespesas / (totalMargemPct / 100 || 1)),
    ],
  ];

  exportCorporatePdf({
    title: `RESULTADO ECONÔMICO (DRE) — EXERCÍCIO ${selectedYear}`,
    subtitle: `Demonstrativo do Resultado do Exercício Consolidado de Janeiro a Dezembro de ${selectedYear}`,
    periodLabel: `Exercício: ${selectedYear}`,
    summaryCards: [
      { label: 'Receita Bruta Total', value: formatCurrency(totalReceita) },
      { label: 'Margem Bruta Total', value: `${formatCurrency(totalMargem)} (${formatPercent(totalMargemPct)})` },
      { label: 'Despesas Fixas Total', value: `${formatCurrency(totalDespesas)} (${formatPercent(totalDespesasPct)})` },
      { label: 'Resultado Econômico', value: `${formatCurrency(totalResEco)} (${formatPercent(totalResEcoPct)})` },
    ],
    sections: [
      {
        title: 'Visão Anual Comparativa de Indicadores DRE (Valores e % sobre Receita)',
        headers,
        rows,
      },
    ],
    filename: `Paris_Dakar_DRE_Geral_${selectedYear}.pdf`,
  });
}

export function exportEconomicPdfMensal(
  economicMonths: Record<string, any>,
  selectedYear: number,
  monthKey: string
) {
  const monthLabel = MONTH_NAMES_FULL[monthKey] || monthKey.toUpperCase();
  const mData = economicMonths[monthKey] || {};

  const rec = mData.receitaBruta || 0;
  const cmv = mData.cmv || 0;
  const cmvPct = mData.cmvPercent || 0;
  const margem = mData.margemBruta || 0;
  const margemPct = mData.margemPercent || 0;
  const desp = mData.despesasFixas || 0;
  const despPct = mData.despesasPercent || 0;
  const res = mData.resultadoEconomico || 0;
  const resPct = mData.resultadoPercent || 0;
  const pe = mData.pontoEquilibrio || 0;

  // Calculando médias anuais para tabela comparativa
  const monthKeys = MONTH_KEYS_LIST;
  const totalReceita = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.receitaBruta || 0), 0);
  const totalCmv = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.cmv || 0), 0);
  const totalMargem = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.margemBruta || 0), 0);
  const totalDesp = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.despesasFixas || 0), 0);
  const totalRes = monthKeys.reduce((acc, m) => acc + (economicMonths[m]?.resultadoEconomico || 0), 0);

  const avgReceita = totalReceita / 12;
  const avgCmv = totalCmv / 12;
  const avgMargem = totalMargem / 12;
  const avgDesp = totalDesp / 12;
  const avgRes = totalRes / 12;

  const sec1Headers = ['Indicador DRE', 'Valor (R$)', '% s/ Receita', 'Classificação / Conceito Operacional'];
  const sec1Rows = [
    ['Receita Bruta', formatCurrency(rec), '100,00%', 'Faturamento Bruto Operacional'],
    ['(-) CMV (Custo das Mercadorias)', formatCurrency(cmv), formatPercent(cmvPct), 'Custos Variáveis Diretos das Vendas'],
    ['(=) Margem Bruta (Contribuição)', formatCurrency(margem), formatPercent(margemPct), 'Receita Líquida de Custos Diretos'],
    ['(-) Despesas Fixas Operacionais', formatCurrency(desp), formatPercent(despPct), 'Custos Operacionais e Administrativos'],
    ['(=) Resultado Econômico Líquido', formatCurrency(res), formatPercent(resPct), 'Lucro/Prejuízo Econômico do Mês'],
    ['(i) Ponto de Equilíbrio Operacional', formatCurrency(pe), '-', 'Faturamento mínimo para cobrir despesas'],
  ];

  const sec2Headers = ['Indicador', `Mês Atual (${monthLabel})`, `Média Mensal (${selectedYear})`, 'Diferença (R$)', 'Status de Desempenho'];
  const diffRec = rec - avgReceita;
  const diffMargem = margem - avgMargem;
  const diffDesp = desp - avgDesp;
  const diffRes = res - avgRes;

  const sec2Rows = [
    [
      'Receita Bruta',
      formatCurrency(rec),
      formatCurrency(avgReceita),
      formatCurrency(diffRec),
      diffRec >= 0 ? '▲ Acima da Média Anual' : '▼ Abaixo da Média Anual',
    ],
    [
      'Margem Bruta',
      formatCurrency(margem),
      formatCurrency(avgMargem),
      formatCurrency(diffMargem),
      diffMargem >= 0 ? '▲ Margem Superior' : '▼ Margem Inferior',
    ],
    [
      'Despesas Fixas',
      formatCurrency(desp),
      formatCurrency(avgDesp),
      formatCurrency(diffDesp),
      diffDesp <= 0 ? '✔ Despesa sob controle' : '⚠️ Despesa acima da média',
    ],
    [
      'Resultado Econômico',
      formatCurrency(res),
      formatCurrency(avgRes),
      formatCurrency(diffRes),
      diffRes >= 0 ? '▲ Resultado Positivo Superavitário' : '▼ Desempenho Inferior à Média',
    ],
  ];

  exportCorporatePdf({
    title: `DEMONSTRATIVO ECONÔMICO (DRE) — ${monthLabel.toUpperCase()} DE ${selectedYear}`,
    subtitle: `Detalhamento de Receita, Custos (CMV), Margem de Contribuição, Despesas e Resultado Econômico`,
    periodLabel: `Competência: ${monthLabel}/${selectedYear}`,
    summaryCards: [
      { label: 'Receita Bruta do Mês', value: formatCurrency(rec) },
      { label: 'Margem Bruta (R$ e %)', value: `${formatCurrency(margem)} (${formatPercent(margemPct)})` },
      { label: 'Despesas Fixas', value: `${formatCurrency(desp)} (${formatPercent(despPct)})` },
      { label: 'Resultado Econômico', value: `${formatCurrency(res)} (${formatPercent(resPct)})` },
      { label: 'Ponto de Equilíbrio', value: formatCurrency(pe) },
    ],
    sections: [
      {
        title: `Estrutura Detalhada do Demonstrativo DRE — Mês de ${monthLabel}`,
        headers: sec1Headers,
        rows: sec1Rows,
      },
      {
        title: `Análise Comparativa: ${monthLabel} vs Média Mensal do Exercício ${selectedYear}`,
        headers: sec2Headers,
        rows: sec2Rows,
      },
    ],
    filename: `Paris_Dakar_DRE_${monthLabel}_${selectedYear}.pdf`,
  });
}

// ─── FINANCIAL EXPORTERS ──────────────────────────────────────────────────────

export function exportFinancialPdfGeral(
  financialMonths: Record<string, any>,
  selectedYear: number
) {
  const monthKeys = MONTH_KEYS_LIST;
  const totalBancos = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.entradasBancos || 0), 0);
  const totalTesouraria = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.entradasTesouraria || 0), 0);
  const totalEntradas = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.totalEntradas || 0), 0);
  const totalSaidas = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.totalSaidas || 0), 0);
  const totalResFin = totalEntradas - totalSaidas;
  const totalResFinPct = totalEntradas > 0 ? (totalResFin / totalEntradas) * 100 : 0;

  const activeMonths = monthKeys.filter((m) => (financialMonths[m]?.totalEntradas || 0) > 0);
  const activeCount = activeMonths.length || 1;
  const avgEstoque = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.estoque || 0), 0) / activeCount;
  const avgInadMensal = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.inadimplenciaMensal || 0), 0) / activeCount;
  const avgInadAcumulada = monthKeys.reduce((acc, m) => acc + (financialMonths[m]?.inadimplenciaAcumulada || 0), 0) / activeCount;

  const headers = ['Métrica Financeira', ...monthKeys.map((m) => m.toUpperCase()), 'Total / Média Ano'];

  const rows = [
    [
      'ENTRADAS - Bancos',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.entradasBancos)),
      formatCurrency(totalBancos),
    ],
    [
      'ENTRADAS - Tesouraria',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.entradasTesouraria)),
      formatCurrency(totalTesouraria),
    ],
    [
      'TOTAL ENTRADAS',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.totalEntradas)),
      formatCurrency(totalEntradas),
    ],
    [
      'TOTAL SAÍDAS',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.totalSaidas)),
      formatCurrency(totalSaidas),
    ],
    [
      'RESULTADO FINANCEIRO',
      ...monthKeys.map(
        (m) => `${formatCurrency(financialMonths[m]?.resultadoFinanceiro)} (${formatPercent(financialMonths[m]?.resultadoPercent)})`
      ),
      `${formatCurrency(totalResFin)} (${formatPercent(totalResFinPct)})`,
    ],
    [
      'ESTOQUE (Ativo Circulante)',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.estoque)),
      `Média: ${formatCurrency(avgEstoque)}`,
    ],
    [
      'INADIMPLÊNCIA MENSAL',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.inadimplenciaMensal)),
      `Média: ${formatCurrency(avgInadMensal)}`,
    ],
    [
      'INADIMPLÊNCIA ACUMULADA',
      ...monthKeys.map((m) => formatCurrency(financialMonths[m]?.inadimplenciaAcumulada)),
      `Média: ${formatCurrency(avgInadAcumulada)}`,
    ],
  ];

  exportCorporatePdf({
    title: `RESULTADO FINANCEIRO CONSOLIDADO — EXERCÍCIO ${selectedYear}`,
    subtitle: `Demonstrativo de Movimentação Bancária, Tesouraria, Saídas, Estoque e Inadimplência`,
    periodLabel: `Exercício: ${selectedYear}`,
    summaryCards: [
      { label: 'Total Entradas Efetivadas', value: formatCurrency(totalEntradas) },
      { label: 'Total Saídas Efetivadas', value: formatCurrency(totalSaidas) },
      { label: 'Resultado Financeiro Líquido', value: `${formatCurrency(totalResFin)} (${formatPercent(totalResFinPct)})` },
      { label: 'Estoque Médio Anual', value: formatCurrency(avgEstoque) },
      { label: 'Inadimplência Média', value: formatCurrency(avgInadMensal) },
    ],
    sections: [
      {
        title: 'Visão Financeira Consolidada de Janeiro a Dezembro',
        headers,
        rows,
      },
    ],
    filename: `Paris_Dakar_Resultado_Financeiro_Geral_${selectedYear}.pdf`,
  });
}

export function exportFinancialPdfMensal(
  financialMonths: Record<string, any>,
  selectedYear: number,
  monthKey: string
) {
  const monthLabel = MONTH_NAMES_FULL[monthKey] || monthKey.toUpperCase();
  const fData = financialMonths[monthKey] || {};

  const bancos = fData.entradasBancos || 0;
  const tesouraria = fData.entradasTesouraria || 0;
  const entradas = fData.totalEntradas || 0;
  const saidas = fData.totalSaidas || 0;
  const res = fData.resultadoFinanceiro || (entradas - saidas);
  const resPct = fData.resultadoPercent || (entradas > 0 ? (res / entradas) * 100 : 0);
  const estoque = fData.estoque || 0;
  const inadMensal = fData.inadimplenciaMensal || 0;
  const inadAcum = fData.inadimplenciaAcumulada || 0;

  const sec1Headers = ['Origem / Rubrica Financeira', 'Valor Realizado (R$)', '% s/ Entradas', 'Natureza da Operação'];
  const sec1Rows = [
    ['ENTRADAS — Bancos (Contas Correntes)', formatCurrency(bancos), entradas > 0 ? formatPercent((bancos / entradas) * 100) : '0,00%', 'Depósitos, Pix e Boletos Bancários'],
    ['ENTRADAS — Tesouraria (Caixa Físico)', formatCurrency(tesouraria), entradas > 0 ? formatPercent((tesouraria / entradas) * 100) : '0,00%', 'Recebimentos em Espécie / Tesouraria'],
    ['TOTAL DE ENTRADAS EFETIVADAS', formatCurrency(entradas), '100,00%', 'Fluxo Total de Recursos Recebidos'],
    ['TOTAL DE SAÍDAS EFETIVADAS', formatCurrency(saidas), entradas > 0 ? formatPercent((saidas / entradas) * 100) : '0,00%', 'Desembolsos, Fornecedores e Impostos'],
    ['(=) RESULTADO FINANCEIRO LÍQUIDO', formatCurrency(res), formatPercent(resPct), 'Saldo Operacional Gerado no Mês'],
  ];

  const sec2Headers = ['Indicador Patrimonial e Risco', 'Valor no Mês (R$)', 'Status / Impacto na Liquidez'];
  const sec2Rows = [
    ['Posição de Estoque (Ativo Circulante)', formatCurrency(estoque), 'Capital investido em mercadoria estocada'],
    ['Inadimplência Gerada no Mês', formatCurrency(inadMensal), 'Títulos vencidos e não pagos no mês corrente'],
    ['Inadimplência Acumulada de Carteira', formatCurrency(inadAcum), 'Volume total de títulos em atraso na carteira'],
  ];

  exportCorporatePdf({
    title: `DEMONSTRATIVO FINANCIAL E LIQUIDEZ — ${monthLabel.toUpperCase()} DE ${selectedYear}`,
    subtitle: `Bancos, Tesouraria, Saídas Efetivadas, Posição de Estoque e Indicadores de Inadimplência`,
    periodLabel: `Competência: ${monthLabel}/${selectedYear}`,
    summaryCards: [
      { label: 'Entradas Totais', value: formatCurrency(entradas) },
      { label: 'Saídas Totais', value: formatCurrency(saidas) },
      { label: 'Resultado Líquido', value: `${formatCurrency(res)} (${formatPercent(resPct)})` },
      { label: 'Estoque do Mês', value: formatCurrency(estoque) },
      { label: 'Inadimplência Mensal', value: formatCurrency(inadMensal) },
    ],
    sections: [
      {
        title: `Movimentação de Entradas e Saídas Efetivadas — ${monthLabel}/${selectedYear}`,
        headers: sec1Headers,
        rows: sec1Rows,
      },
      {
        title: 'Ativos Circulantes & Indicadores de Risco de Crédito',
        headers: sec2Headers,
        rows: sec2Rows,
      },
    ],
    filename: `Paris_Dakar_Financeiro_${monthLabel}_${selectedYear}.pdf`,
  });
}

// ─── CASH FLOW EXPORTERS ──────────────────────────────────────────────────────

const WEEKS_KEYS = ['sem01', 'sem02', 'sem03', 'sem04', 'sem05'];
const WEEK_LABELS_MAP: Record<string, string> = {
  sem01: 'Semana 1', sem02: 'Semana 2', sem03: 'Semana 3', sem04: 'Semana 4', sem05: 'Semana 5',
};

const weekOfMonthHelper = (iso: string) => {
  const day = parseInt((iso || '').slice(8, 10), 10);
  if (isNaN(day)) return 'sem01';
  const idx = Math.min(4, Math.max(0, Math.floor((day - 1) / 7)));
  return WEEKS_KEYS[idx];
};

const categorizeReceiptHelper = (e: any): string => {
  const t = `${e.documentType || ''} ${e.description || ''}`.toLowerCase();
  if (t.includes('pix')) return 'PIX';
  if (t.includes('boleto')) return 'BOLETO';
  if (t.includes('cart') || t.includes('cred') || t.includes('deb')) return 'CARTÃO';
  if (t.includes('cheque')) return 'CHEQUE';
  if (t.includes('dinheiro') || t.includes('espéc') || t.includes('espec') || t.includes('caixa')) return 'ESPÉCIE';
  if (t.includes('ordem') || t.includes(' os ') || t.startsWith('os')) return 'OS';
  if (t.includes('ted') || t.includes('doc') || t.includes('transf')) return 'TRANSFERÊNCIA';
  return 'OUTROS';
};

export function exportCashFlowPdfGeral(
  plans: any[],
  statementEntries: any[],
  selectedYear: number
) {
  const monthKeys = MONTH_KEYS_LIST;

  const rows = monthKeys.map((mKey) => {
    const monthLabel = MONTH_NAMES_FULL[mKey];
    const plan = plans.find((p) => p.monthKey === mKey && p.year === selectedYear);

    // Sum entries for month
    let realReceb = 0;
    let realDesemb = 0;

    if (plan && plan.realizadoManual) {
      WEEKS_KEYS.forEach((wKey) => {
        realReceb += plan.weeks?.[wKey]?.recebRealizado || 0;
        realDesemb += Math.abs(plan.weeks?.[wKey]?.desembRealizado || 0);
      });
    } else {
      statementEntries.forEach((e) => {
        if (e.year === selectedYear && e.monthKey === mKey) {
          if (e.entryAmount > 0) realReceb += e.entryAmount;
          if (e.exitAmount > 0) realDesemb += e.exitAmount;
        }
      });
    }

    let prevReceb = 0;
    let prevDesemb = 0;
    let aportes = 0;
    if (plan) {
      WEEKS_KEYS.forEach((wKey) => {
        prevReceb += plan.weeks?.[wKey]?.recebimentos || 0;
        prevDesemb += Math.abs(plan.weeks?.[wKey]?.desembolsos || 0);
        aportes += plan.weeks?.[wKey]?.aportes || 0;
      });
    }

    const saldoInicial = plan?.saldoInicial || 0;
    const gerCaixaReal = realReceb - realDesemb;
    const saldoFinalReal = saldoInicial + gerCaixaReal + aportes;

    return [
      monthLabel,
      formatCurrency(saldoInicial),
      formatCurrency(prevReceb),
      formatCurrency(realReceb),
      formatCurrency(prevDesemb),
      formatCurrency(realDesemb),
      formatCurrency(gerCaixaReal),
      formatCurrency(saldoFinalReal),
    ];
  });

  const totalRealReceb = statementEntries.reduce(
    (acc, e) => (e.year === selectedYear && e.entryAmount > 0 ? acc + e.entryAmount : acc),
    0
  );
  const totalRealDesemb = statementEntries.reduce(
    (acc, e) => (e.year === selectedYear && e.exitAmount > 0 ? acc + e.exitAmount : acc),
    0
  );
  const saldoLiquidoAnual = totalRealReceb - totalRealDesemb;

  exportCorporatePdf({
    title: `FLUXO DE CAIXA CONSOLIDADO — EXERCÍCIO ${selectedYear}`,
    subtitle: `Acompanhamento dos 12 Meses de Saldo Inicial, Entradas, Saídas e Saldo Final de Caixa`,
    periodLabel: `Exercício: ${selectedYear}`,
    summaryCards: [
      { label: 'Total Entradas Realizadas', value: formatCurrency(totalRealReceb) },
      { label: 'Total Saídas Realizadas', value: formatCurrency(totalRealDesemb) },
      { label: 'Geração de Caixa Anual', value: formatCurrency(saldoLiquidoAnual) },
    ],
    sections: [
      {
        title: `Consolidado Mensal do Fluxo de Caixa — Ano ${selectedYear}`,
        headers: [
          'Mês',
          'Saldo Inicial',
          'Entradas (Prev.)',
          'Entradas (Real.)',
          'Saídas (Prev.)',
          'Saídas (Real.)',
          'Geração de Caixa (Real.)',
          'Saldo Final (Real.)',
        ],
        rows,
      },
    ],
    filename: `Paris_Dakar_Fluxo_Caixa_Geral_${selectedYear}.pdf`,
  });
}

export function exportCashFlowPdfMensal(
  plan: any,
  statementEntries: any[],
  selectedYear: number,
  monthKey: string
) {
  const monthLabel = MONTH_NAMES_FULL[monthKey] || monthKey.toUpperCase();

  // Calculate Realized from Statement or Plan
  const weeksRealized: Record<string, { receb: number; desemb: number }> = {
    sem01: { receb: 0, desemb: 0 },
    sem02: { receb: 0, desemb: 0 },
    sem03: { receb: 0, desemb: 0 },
    sem04: { receb: 0, desemb: 0 },
    sem05: { receb: 0, desemb: 0 },
  };

  const recebByType: Record<string, Record<string, number>> = {};
  const desembBySource: Record<string, Record<string, number>> = {};

  statementEntries.forEach((e) => {
    if (e.year === selectedYear && e.monthKey === monthKey) {
      const wk = weekOfMonthHelper(e.date);
      if (e.entryAmount > 0) {
        weeksRealized[wk].receb += e.entryAmount;
        const cat = categorizeReceiptHelper(e);
        if (!recebByType[cat]) recebByType[cat] = { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 };
        recebByType[cat][wk] += e.entryAmount;
      }
      if (e.exitAmount > 0) {
        weeksRealized[wk].desemb += e.exitAmount;
        const src = e.sourceLabel || 'Outros';
        if (!desembBySource[src]) desembBySource[src] = { sem01: 0, sem02: 0, sem03: 0, sem04: 0, sem05: 0 };
        desembBySource[src][wk] += e.exitAmount;
      }
    }
  });

  const isManual = plan?.realizadoManual || false;
  const getPrevReceb = (w: string) => plan?.weeks?.[w]?.recebimentos || 0;
  const getPrevDesemb = (w: string) => plan?.weeks?.[w]?.desembolsos || 0; // negativo
  const getAporte = (w: string) => plan?.weeks?.[w]?.aportes || 0;

  const getRealReceb = (w: string) =>
    isManual ? plan?.weeks?.[w]?.recebRealizado || 0 : weeksRealized[w].receb;
  const getRealDesemb = (w: string) =>
    isManual ? plan?.weeks?.[w]?.desembRealizado || 0 : -weeksRealized[w].desemb;

  let accPrev = plan?.saldoInicial || 0;
  let accReal = plan?.saldoInicial || 0;
  const prevSaldo: Record<string, number> = {};
  const realSaldo: Record<string, number> = {};

  WEEKS_KEYS.forEach((w) => {
    const gerPrev = getPrevReceb(w) + getPrevDesemb(w);
    const gerReal = getRealReceb(w) + getRealDesemb(w);
    accPrev += gerPrev + getAporte(w);
    accReal += gerReal + getAporte(w);
    prevSaldo[w] = accPrev;
    realSaldo[w] = accReal;
  });

  const totPrevReceb = WEEKS_KEYS.reduce((a, w) => a + getPrevReceb(w), 0);
  const totRealReceb = WEEKS_KEYS.reduce((a, w) => a + getRealReceb(w), 0);
  const totPrevDesemb = WEEKS_KEYS.reduce((a, w) => a + getPrevDesemb(w), 0);
  const totRealDesemb = WEEKS_KEYS.reduce((a, w) => a + getRealDesemb(w), 0);
  const totAportes = WEEKS_KEYS.reduce((a, w) => a + getAporte(w), 0);

  const gerCaixaPrev = totPrevReceb + totPrevDesemb;
  const gerCaixaReal = totRealReceb + totRealDesemb;

  const saldoInicial = plan?.saldoInicial || 0;
  const saldoFinalPrev = prevSaldo['sem05'];
  const saldoFinalReal = realSaldo['sem05'];

  const acuracia = totPrevReceb > 0 ? (totRealReceb / totPrevReceb) * 100 : 100;

  // Sec 1: Matriz Semanal
  const sec1Headers = ['Linha de Caixa', 'S1 (Prev/Real)', 'S2 (Prev/Real)', 'S3 (Prev/Real)', 'S4 (Prev/Real)', 'S5 (Prev/Real)', 'Total Mês (Prev/Real)'];
  const sec1Rows = [
    [
      'Recebimentos (Entradas)',
      ...WEEKS_KEYS.map((w) => `${formatCurrency(getPrevReceb(w))}\n${formatCurrency(getRealReceb(w))}`),
      `${formatCurrency(totPrevReceb)}\n${formatCurrency(totRealReceb)}`,
    ],
    [
      'Desembolsos (Saídas)',
      ...WEEKS_KEYS.map((w) => `${formatCurrency(getPrevDesemb(w))}\n${formatCurrency(getRealDesemb(w))}`),
      `${formatCurrency(totPrevDesemb)}\n${formatCurrency(totRealDesemb)}`,
    ],
    [
      'Geração de Caixa',
      ...WEEKS_KEYS.map((w) => `${formatCurrency(getPrevReceb(w) + getPrevDesemb(w))}\n${formatCurrency(getRealReceb(w) + getRealDesemb(w))}`),
      `${formatCurrency(gerCaixaPrev)}\n${formatCurrency(gerCaixaReal)}`,
    ],
    [
      'Aportes de Capital',
      ...WEEKS_KEYS.map((w) => `${formatCurrency(getAporte(w))}`),
      formatCurrency(totAportes),
    ],
    [
      'Saldo de Caixa Final',
      ...WEEKS_KEYS.map((w) => `${formatCurrency(prevSaldo[w])}\n${formatCurrency(realSaldo[w])}`),
      `${formatCurrency(saldoFinalPrev)}\n${formatCurrency(saldoFinalReal)}`,
    ],
  ];

  // Sec 2: Recebimentos por Tipo
  const receiptTypes = Object.keys(recebByType);
  const sec2Headers = ['Tipo de Recebimento', 'Semana 1', 'Semana 2', 'Semana 3', 'Semana 4', 'Semana 5', 'Total Realizado (R$)'];
  const sec2Rows = receiptTypes.map((type) => {
    const r = recebByType[type];
    const tot = WEEKS_KEYS.reduce((a, w) => a + (r[w] || 0), 0);
    return [
      type,
      formatCurrency(r['sem01']),
      formatCurrency(r['sem02']),
      formatCurrency(r['sem03']),
      formatCurrency(r['sem04']),
      formatCurrency(r['sem05']),
      formatCurrency(tot),
    ];
  });

  if (sec2Rows.length === 0) {
    sec2Rows.push(['Sem lançamentos no extrato', '-', '-', '-', '-', '-', 'R$ 0,00']);
  }

  // Sec 3: Desembolsos por Origem
  const paymentSources = Object.keys(desembBySource);
  const sec3Headers = ['Origem do Desembolso', 'Semana 1', 'Semana 2', 'Semana 3', 'Semana 4', 'Semana 5', 'Total Realizado (R$)'];
  const sec3Rows = paymentSources.map((src) => {
    const r = desembBySource[src];
    const tot = WEEKS_KEYS.reduce((a, w) => a + (r[w] || 0), 0);
    return [
      src,
      formatCurrency(r['sem01']),
      formatCurrency(r['sem02']),
      formatCurrency(r['sem03']),
      formatCurrency(r['sem04']),
      formatCurrency(r['sem05']),
      formatCurrency(tot),
    ];
  });

  if (sec3Rows.length === 0) {
    sec3Rows.push(['Sem lançamentos no extrato', '-', '-', '-', '-', '-', 'R$ 0,00']);
  }

  // Sec 4: Pendências
  const pendencias = plan?.pendencias || [];
  const totPend = pendencias.reduce((acc: number, p: any) => acc + (p.valor || 0), 0);
  const sec4Headers = ['Item', 'Descrição da Obrigação em Aberto', 'Valor Pendente (R$)', 'Status / Observação'];
  const sec4Rows = pendencias.map((p: any, idx: number) => [
    `#${idx + 1}`,
    p.descricao || 'Sem descrição',
    formatCurrency(p.valor || 0),
    'Pendente de Quitação (Fora do Saldo Actual)',
  ]);

  if (sec4Rows.length === 0) {
    sec4Rows.push(['-', 'Nenhuma pendência registrada para este mês', 'R$ 0,00', 'Sem compromissos em aberto']);
  } else {
    sec4Rows.push(['TOTAL', 'TOTAL DE PENDÊNCIAS REGISTRADAS', formatCurrency(totPend), 'Compromissos a Vencer/Programados']);
  }

  exportCorporatePdf({
    title: `DEMONSTRATIVO DE FLUXO DE CAIXA SEMANAL — ${monthLabel.toUpperCase()} DE ${selectedYear}`,
    subtitle: `Matriz Semanal de Previsto x Realizado, Recebimentos por Tipo, Desembolsos e Pendências`,
    periodLabel: `Competência: ${monthLabel}/${selectedYear}`,
    summaryCards: [
      { label: 'Saldo Inicial', value: formatCurrency(saldoInicial) },
      { label: 'Recebimentos Realizados', value: formatCurrency(totRealReceb) },
      { label: 'Desembolsos Realizados', value: formatCurrency(Math.abs(totRealDesemb)) },
      { label: 'Geração de Caixa Líquida', value: formatCurrency(gerCaixaReal) },
      { label: 'Saldo Final de Caixa', value: formatCurrency(saldoFinalReal) },
      { label: 'Acurácia Planejada', value: `${acuracia.toFixed(0)}%` },
    ],
    sections: [
      {
        title: `Planejamento Semanal (Previsto vs Realizado) — ${monthLabel}/${selectedYear}`,
        headers: sec1Headers,
        rows: sec1Rows,
      },
      {
        title: 'Recebimentos por Tipo (Efetivados no Extrato)',
        headers: sec2Headers,
        rows: sec2Rows,
      },
      {
        title: 'Desembolsos por Origem (Efetivados no Extrato)',
        headers: sec3Headers,
        rows: sec3Rows,
      },
      {
        title: 'Obrigações em Aberto / Pendências do Mês',
        headers: sec4Headers,
        rows: sec4Rows,
      },
    ],
    filename: `Paris_Dakar_Fluxo_Caixa_${monthLabel}_${selectedYear}.pdf`,
  });
}


export function exportReportToExcel(sheetData: Record<string, any>[], sheetName: string, filename: string) {
  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || 'Relatorio');

  // Auto column width
  const colWidths = Object.keys(sheetData[0] || {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...sheetData.map((row) => (row[key] ? row[key].toString().length : 0))
    );
    return { wch: Math.min(Math.max(maxLen + 3, 10), 40) };
  });

  worksheet['!cols'] = colWidths;

  XLSX.writeFile(workbook, filename || `Paris_Dakar_${Date.now()}.xlsx`);
}
