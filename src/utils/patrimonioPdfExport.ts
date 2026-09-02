/**
 * patrimonioPdfExport.ts — Emissão de Relatório Corporativo & Livro de Inventário Patrimonial
 *
 * Gera PDF corporativo oficial para Tombamento de Loja e Controle de Ativo Imobilizado:
 *  - Cabeçalho executivo Paris Dakar (Dark Slate + Ouro)
 *  - Cards com KPIs consolidados
 *  - Tabela completa de bens tombados com ordenação e totais
 *  - Resumo de valores por setor e por empresa
 *  - Termo de responsabilidade e 3 assinaturas para auditoria
 *  - Rodapé corporativo numerado em todas as páginas
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PatrimonioItem } from '../types';

// ── Cores Corporativas Paris Dakar ──────────────────────────────────────────
const PRIMARY_DARK: [number, number, number] = [30, 41, 59];   // Slate 800
const GOLD_ACCENT: [number, number, number] = [193, 154, 107]; // Ouro Paris Dakar
const WHITE: [number, number, number] = [255, 255, 255];
const SLATE_100: [number, number, number] = [241, 245, 249];
const SLATE_200: [number, number, number] = [226, 232, 240];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_800: [number, number, number] = [30, 41, 59];
const GREEN: [number, number, number] = [22, 163, 74];
const AMBER: [number, number, number] = [217, 119, 6];
const RED: [number, number, number] = [220, 38, 38];
const BLUE: [number, number, number] = [37, 99, 235];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value || 0);
}

function formatDateBr(iso: string): string {
  if (!iso) return '—';
  const parts = iso.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return iso;
}

function drawHeader(doc: jsPDF, pageWidth: number, subtitulo: string) {
  // Banner escuro
  doc.setFillColor(...PRIMARY_DARK);
  doc.rect(0, 0, pageWidth, 22, 'F');

  // Faixa dourada
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(0, 22, pageWidth, 1.5, 'F');

  // Título
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('PARIS DAKAR GERENCIAL', 14, 10.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(subtitulo, 14, 16.5);

  // Data e hora de emissão
  const nowStr = new Date().toLocaleString('pt-BR');
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text(`Emissão: ${nowStr}`, pageWidth - 14, 10.5, { align: 'right' });

  doc.setTextColor(...GOLD_ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Inventário de Ativo Imobilizado', pageWidth - 14, 16.5, { align: 'right' });
}

function drawFooter(doc: jsPDF, pageWidth: number, pageHeight: number, pageNum: number, totalPages: number) {
  doc.setDrawColor(...SLATE_200);
  doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Página ${pageNum} de ${totalPages} | Livro Oficial de Tombamento e Patrimônio — Paris Dakar Gerencial`,
    14,
    pageHeight - 6.5,
  );
  doc.text('Auditoria de Ativo e Controle Patrimonial', pageWidth - 14, pageHeight - 6.5, { align: 'right' });
}

export interface ExportPatrimonioOptions {
  items: PatrimonioItem[];
  filtroEmpresa?: string;
  filtroSetor?: string;
  filtroEstado?: string;
  termoBusca?: string;
}

export function exportPatrimonioPdf(options: ExportPatrimonioOptions) {
  const { items, filtroEmpresa, filtroSetor, filtroEstado } = options;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;

  // Cálculos Consolidados
  const totalValor = items.reduce((acc, i) => acc + (Number(i.valorTotal) || 0), 0);
  const totalItensFisicos = items.reduce((acc, i) => acc + (Number(i.quantidade) || 0), 0);
  const totalCadastros = items.length;
  const totalAnexos = items.reduce((acc, i) => acc + (Number(i.anexosCount) || 0), 0);
  const totalDanificados = items.filter((i) => i.estadoConservacao === 'Danificado' || i.estadoConservacao === 'Baixado').length;

  // ─── PÁGINA 1: CAPA EXECUTIVA & TABELA DE BENS ───────────────────────────
  drawHeader(doc, pageWidth, 'Relatório Oficial de Tombamento de Loja & Patrimônio Empresarial');

  let y = 29;

  // Identificação e Filtros Aplicados
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...SLATE_200);
  doc.roundedRect(14, y, pageWidth - 28, 14, 1.5, 1.5, 'FD');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, y, 2, 14, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_800);
  doc.text('PARÂMETROS DO INVENTÁRIO:', 19, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_500);

  const empresaTxt = filtroEmpresa ? `Empresa: ${filtroEmpresa}` : 'Empresa: Todas as Unidades';
  const setorTxt = filtroSetor ? `Setor: ${filtroSetor}` : 'Setor: Todos os Setores';
  const estadoTxt = filtroEstado ? `Estado: ${filtroEstado}` : 'Estado: Todos os Estados';

  doc.text(`${empresaTxt}   |   ${setorTxt}   |   ${estadoTxt}   |   Total de Registros: ${totalCadastros}`, 19, y + 10);

  y += 18;

  // Cards de KPIs
  const cards = [
    { label: 'VALOR TOTAL PATRIMÔNIO', value: formatCurrency(totalValor), color: PRIMARY_DARK },
    { label: 'QTD. TOTAL DE ITENS', value: `${totalItensFisicos} unid.`, color: BLUE },
    { label: 'BENS CADASTRADOS', value: `${totalCadastros} tipos`, color: GREEN },
    { label: 'NOTAS / ANEXOS', value: `${totalAnexos} doc(s)`, color: GOLD_ACCENT },
    { label: 'ATENÇÃO / REPARO', value: `${totalDanificados} item(ns)`, color: totalDanificados > 0 ? RED : GREEN },
  ];

  const cardW = 50;
  const cardH = 14;
  const gap = 4.7;

  cards.forEach((c, idx) => {
    const x = 14 + idx * (cardW + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...SLATE_200);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(...c.color);
    doc.rect(x, y, cardW, 1.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...SLATE_500);
    doc.text(c.label, x + 3, y + 4.8);

    doc.setFontSize(9.5);
    doc.setTextColor(...c.color);
    doc.text(c.value, x + 3, y + 10.8);
  });

  y += cardH + 7;

  // Tabela Principal de Tombamento
  const tableHeaders = [
    'Cód. Tombo',
    'Produto / Descrição do Bem',
    'Setor',
    'Empresa / Filial',
    'Qtd',
    'Valor Unit.',
    'Valor Total',
    'Nº NF',
    'Estado',
    'Notas Anexadas',
  ];

  const tableRows = items.map((i) => [
    i.codigoTombo || '—',
    i.produto || '—',
    i.setor || '—',
    i.empresa || '—',
    String(i.quantidade || 1),
    formatCurrency(i.valorUnitario),
    formatCurrency(i.valorTotal),
    i.numeroNotaFiscal || '—',
    i.estadoConservacao || 'Bom',
    i.anexosCount ? `${i.anexosCount} anexo(s)` : 'Sem anexo',
  ]);

  // Linha de totais
  tableRows.push([
    'TOTAL',
    `Total de bens inventariados (${totalCadastros} cadastros)`,
    '',
    '',
    String(totalItensFisicos),
    '—',
    formatCurrency(totalValor),
    '—',
    '—',
    `${totalAnexos} doc(s)`,
  ]);

  autoTable(doc, {
    startY: y,
    head: [tableHeaders],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: PRIMARY_DARK,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
      valign: 'middle',
    },
    bodyStyles: {
      fontSize: 6.8,
      textColor: SLATE_800,
      valign: 'middle',
      cellPadding: 1.5,
    },
    alternateRowStyles: {
      fillColor: SLATE_100,
    },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 22, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: 'auto', fontStyle: 'bold' },
      2: { cellWidth: 32 },
      3: { cellWidth: 32 },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
      7: { cellWidth: 20, halign: 'center' },
      8: { cellWidth: 20, halign: 'center' },
      9: { cellWidth: 22, halign: 'center' },
    },
    didParseCell: (data) => {
      // Linha de totais (última)
      if (data.section === 'body' && data.row.index === tableRows.length - 1) {
        data.cell.styles.fillColor = PRIMARY_DARK;
        data.cell.styles.textColor = WHITE;
        data.cell.styles.fontStyle = 'bold';
      }

      // Colorir estado de conservação
      if (data.section === 'body' && data.column.index === 8 && data.row.index < tableRows.length - 1) {
        const val = String(data.cell.raw);
        if (val === 'Novo') data.cell.styles.textColor = GREEN;
        else if (val === 'Bom') data.cell.styles.textColor = BLUE;
        else if (val === 'Regular') data.cell.styles.textColor = AMBER;
        else if (val === 'Danificado' || val === 'Baixado') data.cell.styles.textColor = RED;
      }
    },
  });

  // ─── PÁGINA 2: RESUMO ANALÍTICO POR SETOR & EMPRESA COM ASSINATURAS ──────
  doc.addPage();
  drawHeader(doc, pageWidth, 'Resumo Analítico Setorial, Filiais & Termo de Auditoria');

  let py = 29;

  // Agrupamento por Setor
  const setorMap: Record<string, { qtd: number; valor: number }> = {};
  items.forEach((i) => {
    const s = i.setor || 'Não Definido';
    if (!setorMap[s]) setorMap[s] = { qtd: 0, valor: 0 };
    setorMap[s].qtd += Number(i.quantidade) || 0;
    setorMap[s].valor += Number(i.valorTotal) || 0;
  });

  const setorRows = Object.entries(setorMap).map(([setor, data]) => [
    setor,
    String(data.qtd),
    formatCurrency(data.valor),
    totalValor > 0 ? `${((data.valor / totalValor) * 100).toFixed(1)}%` : '0%',
  ]);

  // Agrupamento por Empresa
  const empresaMap: Record<string, { qtd: number; valor: number }> = {};
  items.forEach((i) => {
    const emp = i.empresa || 'Matriz';
    if (!empresaMap[emp]) empresaMap[emp] = { qtd: 0, valor: 0 };
    empresaMap[emp].qtd += Number(i.quantidade) || 0;
    empresaMap[emp].valor += Number(i.valorTotal) || 0;
  });

  const empresaRows = Object.entries(empresaMap).map(([emp, data]) => [
    emp,
    String(data.qtd),
    formatCurrency(data.valor),
    totalValor > 0 ? `${((data.valor / totalValor) * 100).toFixed(1)}%` : '0%',
  ]);

  // Sub-header Setores
  doc.setFillColor(...SLATE_100);
  doc.rect(14, py, pageWidth - 28, 5.5, 'F');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, py, 3, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_800);
  doc.text('CONSOLIDAÇÃO PATRIMONIAL POR SETOR DA LOJA', 19, py + 3.8);
  py += 7.5;

  autoTable(doc, {
    startY: py,
    head: [['Setor / Departamento', 'Qtd. de Itens', 'Valor Alocado (R$)', '% do Patrimônio']],
    body: setorRows,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 7, halign: 'center' },
    bodyStyles: { fontSize: 7, textColor: SLATE_800 },
    alternateRowStyles: { fillColor: SLATE_100 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      1: { halign: 'center', cellWidth: 35 },
      2: { halign: 'right', cellWidth: 45, fontStyle: 'bold' },
      3: { halign: 'center', cellWidth: 35 },
    },
  });

  py = (doc as any).lastAutoTable.finalY + 6;

  // Sub-header Empresas
  doc.setFillColor(...SLATE_100);
  doc.rect(14, py, pageWidth - 28, 5.5, 'F');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, py, 3, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_800);
  doc.text('CONSOLIDAÇÃO PATRIMONIAL POR EMPRESA / UNIDADE', 19, py + 3.8);
  py += 7.5;

  autoTable(doc, {
    startY: py,
    head: [['Empresa / Filial', 'Qtd. de Itens', 'Valor Patrimonial (R$)', '% do Total']],
    body: empresaRows,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 7, halign: 'center' },
    bodyStyles: { fontSize: 7, textColor: SLATE_800 },
    alternateRowStyles: { fillColor: SLATE_100 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      1: { halign: 'center', cellWidth: 35 },
      2: { halign: 'right', cellWidth: 45, fontStyle: 'bold' },
      3: { halign: 'center', cellWidth: 35 },
    },
  });

  let sigY = (doc as any).lastAutoTable.finalY + 12;

  // Se ultrapassou limite, adiciona página para o termo
  if (sigY > pageHeight - 35) {
    doc.addPage();
    drawHeader(doc, pageWidth, 'Termo de Responsabilidade e Auditoria');
    sigY = 35;
  }

  // Termo de Responsabilidade
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.8);
  doc.setTextColor(...SLATE_500);
  doc.text(
    'Declaramos que o presente relatório reflete com exatidão a conferência física e contábil dos bens patrimoniais pertencentes à empresa, devidamente tombados, alocados e respaldados documentalmente com notas fiscais arquivadas.',
    14,
    sigY,
  );

  sigY += 12;

  // 3 Assinaturas
  doc.setDrawColor(...SLATE_800);
  doc.setLineWidth(0.3);

  const sigWidth = 75;
  const sigGap = (pageWidth - 28 - 3 * sigWidth) / 2;

  const signatures = [
    { title: 'Responsável pelo Tombamento', desc: 'Encarregado / Custodiante de Bens' },
    { title: 'Gerência da Loja / Filial', desc: 'Visto e Conferência Local' },
    { title: 'Auditoria de Patrimônio & Finanças', desc: 'Paris Dakar Controladoria' },
  ];

  signatures.forEach((sig, idx) => {
    const x = 14 + idx * (sigWidth + sigGap);
    doc.line(x, sigY, x + sigWidth, sigY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_800);
    doc.text(sig.title, x + sigWidth / 2, sigY + 4, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...SLATE_500);
    doc.text(sig.desc, x + sigWidth / 2, sigY + 7.5, { align: 'center' });
  });

  // Numeração de páginas e rodapés
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, pageWidth, pageHeight, i, totalPages);
  }

  const filename = `Tombamento_Patrimonio_Paris_Dakar_${Date.now()}.pdf`;
  doc.save(filename);
}
