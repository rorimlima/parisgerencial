/**
 * obrasPdfExport.ts — Gerador de PDF Corporativo para Obras
 *
 * Gera relatório profissional completo com:
 *  - Capa com dados da obra e KPIs
 *  - Folha de ponto detalhada (calendário mensal)
 *  - Folha de pagamento com salários calculados
 *  - Rodapé corporativo Paris Dakar em todas as páginas
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Obra, FuncionarioObra, RegistroPonto, ResumoFuncionarioObra, StatusPonto } from '../types';

// ── Cores corporativas ──────────────────────────────────────────────────────
const PRIMARY_DARK: [number, number, number] = [30, 41, 59];
const GOLD_ACCENT: [number, number, number] = [193, 154, 107];
const WHITE: [number, number, number] = [255, 255, 255];
const SLATE_100: [number, number, number] = [241, 245, 249];
const SLATE_200: [number, number, number] = [226, 232, 240];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_800: [number, number, number] = [30, 41, 59];
const GREEN: [number, number, number] = [22, 163, 74];
const RED: [number, number, number] = [220, 38, 38];
const AMBER: [number, number, number] = [217, 119, 6];
const BLUE: [number, number, number] = [37, 99, 235];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDateBr(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

const MONTH_NAMES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const STATUS_LABELS: Record<StatusPonto, string> = {
  presente: 'P',
  meia: '½',
  falta: 'F',
  folga: 'FG',
};

// ── Cálculo de Resumo ───────────────────────────────────────────────────────

export function calcularResumos(
  funcionarios: FuncionarioObra[],
  registros: RegistroPonto[],
): ResumoFuncionarioObra[] {
  return funcionarios.map((func) => {
    const regs = registros.filter((r) => r.funcionarioId === func.id);
    let diasPresente = 0;
    let diasMeia = 0;
    let diasFalta = 0;
    let diasFolga = 0;
    let totalHorasExtras = 0;

    regs.forEach((r) => {
      switch (r.status) {
        case 'presente': diasPresente++; break;
        case 'meia': diasMeia++; break;
        case 'falta': diasFalta++; break;
        case 'folga': diasFolga++; break;
      }
      totalHorasExtras += r.horasExtras || 0;
    });

    const salarioDiarias = diasPresente * func.valorDiaria;
    const salarioMeiaDiaria = diasMeia * (func.valorDiaria / 2);
    const salarioHorasExtras = totalHorasExtras * func.valorHoraExtra;
    const salarioTotal = salarioDiarias + salarioMeiaDiaria + salarioHorasExtras;

    return {
      funcionario: func,
      diasPresente,
      diasMeia,
      diasFalta,
      diasFolga,
      totalHorasExtras,
      salarioDiarias,
      salarioMeiaDiaria,
      salarioHorasExtras,
      salarioTotal,
    };
  });
}

// ── Cabeçalho corporativo ───────────────────────────────────────────────────

function drawHeader(doc: jsPDF, pageWidth: number, obra: Obra, mes: number, ano: number) {
  // Banner escuro
  doc.setFillColor(...PRIMARY_DARK);
  doc.rect(0, 0, pageWidth, 22, 'F');

  // Faixa dourada
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(0, 22, pageWidth, 1.5, 'F');

  // Título
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PARIS DAKAR GERENCIAL', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Relatório Corporativo de Gestão de Obras', 14, 17);

  // Data de emissão
  const nowStr = new Date().toLocaleString('pt-BR');
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  doc.text(`Gerado em: ${nowStr}`, pageWidth - 14, 11, { align: 'right' });

  // Período
  doc.setTextColor(...GOLD_ACCENT);
  doc.text(`${MONTH_NAMES[mes]} / ${ano}`, pageWidth - 14, 17, { align: 'right' });
}

// ── Rodapé corporativo ──────────────────────────────────────────────────────

function drawFooter(doc: jsPDF, pageWidth: number, pageHeight: number, pageNum: number, totalPages: number) {
  doc.setDrawColor(...SLATE_200);
  doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Página ${pageNum} de ${totalPages} | Documento Corporativo Paris Dakar Gerencial`,
    14,
    pageHeight - 7,
  );
  doc.text('Módulo: Obras & Registro de Ponto', pageWidth - 14, pageHeight - 7, { align: 'right' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPORTAR PDF COMPLETO DA OBRA
// ═══════════════════════════════════════════════════════════════════════════

export function exportObraPdf(
  obra: Obra,
  funcionarios: FuncionarioObra[],
  registros: RegistroPonto[],
  mes: number,
  ano: number,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;
  const daysInMonth = getDaysInMonth(mes, ano);
  const resumos = calcularResumos(funcionarios, registros);
  const custoTotal = resumos.reduce((s, r) => s + r.salarioTotal, 0);
  const totalFunc = funcionarios.filter((f) => f.status === 'Ativo').length;
  const totalPresencas = resumos.reduce((s, r) => s + r.diasPresente, 0);
  const totalMeias = resumos.reduce((s, r) => s + r.diasMeia, 0);
  const totalFaltas = resumos.reduce((s, r) => s + r.diasFalta, 0);
  const totalHE = resumos.reduce((s, r) => s + r.totalHorasExtras, 0);

  // ─── PÁGINA 1: CAPA ──────────────────────────────────────────────────────
  drawHeader(doc, pageWidth, obra, mes, ano);

  let y = 30;

  // Título da obra
  doc.setTextColor(...SLATE_800);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`OBRA: ${obra.nome.toUpperCase()}`, 14, y);
  y += 7;

  // Dados da obra
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_500);
  doc.text(`Endereço: ${obra.endereco || '—'}`, 14, y);
  y += 5;
  doc.text(`Responsável: ${obra.responsavel || '—'}`, 14, y);
  y += 5;
  doc.text(`Período: ${formatDateBr(obra.dataInicio)} a ${obra.dataFim ? formatDateBr(obra.dataFim) : 'Em aberto'}`, 14, y);
  y += 5;
  doc.text(`Status: ${obra.status}`, 14, y);
  if (obra.observacao) {
    y += 5;
    doc.text(`Obs: ${obra.observacao}`, 14, y);
  }
  y += 10;

  // KPI Cards
  const cards = [
    { label: 'FUNCIONÁRIOS ATIVOS', value: String(totalFunc), color: BLUE },
    { label: 'TOTAL PRESENÇAS', value: String(totalPresencas), color: GREEN },
    { label: 'MEIAS DIÁRIAS', value: String(totalMeias), color: AMBER },
    { label: 'TOTAL FALTAS', value: String(totalFaltas), color: RED },
    { label: 'HORAS EXTRAS', value: `${totalHE}h`, color: AMBER },
    { label: 'CUSTO TOTAL', value: formatCurrency(custoTotal), color: PRIMARY_DARK },
  ];

  const cardW = 42;
  const cardH = 16;
  const gap = 4;

  cards.forEach((card, i) => {
    const x = 14 + i * (cardW + gap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...SLATE_200);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(...card.color);
    doc.rect(x, y, cardW, 1.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...SLATE_500);
    doc.text(card.label, x + 3, y + 5.5);

    doc.setFontSize(10);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 3, y + 12.5);
  });

  y += cardH + 10;

  // Tabela resumo de funcionários na capa
  doc.setFillColor(...SLATE_100);
  doc.rect(14, y, pageWidth - 28, 6, 'F');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, y, 3, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_800);
  doc.text('QUADRO DE FUNCIONÁRIOS', 19, y + 4.2);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['#', 'Nome', 'Função', 'Valor Diária', 'Valor Hora Extra', 'Observação', 'Status']],
    body: funcionarios.map((f, i) => [
      String(i + 1),
      f.nome,
      f.funcao,
      formatCurrency(f.valorDiaria),
      formatCurrency(f.valorHoraExtra),
      f.observacao || '—',
      f.status,
    ]),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
    bodyStyles: { fontSize: 7.5, textColor: SLATE_800, valign: 'middle' },
    alternateRowStyles: { fillColor: SLATE_100 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      3: { halign: 'right' },
      4: { halign: 'right' },
      6: { halign: 'center', cellWidth: 18 },
    },
  });

  // ─── PÁGINA 2+: FOLHA DE PONTO ───────────────────────────────────────────

  // Divide dias: se > 20 funcionários ou > 16 dias em landscape, dividir
  const funcAtivos = funcionarios.filter((f) => f.status === 'Ativo');
  const halfDays = Math.ceil(daysInMonth / 2);

  // Primeira metade dos dias (1 a 15)
  doc.addPage();
  drawHeader(doc, pageWidth, obra, mes, ano);

  let py = 30;
  doc.setFillColor(...SLATE_100);
  doc.rect(14, py, pageWidth - 28, 6, 'F');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, py, 3, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_800);
  doc.text(`FOLHA DE PONTO — ${MONTH_NAMES[mes].toUpperCase()} / ${ano} — DIAS 1 A ${halfDays}`, 19, py + 4.2);
  py += 8;

  const daysRange1 = Array.from({ length: halfDays }, (_, i) => i + 1);
  const pontoHeaders1 = ['Funcionário', 'Função', ...daysRange1.map((d) => String(d))];

  const pontoRows1 = funcAtivos.map((f) => {
    const cells: string[] = [f.nome, f.funcao];
    daysRange1.forEach((day) => {
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const reg = registros.find((r) => r.funcionarioId === f.id && r.data === dateStr);
      if (reg) {
        let label = STATUS_LABELS[reg.status];
        if (reg.horasExtras > 0) label += `+${reg.horasExtras}`;
        cells.push(label);
      } else {
        cells.push('—');
      }
    });
    return cells;
  });

  const dayColWidth = Math.min(12, (pageWidth - 28 - 55 - 35) / daysRange1.length);
  const pontoColStyles1: Record<number, any> = {
    0: { cellWidth: 55, fontStyle: 'bold' },
    1: { cellWidth: 35, halign: 'center' },
  };
  daysRange1.forEach((_, i) => {
    pontoColStyles1[i + 2] = { halign: 'center', cellWidth: dayColWidth, fontSize: 6.5 };
  });

  autoTable(doc, {
    startY: py,
    head: [pontoHeaders1],
    body: pontoRows1,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 6.5, halign: 'center' },
    bodyStyles: { fontSize: 6.5, textColor: SLATE_800, valign: 'middle' },
    alternateRowStyles: { fillColor: SLATE_100 },
    margin: { left: 14, right: 14 },
    columnStyles: pontoColStyles1,
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index >= 2) {
        const val = String(data.cell.raw);
        if (val.startsWith('P')) data.cell.styles.textColor = GREEN;
        else if (val.startsWith('½')) data.cell.styles.textColor = AMBER;
        else if (val === 'F') data.cell.styles.textColor = RED;
        else if (val === 'FG') data.cell.styles.textColor = BLUE;
      }
    },
  });

  // Segunda metade dos dias
  const daysRange2 = Array.from({ length: daysInMonth - halfDays }, (_, i) => halfDays + i + 1);
  if (daysRange2.length > 0) {
    doc.addPage();
    drawHeader(doc, pageWidth, obra, mes, ano);

    py = 30;
    doc.setFillColor(...SLATE_100);
    doc.rect(14, py, pageWidth - 28, 6, 'F');
    doc.setFillColor(...GOLD_ACCENT);
    doc.rect(14, py, 3, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_800);
    doc.text(`FOLHA DE PONTO — ${MONTH_NAMES[mes].toUpperCase()} / ${ano} — DIAS ${halfDays + 1} A ${daysInMonth}`, 19, py + 4.2);
    py += 8;

    const pontoHeaders2 = ['Funcionário', 'Função', ...daysRange2.map((d) => String(d))];
    const pontoRows2 = funcAtivos.map((f) => {
      const cells: string[] = [f.nome, f.funcao];
      daysRange2.forEach((day) => {
        const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const reg = registros.find((r) => r.funcionarioId === f.id && r.data === dateStr);
        if (reg) {
          let label = STATUS_LABELS[reg.status];
          if (reg.horasExtras > 0) label += `+${reg.horasExtras}`;
          cells.push(label);
        } else {
          cells.push('—');
        }
      });
      return cells;
    });

    const dayColWidth2 = Math.min(12, (pageWidth - 28 - 55 - 35) / daysRange2.length);
    const pontoColStyles2: Record<number, any> = {
      0: { cellWidth: 55, fontStyle: 'bold' },
      1: { cellWidth: 35, halign: 'center' },
    };
    daysRange2.forEach((_, i) => {
      pontoColStyles2[i + 2] = { halign: 'center', cellWidth: dayColWidth2, fontSize: 6.5 };
    });

    autoTable(doc, {
      startY: py,
      head: [pontoHeaders2],
      body: pontoRows2,
      theme: 'grid',
      headStyles: { fillColor: PRIMARY_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 6.5, halign: 'center' },
      bodyStyles: { fontSize: 6.5, textColor: SLATE_800, valign: 'middle' },
      alternateRowStyles: { fillColor: SLATE_100 },
      margin: { left: 14, right: 14 },
      columnStyles: pontoColStyles2,
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index >= 2) {
          const val = String(data.cell.raw);
          if (val.startsWith('P')) data.cell.styles.textColor = GREEN;
          else if (val.startsWith('½')) data.cell.styles.textColor = AMBER;
          else if (val === 'F') data.cell.styles.textColor = RED;
          else if (val === 'FG') data.cell.styles.textColor = BLUE;
        }
      },
    });
  }

  // Legenda do ponto
  const legendY = (doc as any).lastAutoTable.finalY + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_500);
  doc.text('LEGENDA:', 14, legendY);
  doc.setFont('helvetica', 'normal');

  const legends = [
    { label: 'P = Presente (Diária Completa)', color: GREEN },
    { label: '½ = Meia Diária', color: AMBER },
    { label: 'F = Falta', color: RED },
    { label: 'FG = Folga', color: BLUE },
    { label: '+N = Horas Extras', color: SLATE_500 },
  ];
  let lx = 36;
  legends.forEach((l) => {
    doc.setTextColor(...l.color);
    doc.text(l.label, lx, legendY);
    lx += doc.getTextWidth(l.label) + 8;
  });

  // ─── ÚLTIMA PÁGINA: FOLHA DE PAGAMENTO ────────────────────────────────────

  doc.addPage();
  drawHeader(doc, pageWidth, obra, mes, ano);

  py = 30;
  doc.setFillColor(...SLATE_100);
  doc.rect(14, py, pageWidth - 28, 6, 'F');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, py, 3, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_800);
  doc.text(`FOLHA DE PAGAMENTO — ${MONTH_NAMES[mes].toUpperCase()} / ${ano}`, 19, py + 4.2);
  py += 8;

  const pagHeaders = [
    '#', 'Funcionário', 'Função', 'Presenças', 'Meias', 'Faltas', 'Folgas',
    'Horas Extras', 'Valor Diárias', 'Valor Meias', 'Valor HEs', 'SALÁRIO TOTAL',
  ];

  const pagRows = resumos.map((r, i) => [
    String(i + 1),
    r.funcionario.nome,
    r.funcionario.funcao,
    String(r.diasPresente),
    String(r.diasMeia),
    String(r.diasFalta),
    String(r.diasFolga),
    `${r.totalHorasExtras}h`,
    formatCurrency(r.salarioDiarias),
    formatCurrency(r.salarioMeiaDiaria),
    formatCurrency(r.salarioHorasExtras),
    formatCurrency(r.salarioTotal),
  ]);

  // Linha de totais
  const totalDiarias = resumos.reduce((s, r) => s + r.salarioDiarias, 0);
  const totalMeiaDiaria = resumos.reduce((s, r) => s + r.salarioMeiaDiaria, 0);
  const totalHEVal = resumos.reduce((s, r) => s + r.salarioHorasExtras, 0);

  pagRows.push([
    '', 'TOTAL GERAL', '',
    String(totalPresencas), String(totalMeias), String(totalFaltas),
    String(resumos.reduce((s, r) => s + r.diasFolga, 0)),
    `${totalHE}h`,
    formatCurrency(totalDiarias),
    formatCurrency(totalMeiaDiaria),
    formatCurrency(totalHEVal),
    formatCurrency(custoTotal),
  ]);

  autoTable(doc, {
    startY: py,
    head: [pagHeaders],
    body: pagRows,
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_DARK, textColor: WHITE, fontStyle: 'bold', fontSize: 7, halign: 'center' },
    bodyStyles: { fontSize: 7, textColor: SLATE_800, valign: 'middle' },
    alternateRowStyles: { fillColor: SLATE_100 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { fontStyle: 'bold' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center' },
      6: { halign: 'center' },
      7: { halign: 'center' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      // Última linha = totais
      if (data.section === 'body' && data.row.index === pagRows.length - 1) {
        data.cell.styles.fillColor = [30, 41, 59];
        data.cell.styles.textColor = WHITE;
        data.cell.styles.fontStyle = 'bold';
      }
      // Coluna de salário total em verde para linhas normais
      if (data.section === 'body' && data.column.index === 11 && data.row.index < pagRows.length - 1) {
        data.cell.styles.textColor = GREEN;
      }
    },
  });

  // Área de assinaturas
  const sigY = (doc as any).lastAutoTable.finalY + 20;
  if (sigY < pageHeight - 30) {
    doc.setDrawColor(...SLATE_800);
    doc.setLineWidth(0.3);

    const sigWidth = 65;
    const sigGap = 20;
    const sigStart = (pageWidth - 3 * sigWidth - 2 * sigGap) / 2;

    const sigs = [
      `Responsável da Obra\n${obra.responsavel || '_______________'}`,
      'Engenheiro / Encarregado',
      'Departamento de RH',
    ];

    sigs.forEach((label, i) => {
      const x = sigStart + i * (sigWidth + sigGap);
      doc.line(x, sigY, x + sigWidth, sigY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE_500);
      const lines = label.split('\n');
      lines.forEach((line, li) => {
        doc.text(line, x + sigWidth / 2, sigY + 5 + li * 4, { align: 'center' });
      });
    });
  }

  // ── Rodapé em todas as páginas ────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, pageWidth, pageHeight, i, totalPages);
  }

  // ── Salvar ────────────────────────────────────────────────────────────────
  const monthStr = String(mes).padStart(2, '0');
  const filename = `Obra_${obra.nome.replace(/\s+/g, '_')}_Ponto_${monthStr}_${ano}.pdf`;
  doc.save(filename);
}
