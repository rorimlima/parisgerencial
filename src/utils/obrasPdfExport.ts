/**
 * obrasPdfExport.ts — Gerador de PDF Corporativo para Obras & Folha de Ponto
 *
 * Oferece:
 *  1. Relatório Geral Consolidado da Obra (Capa + Calendário + Folha de Pagamento)
 *  2. Relatório Descritivo Diário Individual por Funcionário (Dia a dia com Diárias, HEs e Assinaturas)
 *  3. Livro Descritivo Geral de Todos os Funcionários (Caderno consolidado com fichas individuais completas)
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
  }).format(value || 0);
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

const WEEKDAY_NAMES_FULL = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado',
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
      totalHorasExtras += Number(r.horasExtras) || 0;
    });

    const salarioDiarias = diasPresente * (Number(func.valorDiaria) || 0);
    const salarioMeiaDiaria = diasMeia * ((Number(func.valorDiaria) || 0) / 2);
    const salarioHorasExtras = totalHorasExtras * (Number(func.valorHoraExtra) || 0);
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

function drawHeader(
  doc: jsPDF,
  pageWidth: number,
  subtitulo: string,
  periodoStr: string,
) {
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

  // Data de emissão
  const nowStr = new Date().toLocaleString('pt-BR');
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text(`Emissão: ${nowStr}`, pageWidth - 14, 10.5, { align: 'right' });

  // Período
  doc.setTextColor(...GOLD_ACCENT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(periodoStr, pageWidth - 14, 16.5, { align: 'right' });
}

// ── Rodapé corporativo ──────────────────────────────────────────────────────

function drawFooter(
  doc: jsPDF,
  pageWidth: number,
  pageHeight: number,
  pageNum: number,
  totalPages: number,
  modulo: string = 'Gestão de Obras & Registro de Ponto',
) {
  doc.setDrawColor(...SLATE_200);
  doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Página ${pageNum} de ${totalPages} | Documento Corporativo Paris Dakar Gerencial — Auditoria Financeira & RH`,
    14,
    pageHeight - 6.5,
  );
  doc.text(modulo, pageWidth - 14, pageHeight - 6.5, { align: 'right' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. EXPORTAR PDF GERAL CONSOLIDADO DA OBRA (LANDSCAPE)
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

  const periodoStr = `${MONTH_NAMES[mes]} / ${ano}`;

  // ─── PÁGINA 1: CAPA CONSOLIDADA ───────────────────────────────────────────
  drawHeader(doc, pageWidth, 'Relatório Corporativo Consolidado de Obra', periodoStr);

  let y = 29;

  // Título da obra
  doc.setTextColor(...SLATE_800);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`OBRA: ${obra.nome.toUpperCase()}`, 14, y);
  y += 5.5;

  // Dados da obra
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_500);
  doc.text(`Endereço: ${obra.endereco || 'Não informado'} | Responsável: ${obra.responsavel || 'Não informado'}`, 14, y);
  y += 4.5;
  doc.text(`Período Obra: ${formatDateBr(obra.dataInicio)} a ${obra.dataFim ? formatDateBr(obra.dataFim) : 'Em aberto'} | Status: ${obra.status}`, 14, y);
  if (obra.observacao) {
    y += 4.5;
    doc.text(`Observações: ${obra.observacao}`, 14, y);
  }
  y += 8;

  // KPI Cards
  const cards = [
    { label: 'FUNCIONÁRIOS ATIVOS', value: String(totalFunc), color: BLUE },
    { label: 'DIÁRIAS INTEGRAIS', value: String(totalPresencas), color: GREEN },
    { label: 'MEIAS DIÁRIAS', value: String(totalMeias), color: AMBER },
    { label: 'FALTAS REGISTRADAS', value: String(totalFaltas), color: RED },
    { label: 'TOTAL HORAS EXTRAS', value: `${totalHE.toFixed(1)}h`, color: AMBER },
    { label: 'CUSTO TOTAL FOLHA', value: formatCurrency(custoTotal), color: PRIMARY_DARK },
  ];

  const cardW = 42;
  const cardH = 15;
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
    doc.text(card.label, x + 3, y + 5);

    doc.setFontSize(9.5);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 3, y + 11.5);
  });

  y += cardH + 8;

  // Tabela resumo de funcionários na capa
  doc.setFillColor(...SLATE_100);
  doc.rect(14, y, pageWidth - 28, 5.5, 'F');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, y, 3, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_800);
  doc.text('EQUIPE & TABELA DE VALORES BASE', 19, y + 3.8);
  y += 7.5;

  autoTable(doc, {
    startY: y,
    head: [['#', 'Nome do Funcionário', 'Função / Cargo', 'Valor Diária (R$)', 'Valor H.Extra (R$/h)', 'Observações', 'Status']],
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

  // ─── PÁGINA 2: GRADE DE FREQUÊNCIA MENSAL ────────────────────────────────
  const funcAtivos = funcionarios.filter((f) => f.status === 'Ativo');
  const halfDays = Math.ceil(daysInMonth / 2);

  // Primeira metade dos dias (1 a 15/16)
  doc.addPage();
  drawHeader(doc, pageWidth, 'Folha de Frequência Mensal — Dias 01 a ' + halfDays, periodoStr);

  let py = 29;
  const daysRange1 = Array.from({ length: halfDays }, (_, i) => i + 1);
  const pontoHeaders1 = ['Funcionário', 'Função', ...daysRange1.map((d) => String(d))];

  const pontoRows1 = funcAtivos.map((f) => {
    const cells: string[] = [f.nome, f.funcao];
    daysRange1.forEach((day) => {
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const reg = registros.find((r) => r.funcionarioId === f.id && r.data === dateStr);
      if (reg && reg.status) {
        let label = STATUS_LABELS[reg.status] || '—';
        if (Number(reg.horasExtras) > 0) label += `+${reg.horasExtras}`;
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
    drawHeader(doc, pageWidth, `Folha de Frequência Mensal — Dias ${halfDays + 1} a ${daysInMonth}`, periodoStr);

    py = 29;
    const pontoHeaders2 = ['Funcionário', 'Função', ...daysRange2.map((d) => String(d))];
    const pontoRows2 = funcAtivos.map((f) => {
      const cells: string[] = [f.nome, f.funcao];
      daysRange2.forEach((day) => {
        const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const reg = registros.find((r) => r.funcionarioId === f.id && r.data === dateStr);
        if (reg && reg.status) {
          let label = STATUS_LABELS[reg.status] || '—';
          if (Number(reg.horasExtras) > 0) label += `+${reg.horasExtras}`;
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

  // ─── PÁGINA FINAL: FOLHA DE PAGAMENTO CONSOLIDADA ─────────────────────────
  doc.addPage();
  drawHeader(doc, pageWidth, 'Folha de Pagamento & Liquidação de Diárias', periodoStr);

  py = 29;

  const pagHeaders = [
    '#', 'Funcionário', 'Função', 'Diárias (P)', 'Meias (½)', 'Faltas (F)', 'Folgas (FG)',
    'H. Extras', 'Valor Diárias', 'Valor Meias', 'Valor H.Extras', 'SALÁRIO TOTAL',
  ];

  const pagRows = resumos.map((r, i) => [
    String(i + 1),
    r.funcionario.nome,
    r.funcionario.funcao,
    String(r.diasPresente),
    String(r.diasMeia),
    String(r.diasFalta),
    String(r.diasFolga),
    `${r.totalHorasExtras.toFixed(1)}h`,
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
    '', 'TOTAL CONSOLIDADO', '',
    String(totalPresencas), String(totalMeias), String(totalFaltas),
    String(resumos.reduce((s, r) => s + r.diasFolga, 0)),
    `${totalHE.toFixed(1)}h`,
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
      if (data.section === 'body' && data.row.index === pagRows.length - 1) {
        data.cell.styles.fillColor = [30, 41, 59];
        data.cell.styles.textColor = WHITE;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.column.index === 11 && data.row.index < pagRows.length - 1) {
        data.cell.styles.textColor = GREEN;
      }
    },
  });

  // Assinaturas
  const sigY = (doc as any).lastAutoTable.finalY + 18;
  if (sigY < pageHeight - 25) {
    doc.setDrawColor(...SLATE_800);
    doc.setLineWidth(0.3);

    const sigWidth = 65;
    const sigGap = 20;
    const sigStart = (pageWidth - 3 * sigWidth - 2 * sigGap) / 2;

    const sigs = [
      `Responsável da Obra\n${obra.responsavel || 'Engenharia / Encarregado'}`,
      'Engenheiro Residente / Fiscal',
      'Auditoria de RH & Financeiro',
    ];

    sigs.forEach((label, i) => {
      const x = sigStart + i * (sigWidth + sigGap);
      doc.line(x, sigY, x + sigWidth, sigY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...SLATE_500);
      const lines = label.split('\n');
      lines.forEach((line, li) => {
        doc.text(line, x + sigWidth / 2, sigY + 4 + li * 3.5, { align: 'center' });
      });
    });
  }

  // Rodapé
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, pageWidth, pageHeight, i, totalPages, 'Gestão de Obras — Relatório Consolidado');
  }

  const monthStr = String(mes).padStart(2, '0');
  const filename = `Obra_${obra.nome.replace(/\s+/g, '_')}_Consolidado_${monthStr}_${ano}.pdf`;
  doc.save(filename);
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. EXPORTAR PDF INDIVIDUAL DETALHADO POR FUNCIONÁRIO (PORTRAIT - DIA A DIA)
// ═══════════════════════════════════════════════════════════════════════════

function renderFuncionarioDetalhadoPagina(
  doc: jsPDF,
  obra: Obra,
  funcionario: FuncionarioObra,
  registros: RegistroPonto[],
  mes: number,
  ano: number,
  pageWidth: number,
  pageHeight: number,
) {
  const daysInMonth = getDaysInMonth(mes, ano);
  const periodoStr = `${MONTH_NAMES[mes]} / ${ano}`;

  drawHeader(
    doc,
    pageWidth,
    'Relatório Individual Descritivo de Frequência & Remuneração',
    periodoStr,
  );

  let y = 28;

  // Box com informações do funcionário e da obra
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...SLATE_200);
  doc.roundedRect(14, y, pageWidth - 28, 26, 2, 2, 'FD');
  doc.setFillColor(...GOLD_ACCENT);
  doc.rect(14, y, 2.5, 26, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...SLATE_800);
  doc.text(`FUNCIONÁRIO: ${funcionario.nome.toUpperCase()}`, 20, y + 6);

  doc.setFontSize(8);
  doc.setTextColor(...SLATE_500);
  doc.text(`Função / Cargo: ${funcionario.funcao}`, 20, y + 11.5);
  doc.text(`Obra: ${obra.nome} | Responsável: ${obra.responsavel || '—'}`, 20, y + 16.5);
  doc.text(`Endereço da Obra: ${obra.endereco || '—'}`, 20, y + 21.5);

  // Valores base do lado direito
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SLATE_800);
  doc.text(`Diária Base: ${formatCurrency(funcionario.valorDiaria)}`, pageWidth - 20, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE_500);
  doc.text(`Hora Extra: ${formatCurrency(funcionario.valorHoraExtra)}/h`, pageWidth - 20, y + 11.5, { align: 'right' });
  doc.text(`Status: ${funcionario.status}`, pageWidth - 20, y + 16.5, { align: 'right' });
  if (funcionario.observacao) {
    doc.text(`Obs: ${funcionario.observacao}`, pageWidth - 20, y + 21.5, { align: 'right' });
  }

  y += 30;

  // Apuração do mês para o funcionário
  let diasPresente = 0;
  let diasMeia = 0;
  let diasFalta = 0;
  let diasFolga = 0;
  let totalHE = 0;

  const rowsDescritivas: (string | number)[][] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(ano, mes - 1, day);
    const dow = dateObj.getDay();
    const diaSemana = WEEKDAY_NAMES_FULL[dow];
    const isWeekend = dow === 0 || dow === 6;

    const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dateFormatted = `${String(day).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;

    const reg = registros.find((r) => r.funcionarioId === funcionario.id && r.data === dateStr);
    const status: StatusPonto | 'nenhum' = reg?.status || (isWeekend ? 'folga' : 'nenhum');
    const horasExtras = Number(reg?.horasExtras) || 0;

    let statusTexto = 'Não registrado';
    let valorDiariaDia = 0;

    if (status === 'presente') {
      diasPresente++;
      statusTexto = 'Presente (Integral)';
      valorDiariaDia = Number(funcionario.valorDiaria) || 0;
    } else if (status === 'meia') {
      diasMeia++;
      statusTexto = 'Meia Diária (50%)';
      valorDiariaDia = (Number(funcionario.valorDiaria) || 0) / 2;
    } else if (status === 'falta') {
      diasFalta++;
      statusTexto = 'Falta';
      valorDiariaDia = 0;
    } else if (status === 'folga') {
      diasFolga++;
      statusTexto = isWeekend ? `Fim de Semana (${diaSemana})` : 'Folga';
      valorDiariaDia = 0;
    } else if (isWeekend) {
      diasFolga++;
      statusTexto = `Fim de Semana (${diaSemana})`;
      valorDiariaDia = 0;
    }

    totalHE += horasExtras;
    const valorHEDia = horasExtras * (Number(funcionario.valorHoraExtra) || 0);
    const totalDia = valorDiariaDia + valorHEDia;

    rowsDescritivas.push([
      dateFormatted,
      diaSemana,
      statusTexto,
      valorDiariaDia > 0 ? formatCurrency(valorDiariaDia) : '—',
      horasExtras > 0 ? `${horasExtras.toFixed(1)}h` : '—',
      valorHEDia > 0 ? formatCurrency(valorHEDia) : '—',
      totalDia > 0 ? formatCurrency(totalDia) : '—',
      reg?.observacao || '',
    ]);
  }

  const salarioDiarias = diasPresente * (Number(funcionario.valorDiaria) || 0);
  const salarioMeias = diasMeia * ((Number(funcionario.valorDiaria) || 0) / 2);
  const salarioHE = totalHE * (Number(funcionario.valorHoraExtra) || 0);
  const salarioLiquidoTotal = salarioDiarias + salarioMeias + salarioHE;

  // Mini KPI Cards no topo da tabela
  const kpis = [
    { label: 'PRESENÇAS', val: `${diasPresente}d`, col: GREEN },
    { label: 'MEIAS', val: `${diasMeia}d`, col: AMBER },
    { label: 'FALTAS', val: `${diasFalta}d`, col: RED },
    { label: 'FOLGAS / FDS', val: `${diasFolga}d`, col: BLUE },
    { label: 'HORAS EXTRAS', val: `${totalHE.toFixed(1)}h`, col: AMBER },
    { label: 'SALÁRIO LÍQUIDO', val: formatCurrency(salarioLiquidoTotal), col: PRIMARY_DARK },
  ];

  const kw = (pageWidth - 28 - 5 * 3) / 6;
  kpis.forEach((k, idx) => {
    const kx = 14 + idx * (kw + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...SLATE_200);
    doc.roundedRect(kx, y, kw, 12.5, 1, 1, 'FD');
    doc.setFillColor(...k.col);
    doc.rect(kx, y, kw, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(...SLATE_500);
    doc.text(k.label, kx + 2, y + 4.5);
    doc.setFontSize(8);
    doc.setTextColor(...k.col);
    doc.text(k.val, kx + 2, y + 9.8);
  });

  y += 16;

  // Tabela Diária
  autoTable(doc, {
    startY: y,
    head: [[
      'Data',
      'Dia da Semana',
      'Situação / Frequência',
      'Valor Diária',
      'Horas Extras',
      'Valor H.Extra',
      'Total do Dia',
      'Obs.',
    ]],
    body: rowsDescritivas,
    theme: 'grid',
    headStyles: {
      fillColor: PRIMARY_DARK,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 6.5,
      halign: 'center',
      valign: 'middle',
    },
    bodyStyles: {
      fontSize: 6.2,
      textColor: SLATE_800,
      valign: 'middle',
      cellPadding: 1.2,
    },
    alternateRowStyles: {
      fillColor: SLATE_100,
    },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 18 },
      1: { cellWidth: 24 },
      2: { cellWidth: 38 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'center', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 20 },
      6: { halign: 'right', cellWidth: 22, fontStyle: 'bold' },
      7: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const raw = String(data.row.raw[2] || '');
        if (raw.startsWith('Presente')) {
          if (data.column.index === 2) data.cell.styles.textColor = GREEN;
        } else if (raw.startsWith('Meia')) {
          if (data.column.index === 2) data.cell.styles.textColor = AMBER;
        } else if (raw.startsWith('Falta')) {
          if (data.column.index === 2) data.cell.styles.textColor = RED;
          data.cell.styles.fillColor = [254, 242, 242];
        } else if (raw.startsWith('Fim de Semana') || raw === 'Folga') {
          if (data.column.index === 2) data.cell.styles.textColor = SLATE_500;
        }
      }
    },
  });

  let finalTableY = (doc as any).lastAutoTable.finalY + 4;

  // Se a tabela ultrapassou o espaço para o resumo/assinatura, adiciona página
  if (finalTableY > pageHeight - 42) {
    doc.addPage();
    drawHeader(
      doc,
      pageWidth,
      'Relatório Individual Descritivo — Resumo & Assinaturas',
      periodoStr,
    );
    finalTableY = 28;
  }

  // Card de Totais Finais
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...SLATE_200);
  doc.roundedRect(14, finalTableY, pageWidth - 28, 14, 1.5, 1.5, 'FD');
  doc.setFillColor(...PRIMARY_DARK);
  doc.rect(14, finalTableY, 2, 14, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE_800);
  doc.text(
    `SUBTOTAL DIÁRIAS: ${formatCurrency(salarioDiarias + salarioMeias)} (${diasPresente} integrais + ${diasMeia} meias)`,
    19,
    finalTableY + 5.5,
  );
  doc.text(
    `SUBTOTAL HORAS EXTRAS: ${formatCurrency(salarioHE)} (${totalHE.toFixed(1)} horas acumuladas no mês)`,
    19,
    finalTableY + 10.5,
  );

  doc.setFontSize(10);
  doc.setTextColor(...GREEN);
  doc.text(
    `TOTAL LÍQUIDO A RECEBER: ${formatCurrency(salarioLiquidoTotal)}`,
    pageWidth - 18,
    finalTableY + 8.5,
    { align: 'right' },
  );

  finalTableY += 18;

  // Termo de quitação e declaração
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.2);
  doc.setTextColor(...SLATE_500);
  doc.text(
    'Declaro que conferi os lançamentos de dias trabalhados e horas extras acima, estando de pleno acordo com a apuração de valores prestados.',
    14,
    finalTableY,
  );

  finalTableY += 11;

  // Duas assinaturas
  doc.setDrawColor(...SLATE_800);
  doc.setLineWidth(0.3);

  const sigW = 75;
  const sigGap = (pageWidth - 28 - 2 * sigW);

  // Assinatura do Funcionário
  doc.line(14, finalTableY, 14 + sigW, finalTableY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_800);
  doc.text(funcionario.nome, 14 + sigW / 2, finalTableY + 3.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...SLATE_500);
  doc.text(`Assinatura do Funcionário (${funcionario.funcao})`, 14 + sigW / 2, finalTableY + 6.8, { align: 'center' });

  // Assinatura do Responsável
  const x2 = 14 + sigW + sigGap;
  doc.line(x2, finalTableY, x2 + sigW, finalTableY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_800);
  doc.text(obra.responsavel || 'Engenheiro / Responsável da Obra', x2 + sigW / 2, finalTableY + 3.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...SLATE_500);
  doc.text('Aprovação da Engenharia / Auditoria de RH', x2 + sigW / 2, finalTableY + 6.8, { align: 'center' });
}

export function exportFuncionarioDetalhadoPdf(
  obra: Obra,
  funcionario: FuncionarioObra,
  registros: RegistroPonto[],
  mes: number,
  ano: number,
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;

  renderFuncionarioDetalhadoPagina(doc, obra, funcionario, registros, mes, ano, pageWidth, pageHeight);

  // Rodapé em todas as páginas
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, pageWidth, pageHeight, i, totalPages, `Ficha Individual — ${funcionario.nome}`);
  }

  const monthStr = String(mes).padStart(2, '0');
  const filename = `Ponto_${funcionario.nome.replace(/\s+/g, '_')}_${monthStr}_${ano}.pdf`;
  doc.save(filename);
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. EXPORTAR CADERNO DESCRITIVO COMPLETO DE TODOS OS FUNCIONÁRIOS (PORTRAIT)
// ═══════════════════════════════════════════════════════════════════════════

export function exportTodosFuncionariosDetalhadosPdf(
  obra: Obra,
  funcionarios: FuncionarioObra[],
  registros: RegistroPonto[],
  mes: number,
  ano: number,
) {
  const funcAtivos = funcionarios.filter((f) => f.status === 'Ativo');
  if (funcAtivos.length === 0) return;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;

  funcAtivos.forEach((func, idx) => {
    if (idx > 0) {
      doc.addPage();
    }
    renderFuncionarioDetalhadoPagina(doc, obra, func, registros, mes, ano, pageWidth, pageHeight);
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, pageWidth, pageHeight, i, totalPages, 'Caderno Descritivo Geral de Funcionários');
  }

  const monthStr = String(mes).padStart(2, '0');
  const filename = `Obra_${obra.nome.replace(/\s+/g, '_')}_Livro_Pontos_Detalhados_${monthStr}_${ano}.pdf`;
  doc.save(filename);
}
