/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PAINEL DE ACORDOS — acompanhamento do cumprimento
 * ─────────────────────────────────────────────────
 * Fechar o acordo é a parte fácil. O valor deste painel está em responder,
 * todo dia, uma única pergunta: quais acordos quebraram?
 *
 * Por isso o status é DERIVADO das parcelas (`recomputeAgreement`) e não digitado.
 * Status digitado envelhece — o acordo continua marcado "Ativo" meses depois de
 * o cliente ter parado de pagar, e a carteira renegociada aparenta saúde que não
 * tem. Aqui, uma parcela vencida e não quitada quebra o acordo na hora.
 */

import React, { useMemo, useState } from 'react';
import {
  Handshake,
  AlertTriangle,
  CheckCircle2,
  Ban,
  Clock,
  Search,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  Download,
} from 'lucide-react';
import { DebtAgreement, AgreementInstallment } from '../types';
import { formatCurrency, exportReportToExcel } from '../utils/exportUtils';
import { money, recomputeAgreement, safeNum } from '../utils/negotiation';
import { WhatsAppLink } from './WhatsAppLink';

interface AgreementsPanelProps {
  agreements: DebtAgreement[];
  canEdit: boolean;
  canDelete: boolean;
  onUpdate: (agreement: DebtAgreement) => void | Promise<void>;
  onEdit: (agreement: DebtAgreement) => void;
  onDelete: (agreement: DebtAgreement) => void | Promise<void>;
}

const STATUS_STYLE: Record<DebtAgreement['status'], string> = {
  Ativo: 'bg-[#C19A6B]/15 text-[#8B6B3D] border-[#C19A6B]/40',
  Cumprido: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Quebrado: 'bg-rose-50 text-rose-800 border-rose-200',
  Cancelado: 'bg-[#F3F1ED] text-[#8B7D6B] border-[#EAE6DF]',
};

const INSTALLMENT_STYLE: Record<AgreementInstallment['status'], string> = {
  Paga: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Pendente: 'bg-[#F3F1ED] text-[#8B7D6B] border-[#EAE6DF]',
  Atrasada: 'bg-rose-50 text-rose-800 border-rose-200',
  Parcial: 'bg-amber-50 text-amber-800 border-amber-200',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export const AgreementsPanel: React.FC<AgreementsPanelProps> = ({
  agreements,
  canEdit,
  canDelete,
  onUpdate,
  onEdit,
  onDelete,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Recalcula tudo na leitura: o painel nunca confia no status gravado.
  const live = useMemo(
    () => agreements.map((a) => ({ ...a, ...recomputeAgreement(a) })),
    [agreements]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.customerName?.toLowerCase().includes(q) ||
        a.code?.toLowerCase().includes(q) ||
        a.customerCode?.toLowerCase().includes(q) ||
        a.titleNumbers?.some((n) => n?.toLowerCase().includes(q))
      );
    });
  }, [live, statusFilter, search]);

  const kpis = useMemo(() => {
    const acc = { ativos: 0, quebrados: 0, cumpridos: 0, acordado: 0, recebido: 0, aReceber: 0, descontos: 0 };
    for (const a of live) {
      if (a.status === 'Ativo') acc.ativos++;
      if (a.status === 'Quebrado') acc.quebrados++;
      if (a.status === 'Cumprido') acc.cumpridos++;
      if (a.status === 'Cancelado') continue;
      acc.acordado += a.agreedTotal;
      acc.recebido += a.totalPaid;
      acc.aReceber += a.totalOutstanding;
      acc.descontos += a.discountAmount;
    }
    return {
      ...acc,
      acordado: money(acc.acordado),
      recebido: money(acc.recebido),
      aReceber: money(acc.aReceber),
      descontos: money(acc.descontos),
    };
  }, [live]);

  /** Baixa de parcela: grava o valor recebido e deixa o status se recalcular. */
  const registerPayment = async (
    agreement: DebtAgreement,
    installmentNumber: number,
    paidAmount: number,
    paidDate: string
  ) => {
    const installments = agreement.installments.map((p) =>
      p.number === installmentNumber
        ? { ...p, paidAmount: money(paidAmount), paidDate: paidDate || todayIso() }
        : p
    );
    const draft = { ...agreement, installments };
    await onUpdate({ ...draft, ...recomputeAgreement(draft) });
  };

  const clearPayment = async (agreement: DebtAgreement, installmentNumber: number) => {
    const installments = agreement.installments.map((p) =>
      p.number === installmentNumber ? { ...p, paidAmount: 0, paidDate: '', status: 'Pendente' as const } : p
    );
    const draft = { ...agreement, installments };
    await onUpdate({ ...draft, ...recomputeAgreement(draft) });
  };

  const exportAgreements = () => {
    const rows = filtered.map((a) => ({
      Codigo: a.code,
      Cliente: a.customerName,
      CNPJ_CPF: a.cnpjCpf || '',
      Titulos: (a.titleNumbers || []).join(' | '),
      Divida_Atualizada: a.updatedDebt,
      Desconto: a.discountAmount,
      Total_Acordado: a.agreedTotal,
      Entrada: a.downPayment,
      Parcelas: a.installmentCount,
      Valor_Parcela: a.installmentAmount,
      Total_Pago: a.totalPaid,
      Saldo_Devedor: a.totalOutstanding,
      Status: a.status,
      Negociado_Por: a.negotiatedBy,
      Negociado_Em: a.negotiatedAt,
      Observacoes: a.notes || '',
    })) as Record<string, any>[];
    exportReportToExcel(rows, 'Acordos', 'acordos_negociacao');
  };

  if (!agreements.length) {
    return (
      <div className="bg-white border border-[#EAE6DF] rounded-xl p-10 text-center">
        <Handshake className="w-8 h-8 text-[#C19A6B] mx-auto mb-3" />
        <p className="text-sm font-bold text-[#2D2A26]">Nenhum acordo registrado</p>
        <p className="text-xs text-[#8B7D6B] mt-1">
          Use o botão <span className="font-bold">Negociar</span> na lista de títulos para abrir a
          primeira negociação.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#C19A6B] uppercase">Total Acordado</span>
          <p className="text-lg font-black text-[#2D2A26]">{formatCurrency(kpis.acordado)}</p>
          <span className="text-[10px] text-[#8B7D6B]">
            {kpis.ativos} ativos · {kpis.cumpridos} cumpridos
          </span>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase">Recebido</span>
          <p className="text-lg font-black text-emerald-700">{formatCurrency(kpis.recebido)}</p>
          <span className="text-[10px] text-[#8B7D6B]">
            {kpis.acordado > 0 ? ((kpis.recebido / kpis.acordado) * 100).toFixed(1) : '0,0'}% do acordado
          </span>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Saldo a Receber</span>
          <p className="text-lg font-black text-[#2D2A26]">{formatCurrency(kpis.aReceber)}</p>
          <span className="text-[10px] text-[#8B7D6B]">Descontos concedidos: {formatCurrency(kpis.descontos)}</span>
        </div>
        <div
          className={`p-4 rounded-xl shadow-xs border ${
            kpis.quebrados > 0 ? 'bg-rose-50/40 border-rose-200' : 'bg-white border-[#EAE6DF]'
          }`}
        >
          <span className="text-[10px] font-bold text-rose-800 uppercase">Acordos Quebrados</span>
          <p className="text-lg font-black text-rose-800">{kpis.quebrados}</p>
          <span className="text-[10px] text-rose-700">Retornam imediatamente à régua de cobrança</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-3 bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por acordo, cliente ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs rounded-lg pl-9 pr-3 py-2.5 font-medium focus:outline-none focus:border-[#C19A6B]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs rounded-lg p-2 font-bold focus:outline-none focus:border-[#C19A6B]"
        >
          <option value="all">Todos os status</option>
          <option value="Ativo">Ativos</option>
          <option value="Quebrado">Quebrados</option>
          <option value="Cumprido">Cumpridos</option>
          <option value="Cancelado">Cancelados</option>
        </select>
        <button
          onClick={exportAgreements}
          className="px-3 py-2 text-xs font-bold bg-[#F3F1ED] hover:bg-[#2D2A26] text-[#433E37] hover:text-white rounded-lg flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Excel
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {filtered.map((a) => {
          const isOpen = expanded === a.id;
          const progress = a.agreedTotal > 0 ? Math.min(100, (a.totalPaid / a.agreedTotal) * 100) : 0;
          return (
            <div key={a.id} className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
              <div className="p-4 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  className="p-1 rounded hover:bg-[#F3F1ED] text-[#8B7D6B]"
                  title={isOpen ? 'Recolher' : 'Ver parcelas'}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>

                <div className="min-w-[200px] flex-1">
                  <p className="text-xs font-black text-[#2D2A26]">{a.customerName}</p>
                  <p className="text-[10px] text-[#8B7D6B] font-mono">
                    {a.code} · {a.titleNumbers?.length || 0} título(s) · {a.cnpjCpf || '—'}
                  </p>
                </div>

                <div className="hidden lg:block">
                  <WhatsAppLink phone={a.customerPhone} />
                </div>

                <div className="text-right">
                  <p className="text-[10px] text-[#8B7D6B] font-bold uppercase">Acordado</p>
                  <p className="text-xs font-black font-mono text-[#2D2A26]">{formatCurrency(a.agreedTotal)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[#8B7D6B] font-bold uppercase">Pago</p>
                  <p className="text-xs font-black font-mono text-emerald-700">{formatCurrency(a.totalPaid)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[#8B7D6B] font-bold uppercase">Saldo</p>
                  <p className="text-xs font-black font-mono text-rose-700">{formatCurrency(a.totalOutstanding)}</p>
                </div>

                <div className="w-28">
                  <div className="h-1.5 bg-[#F3F1ED] rounded-full overflow-hidden">
                    <div className="h-full bg-[#C19A6B]" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[10px] text-[#8B7D6B] mt-1 text-center font-mono">{progress.toFixed(0)}%</p>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-black border flex items-center gap-1 ${STATUS_STYLE[a.status]}`}
                >
                  {a.status === 'Cumprido' && <CheckCircle2 className="w-3 h-3" />}
                  {a.status === 'Quebrado' && <AlertTriangle className="w-3 h-3" />}
                  {a.status === 'Ativo' && <Clock className="w-3 h-3" />}
                  {a.status === 'Cancelado' && <Ban className="w-3 h-3" />}
                  {a.status}
                </span>

                <div className="flex items-center gap-1.5">
                  {canEdit && (
                    <button
                      onClick={() => onEdit(a)}
                      title="Editar acordo"
                      className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#C19A6B] text-[#433E37] hover:text-white"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => setConfirmDelete(a.id)}
                      title="Excluir acordo"
                      className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-[#EAE6DF] bg-[#FDFBF7] p-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
                    <div>
                      <span className="text-[#8B7D6B] font-bold uppercase text-[10px] block">Dívida atualizada</span>
                      <span className="font-mono font-bold">{formatCurrency(a.updatedDebt)}</span>
                    </div>
                    <div>
                      <span className="text-[#8B7D6B] font-bold uppercase text-[10px] block">Desconto</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {formatCurrency(a.discountAmount)} ({a.discountPercent}% s/ {a.discountBasis})
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8B7D6B] font-bold uppercase text-[10px] block">Entrada</span>
                      <span className="font-mono font-bold">
                        {formatCurrency(a.downPayment)} {a.downPaymentDate && `em ${a.downPaymentDate}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8B7D6B] font-bold uppercase text-[10px] block">Forma</span>
                      <span className="font-bold">{a.paymentMethod || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[#8B7D6B] font-bold uppercase text-[10px] block">Negociado por</span>
                      <span className="font-bold">{a.negotiatedBy || '—'}</span>
                    </div>
                  </div>

                  {a.notes && (
                    <p className="text-[11px] text-[#433E37] bg-white border border-[#EAE6DF] rounded-lg p-2">
                      {a.notes}
                    </p>
                  )}

                  <div className="bg-white border border-[#EAE6DF] rounded-lg overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold">
                        <tr>
                          <th className="p-2 text-left">Parcela</th>
                          <th className="p-2 text-left">Vencimento</th>
                          <th className="p-2 text-right">Previsto</th>
                          <th className="p-2 text-right">Pago</th>
                          <th className="p-2 text-left">Data pgto.</th>
                          <th className="p-2 text-center">Situação</th>
                          {canEdit && <th className="p-2 text-center">Baixa</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE6DF]">
                        {a.installments.map((p) => (
                          <InstallmentRow
                            key={p.number}
                            installment={p}
                            canEdit={canEdit}
                            onRegister={(amount, date) => registerPayment(a, p.number, amount, date)}
                            onClear={() => clearPayment(a, p.number)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {confirmDelete === a.id && (
                <div className="border-t border-rose-200 bg-rose-50 p-4 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-rose-800 font-bold">
                    Excluir o acordo {a.code}? Os títulos voltam para "Em Cobrança" e o histórico do
                    desconto concedido é perdido. Prefira cancelar o acordo para preservar a trilha de auditoria.
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-3 py-1.5 text-[11px] font-bold text-[#8B7D6B]"
                    >
                      Manter
                    </button>
                    <button
                      onClick={async () => {
                        await onUpdate({ ...a, status: 'Cancelado' });
                        setConfirmDelete(null);
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-[#2D2A26] text-white rounded-lg"
                    >
                      Cancelar acordo
                    </button>
                    <button
                      onClick={async () => {
                        await onDelete(a);
                        setConfirmDelete(null);
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-rose-600 text-white rounded-lg"
                    >
                      Excluir mesmo assim
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Linha de parcela com baixa inline ───────────────────────────────────────
const InstallmentRow: React.FC<{
  installment: AgreementInstallment;
  canEdit: boolean;
  onRegister: (amount: number, date: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}> = ({ installment: p, canEdit, onRegister, onClear }) => {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(p.paidAmount || p.expectedAmount));
  const [date, setDate] = useState(p.paidDate || todayIso());

  return (
    <tr className="hover:bg-[#FDFBF7]">
      <td className="p-2 font-mono font-bold">{p.number}</td>
      <td className="p-2 font-mono">{p.dueDate}</td>
      <td className="p-2 text-right font-mono">{formatCurrency(p.expectedAmount)}</td>
      <td className="p-2 text-right font-mono font-bold">
        {p.paidAmount ? formatCurrency(p.paidAmount) : '—'}
      </td>
      <td className="p-2 font-mono">{p.paidDate || '—'}</td>
      <td className="p-2 text-center">
        <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${INSTALLMENT_STYLE[p.status]}`}>
          {p.status}
        </span>
      </td>
      {canEdit && (
        <td className="p-2">
          {editing ? (
            <div className="flex items-center gap-1.5 justify-center">
              <input
                type="number" step={0.01} min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-24 bg-white border border-[#EAE6DF] rounded p-1 text-[11px] font-mono"
              />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-white border border-[#EAE6DF] rounded p-1 text-[11px] font-mono"
              />
              <button
                onClick={async () => {
                  await onRegister(safeNum(amount), date);
                  setEditing(false);
                }}
                className="px-2 py-1 text-[10px] font-black bg-emerald-600 text-white rounded"
              >
                OK
              </button>
              <button onClick={() => setEditing(false)} className="px-2 py-1 text-[10px] font-bold text-[#8B7D6B]">
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 justify-center">
              <button
                onClick={() => setEditing(true)}
                className="px-2 py-1 text-[10px] font-bold bg-[#F3F1ED] hover:bg-[#2D2A26] hover:text-white rounded"
              >
                {p.paidAmount ? 'Alterar' : 'Dar baixa'}
              </button>
              {!!p.paidAmount && (
                <button
                  onClick={onClear}
                  title="Estornar baixa"
                  className="px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-50 rounded"
                >
                  Estornar
                </button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  );
};
