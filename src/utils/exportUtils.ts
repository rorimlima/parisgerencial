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
  summaryCards?: { label: string; value: string }[];
  headers: string[];
  rows: (string | number)[][];
  filename?: string;
}

export function exportReportToPdf(options: PdfExportOptions) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const primaryColor: [number, number, number] = [180, 30, 30]; // Paris Dakar Deep Red
  const darkTextColor: [number, number, number] = [30, 41, 59];

  // Header Banner
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 297, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PARIS DAKAR GERENCIAL', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Sistema de Controle de Resultados Financeiros & Econômicos', 14, 18);

  const nowStr = new Date().toLocaleString('pt-BR');
  doc.setFontSize(8);
  doc.text(`Gerado em: ${nowStr}`, 220, 15);

  // Subtitle / Filter Title
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(options.title, 14, 34);

  if (options.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(options.subtitle, 14, 40);
  }

  let startY = options.subtitle ? 46 : 40;

  // Summary Cards Box
  if (options.summaryCards && options.summaryCards.length > 0) {
    const cardWidth = 50;
    const cardHeight = 16;

    options.summaryCards.forEach((card, idx) => {
      const xPos = 14 + idx * (cardWidth + 6);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(xPos, startY, cardWidth, cardHeight, 2, 2, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(card.label.toUpperCase(), xPos + 4, startY + 5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(card.value, xPos + 4, startY + 12);
    });

    startY += cardHeight + 8;
  }

  // AutoTable
  autoTable(doc, {
    startY: startY,
    head: [options.headers],
    body: options.rows,
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Footer page number
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Página ${data.pageNumber} de ${pageCount} | Paris Dakar Gerencial Database: parisgerencial`,
        14,
        202
      );
    },
  });

  const fname = options.filename || `Paris_Dakar_Relatorio_${Date.now()}.pdf`;
  doc.save(fname);
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
