/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MODAL DE NEGOCIAÇÃO DE DÍVIDA
 * ─────────────────────────────
 * A tela em que o acordo é fechado com o cliente ao telefone. Duas decisões de
 * desenho valem registro:
 *
 *  • O cronograma é recalculado A CADA tecla e exibido inteiro. Negociação é
 *    conversa: o cliente pergunta "e em 6x?" e a resposta precisa estar na tela
 *    antes da próxima frase. Cronograma escondido atrás de um botão "simular"
 *    é cronograma que ninguém confere.
 *
 *  • A conferência `entrada + Σ parcelas === total acordado` aparece como um
 *    selo verde/vermelho permanente. É o único número que impede um acordo de
 *    nascer com resíduo de centavos, e por isso não fica em tooltip.
 */

import React, { useMemo, useState } from 'react';
import {
  X,
  Handshake,
  Calculator,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  Percent,
  Printer,
} from 'lucide-react';
import { Customer, DebtAgreement, DelinquentTitle } from '../types';
import { formatCurrency } from '../utils/exportUtils';
import {
  applyDiscount,
  buildSchedule,
  composeDebt,
  money,
  nextAgreementCode,
  safeNum,
  validateAgreementDraft,
} from '../utils/negotiation';

interface NegotiationModalProps {
  /** Títulos pré-selecionados (a dívida que está sendo negociada). */
  titles: DelinquentTitle[];
  /** Demais títulos em aberto do mesmo cliente, para incorporar ao acordo. */
  siblingTitles?: DelinquentTitle[];
  customers?: Customer[];
  penaltyPercent: number;
  monthlyInterestPercent: number;
  existingAgreements: DebtAgreement[];
  currentUser: string;
  /** Acordo existente em edição; ausente = novo acordo. */
  editing?: DebtAgreement | null;
  onClose: () => void;
  onSave: (agreement: DebtAgreement) => void | Promise<void>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const PAYMENT_METHODS: NonNullable<DebtAgreement['paymentMethod']>[] = [
  'Boleto', 'PIX', 'Transferência', 'Cartão', 'Dinheiro', 'Cheque',
];

export const NegotiationModal: React.FC<NegotiationModalProps> = ({
  titles,
  siblingTitles = [],
  penaltyPercent,
  monthlyInterestPercent,
  existingAgreements,
  currentUser,
  editing,
  onClose,
  onSave,
}) => {
  const anchor = titles[0];

  // Títulos que o operador escolheu incluir. Começa com os pré-selecionados.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    editing ? editing.titleIds : titles.map((t) => t.id)
  );

  const [discountPercent, setDiscountPercent] = useState<number>(editing?.discountPercent ?? 0);
  const [discountBasis, setDiscountBasis] = useState<'encargos' | 'total'>(
    editing?.discountBasis ?? 'encargos'
  );
  const [downPayment, setDownPayment] = useState<string>(String(editing?.downPayment ?? 0));
  const [downPaymentDate, setDownPaymentDate] = useState<string>(editing?.downPaymentDate || todayIso());
  const [installmentCount, setInstallmentCount] = useState<number>(editing?.installmentCount ?? 3);
  const [firstDueDate, setFirstDueDate] = useState<string>(() => {
    if (editing?.firstDueDate) return editing.firstDueDate;
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [paymentMethod, setPaymentMethod] = useState<DebtAgreement['paymentMethod']>(
    editing?.paymentMethod ?? 'Boleto'
  );
  const [notes, setNotes] = useState<string>(editing?.notes || '');
  const [saving, setSaving] = useState(false);

  const universe = useMemo(() => {
    const map = new Map<string, DelinquentTitle>();
    [...titles, ...siblingTitles].forEach((t) => map.set(t.id, t));
    return Array.from(map.values());
  }, [titles, siblingTitles]);

  const selectedTitles = useMemo(
    () => universe.filter((t) => selectedIds.includes(t.id)),
    [universe, selectedIds]
  );

  // ─── Cálculo ao vivo ───────────────────────────────────────────────────────
  const comp = useMemo(
    () => composeDebt(selectedTitles, penaltyPercent, monthlyInterestPercent),
    [selectedTitles, penaltyPercent, monthlyInterestPercent]
  );

  const { discountAmount, agreedTotal } = useMemo(
    () => applyDiscount(comp, discountPercent, discountBasis),
    [comp, discountPercent, discountBasis]
  );

  const schedule = useMemo(
    () => buildSchedule(agreedTotal, safeNum(downPayment), installmentCount, firstDueDate),
    [agreedTotal, downPayment, installmentCount, firstDueDate]
  );

  const errors = useMemo(
    () =>
      validateAgreementDraft({
        titleIds: selectedIds,
        agreedTotal,
        updatedDebt: comp.updatedDebt,
        downPayment: safeNum(downPayment),
        installmentCount,
        firstDueDate,
        discountPercent,
        scheduleTotal: schedule.scheduleTotal,
      }),
    [selectedIds, agreedTotal, comp.updatedDebt, downPayment, installmentCount, firstDueDate, discountPercent, schedule.scheduleTotal]
  );

  const balanced = Math.abs(schedule.scheduleTotal - agreedTotal) < 0.005;

  // Percentual de recuperação: quanto da dívida cheia entra no caixa. É o número
  // que a gestão olha para decidir se o desconto foi razoável.
  const recoveryRate = comp.updatedDebt > 0 ? (agreedTotal / comp.updatedDebt) * 100 : 0;

  const toggleTitle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSave = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const id = editing?.id ?? `aco_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const agreement: DebtAgreement = {
        id,
        code: editing?.code ?? nextAgreementCode(existingAgreements),
        customerId: anchor?.customerId || '',
        customerCode: anchor?.customerCode || '',
        customerName: anchor?.customerName || '',
        cnpjCpf: anchor?.cnpjCpf || '',
        customerPhone: anchor?.customerPhone || '',
        sellerName: anchor?.sellerName || '',
        titleIds: selectedIds,
        titleNumbers: selectedTitles.map((t) => t.lancamento || t.titleNumber || t.id),
        originalDebt: comp.originalDebt,
        interestAmount: comp.interestAmount,
        penaltyAmount: comp.penaltyAmount,
        updatedDebt: comp.updatedDebt,
        discountPercent: safeNum(discountPercent),
        discountAmount,
        discountBasis,
        agreedTotal,
        downPayment: money(safeNum(downPayment)),
        downPaymentDate,
        installmentCount,
        installmentAmount: schedule.installmentAmount,
        firstDueDate,
        installments: schedule.installments,
        paymentMethod,
        status: editing?.status ?? 'Ativo',
        negotiatedBy: editing?.negotiatedBy ?? currentUser,
        negotiatedAt: editing?.negotiatedAt ?? now,
        updatedAt: now,
        notes,
        totalPaid: money(safeNum(downPayment)),
        totalOutstanding: money(agreedTotal - safeNum(downPayment)),
      };
      await onSave(agreement);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const printTerm = () => window.print();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl my-8 border border-[#EAE6DF]">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between p-5 border-b border-[#EAE6DF] sticky top-0 bg-white rounded-t-xl z-10">
          <div>
            <h3 className="text-base font-black text-[#2D2A26] flex items-center gap-2">
              <Handshake className="w-5 h-5 text-[#C19A6B]" />
              {editing ? `Editar Acordo ${editing.code}` : 'Nova Negociação de Dívida'}
            </h3>
            <p className="text-[11px] text-[#8B7D6B] mt-0.5">
              {anchor?.customerName} · {anchor?.cnpjCpf || 'sem CNPJ/CPF'}
            </p>
          </div>
          <button onClick={onClose} className="text-[#8B7D6B] hover:text-[#2D2A26]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* ── Títulos incluídos ───────────────────────────────────────────── */}
          <section>
            <h4 className="text-[11px] font-black text-[#8B7D6B] uppercase mb-2">
              Títulos incluídos no acordo ({selectedIds.length})
            </h4>
            <div className="border border-[#EAE6DF] rounded-lg max-h-52 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold sticky top-0">
                  <tr>
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-left">Título</th>
                    <th className="p-2 text-left">Vencimento</th>
                    <th className="p-2 text-center">Atraso</th>
                    <th className="p-2 text-right">Valor Original</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE6DF]">
                  {universe.map((t) => {
                    const locked = !!t.agreementId && t.agreementId !== editing?.id;
                    return (
                      <tr key={t.id} className={locked ? 'opacity-50' : 'hover:bg-[#FDFBF7]'}>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(t.id)}
                            disabled={locked}
                            onChange={() => toggleTitle(t.id)}
                            className="accent-[#C19A6B]"
                          />
                        </td>
                        <td className="p-2 font-mono">
                          {t.lancamento || t.titleNumber}
                          {t.parcela && <span className="text-[#8B7D6B]"> / {t.parcela}</span>}
                          {locked && (
                            <span className="ml-2 text-[10px] text-rose-700 font-bold">
                              já em outro acordo
                            </span>
                          )}
                        </td>
                        <td className="p-2 font-mono">{t.dueDate}</td>
                        <td className="p-2 text-center font-mono">{t.daysOverdue}d</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(t.originalAmount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Composição da dívida ────────────────────────────────────────── */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
              <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">Principal</span>
              <p className="text-sm font-black text-[#2D2A26] font-mono">{formatCurrency(comp.originalDebt)}</p>
            </div>
            <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
              <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">
                Multa ({penaltyPercent}%)
              </span>
              <p className="text-sm font-black text-[#2D2A26] font-mono">{formatCurrency(comp.penaltyAmount)}</p>
            </div>
            <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-3">
              <span className="text-[10px] font-bold text-[#8B7D6B] uppercase">
                Juros ({monthlyInterestPercent}% a.m.)
              </span>
              <p className="text-sm font-black text-[#2D2A26] font-mono">{formatCurrency(comp.interestAmount)}</p>
            </div>
            <div className="bg-rose-50/50 border border-rose-200 rounded-lg p-3">
              <span className="text-[10px] font-bold text-rose-800 uppercase">Dívida Atualizada</span>
              <p className="text-sm font-black text-rose-800 font-mono">{formatCurrency(comp.updatedDebt)}</p>
            </div>
          </section>

          {/* ── Condições ───────────────────────────────────────────────────── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-3">
              <h4 className="text-[11px] font-black text-[#8B7D6B] uppercase flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5" /> Concessão
              </h4>

              <div className="flex items-end gap-3">
                <label className="flex-1">
                  <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">Desconto (%)</span>
                  <input
                    type="number" min={0} max={100} step={0.5}
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(safeNum(e.target.value))}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono font-bold focus:outline-none focus:border-[#C19A6B]"
                  />
                </label>
                <label className="flex-1">
                  <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">Incide sobre</span>
                  <select
                    value={discountBasis}
                    onChange={(e) => setDiscountBasis(e.target.value as 'encargos' | 'total')}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-bold focus:outline-none focus:border-[#C19A6B]"
                  >
                    <option value="encargos">Somente juros + multa</option>
                    <option value="total">Dívida total (inclui principal)</option>
                  </select>
                </label>
              </div>

              {discountBasis === 'total' && discountPercent > 0 && (
                <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  Desconto sobre o principal reduz a receita já reconhecida da venda.
                  Exige aprovação da gestão e deve ser justificado nas observações.
                </p>
              )}

              <h4 className="text-[11px] font-black text-[#8B7D6B] uppercase flex items-center gap-1.5 pt-2">
                <CalendarDays className="w-3.5 h-3.5" /> Parcelamento
              </h4>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">Entrada (R$)</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono font-bold focus:outline-none focus:border-[#C19A6B]"
                  />
                </label>
                <label>
                  <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">Data da entrada</span>
                  <input
                    type="date"
                    value={downPaymentDate}
                    onChange={(e) => setDownPaymentDate(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                  />
                </label>
                <label>
                  <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">Nº de parcelas</span>
                  <input
                    type="number" min={0} max={60}
                    value={installmentCount}
                    onChange={(e) => setInstallmentCount(Math.max(0, Math.floor(safeNum(e.target.value))))}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono font-bold focus:outline-none focus:border-[#C19A6B]"
                  />
                </label>
                <label>
                  <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">1º vencimento</span>
                  <input
                    type="date"
                    value={firstDueDate}
                    onChange={(e) => setFirstDueDate(e.target.value)}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-mono focus:outline-none focus:border-[#C19A6B]"
                  />
                </label>
              </div>

              <div className="flex gap-1.5 flex-wrap pt-1">
                {[1, 2, 3, 4, 6, 10, 12].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setInstallmentCount(n)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                      installmentCount === n
                        ? 'bg-[#2D2A26] text-white border-[#2D2A26]'
                        : 'bg-[#F3F1ED] text-[#433E37] border-[#EAE6DF] hover:bg-[#EAE6DF]'
                    }`}
                  >
                    {n}x
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">Forma de pagamento</span>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as DebtAgreement['paymentMethod'])}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs font-bold focus:outline-none focus:border-[#C19A6B]"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-[10px] font-bold text-[#8B7D6B] mb-1">
                  Observações / justificativa do desconto
                </span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2 text-xs focus:outline-none focus:border-[#C19A6B]"
                />
              </label>
            </div>

            {/* ── Resultado + cronograma ─────────────────────────────────── */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-black text-[#8B7D6B] uppercase flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5" /> Resultado da negociação
              </h4>

              <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg divide-y divide-[#EAE6DF] text-xs">
                <div className="flex justify-between p-2.5">
                  <span className="text-[#8B7D6B] font-bold">Dívida atualizada</span>
                  <span className="font-mono font-bold text-[#2D2A26]">{formatCurrency(comp.updatedDebt)}</span>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-[#8B7D6B] font-bold">Desconto concedido</span>
                  <span className="font-mono font-bold text-emerald-700">- {formatCurrency(discountAmount)}</span>
                </div>
                <div className="flex justify-between p-2.5 bg-[#C19A6B]/10">
                  <span className="text-[#2D2A26] font-black">TOTAL ACORDADO</span>
                  <span className="font-mono font-black text-[#2D2A26]">{formatCurrency(agreedTotal)}</span>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-[#8B7D6B] font-bold">Entrada</span>
                  <span className="font-mono font-bold">{formatCurrency(safeNum(downPayment))}</span>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-[#8B7D6B] font-bold">Saldo financiado</span>
                  <span className="font-mono font-bold">{formatCurrency(schedule.financedAmount)}</span>
                </div>
                <div className="flex justify-between p-2.5">
                  <span className="text-[#8B7D6B] font-bold">Taxa de recuperação</span>
                  <span
                    className={`font-mono font-black ${
                      recoveryRate >= 90 ? 'text-emerald-700' : recoveryRate >= 70 ? 'text-amber-700' : 'text-rose-700'
                    }`}
                  >
                    {recoveryRate.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Conferência de fechamento — sempre visível, nunca em tooltip. */}
              <div
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-[11px] font-bold ${
                  balanced
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                Entrada + parcelas = {formatCurrency(schedule.scheduleTotal)}
                {balanced ? ' — confere com o total acordado.' : ' — NÃO confere com o total acordado.'}
              </div>

              <div className="border border-[#EAE6DF] rounded-lg max-h-64 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Parcela</th>
                      <th className="p-2 text-left">Vencimento</th>
                      <th className="p-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE6DF]">
                    {safeNum(downPayment) > 0 && (
                      <tr className="bg-[#C19A6B]/10">
                        <td className="p-2 font-bold">Entrada</td>
                        <td className="p-2 font-mono">{downPaymentDate}</td>
                        <td className="p-2 text-right font-mono font-bold">
                          {formatCurrency(safeNum(downPayment))}
                        </td>
                      </tr>
                    )}
                    {schedule.installments.map((p) => (
                      <tr key={p.number} className="hover:bg-[#FDFBF7]">
                        <td className="p-2 font-mono">{p.number}/{schedule.installments.length}</td>
                        <td className="p-2 font-mono">{p.dueDate}</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(p.expectedAmount)}</td>
                      </tr>
                    ))}
                    {!schedule.installments.length && safeNum(downPayment) <= 0 && (
                      <tr>
                        <td colSpan={3} className="p-4 text-center text-[#8B7D6B]">
                          Informe entrada e/ou parcelas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {errors.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 space-y-1">
              {errors.map((e) => (
                <p key={e} className="text-[11px] text-rose-800 font-semibold flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {e}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-[#EAE6DF] sticky bottom-0 bg-white rounded-b-xl">
          <button
            onClick={printTerm}
            className="px-3 py-2 text-xs font-bold text-[#433E37] bg-[#F3F1ED] hover:bg-[#EAE6DF] rounded-lg flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir termo
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={errors.length > 0 || saving}
              className="px-5 py-2 text-xs font-black rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#2D2A26] hover:bg-[#C19A6B] text-white"
            >
              <Handshake className="w-3.5 h-3.5" />
              {saving ? 'Gravando…' : editing ? 'Salvar alterações' : 'Fechar acordo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
