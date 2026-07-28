/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PeriodFilterBar — barra de seleção de período.
 *
 * DUAS PERGUNTAS, NÃO UMA
 * =======================
 * Todo recorte de período no financeiro tem duas partes, e esconder a segunda é
 * o que faz relatórios pararem de bater:
 *
 *   QUANDO — o intervalo de datas
 *   DE QUÊ — qual data do título está sendo observada
 *
 * "Junho" por vencimento e "junho" por pagamento devolvem conjuntos diferentes
 * dos mesmos títulos. A barra mostra as duas escolhas lado a lado, e o resumo
 * embaixo repete em texto o que está valendo — para quem imprime a tela ou tira
 * print saber o que está lendo.
 */

import React from 'react';
import { CalendarRange, ChevronDown, Info, RotateCcw } from 'lucide-react';

import {
  DATE_BASIS_HINT,
  DATE_BASIS_LABEL,
  DateBasis,
  MONTH_LABELS,
  PeriodFilterState,
  PeriodPreset,
  ResolvedPeriod,
  defaultPeriodFilter,
  formatIsoBr,
} from '../utils/periodFilter';

const MONTH_KEYS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const PRESETS: { id: PeriodPreset; label: string; hint: string }[] = [
  { id: 'ano', label: 'Exercício', hint: 'O ano inteiro, de 1º de janeiro a 31 de dezembro' },
  { id: 'mes', label: 'Mês', hint: 'Um mês fechado' },
  { id: 'trimestre', label: 'Trimestre', hint: 'Três meses fechados' },
  { id: 'semestre', label: 'Semestre', hint: 'Seis meses fechados' },
  { id: 'ultimos30', label: 'Últimos 30d', hint: 'Trinta dias contando hoje' },
  { id: 'ultimos90', label: 'Últimos 90d', hint: 'Noventa dias contando hoje' },
  { id: 'proximos30', label: 'Próximos 30d', hint: 'De hoje até 30 dias à frente — a janela da previsão' },
  { id: 'personalizado', label: 'Personalizado', hint: 'Intervalo digitado' },
];

export interface PeriodFilterBarProps {
  value: PeriodFilterState;
  onChange: (next: PeriodFilterState) => void;
  resolved: ResolvedPeriod;
  /** Anos com dados na base — evita oferecer exercício vazio. */
  availableYears?: number[];
  /** Quantos itens ficaram dentro e fora do recorte, para o resumo. */
  matched?: number;
  total?: number;
  /** Alguns módulos só fazem sentido em uma base de data (ex.: só pagamento). */
  allowedBases?: DateBasis[];
  className?: string;
}

export const PeriodFilterBar: React.FC<PeriodFilterBarProps> = ({
  value,
  onChange,
  resolved,
  availableYears = [],
  matched,
  total,
  allowedBases = ['vencimento', 'pagamento', 'emissao'],
  className = '',
}) => {
  const set = (patch: Partial<PeriodFilterState>) => onChange({ ...value, ...patch });

  const anos = availableYears.length > 0 ? availableYears : [value.year];
  const selectCls =
    'px-2.5 py-1.5 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#433E37] focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40';
  const dateCls =
    'px-2.5 py-1.5 text-xs font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#2D2A26] focus:outline-none focus:ring-2 focus:ring-[#C19A6B]/40 tabular-nums';

  const semDados = matched === 0 && (total ?? 0) > 0;

  return (
    <div className={`bg-white border border-[#EAE6DF] rounded-xl shadow-xs ${className}`}>
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-[#EAE6DF]">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B] mr-1">
          <CalendarRange className="w-3.5 h-3.5" />
          Período
        </span>

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              title={p.hint}
              onClick={() => set({ preset: p.id })}
              className={`px-2.5 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${
                value.preset === p.id
                  ? 'bg-[#2D2A26] text-white border-[#2D2A26]'
                  : 'bg-[#F9F7F2] text-[#433E37] border-[#EAE6DF] hover:bg-[#F3F1ED]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-[#EAE6DF] mx-1 hidden md:block" />

        {/* Complementos de cada preset */}
        {['ano', 'mes', 'trimestre', 'semestre'].includes(value.preset) && (
          <select value={value.year} onChange={(e) => set({ year: Number(e.target.value) })} className={selectCls}>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}

        {value.preset === 'mes' && (
          <select value={value.month} onChange={(e) => set({ month: Number(e.target.value) })} className={selectCls}>
            {MONTH_KEYS.map((k, i) => (
              <option key={k} value={i + 1}>
                {MONTH_LABELS[k]}
              </option>
            ))}
          </select>
        )}

        {value.preset === 'trimestre' && (
          <select
            value={value.quarter}
            onChange={(e) => set({ quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}
            className={selectCls}
          >
            <option value={1}>1º tri (jan–mar)</option>
            <option value={2}>2º tri (abr–jun)</option>
            <option value={3}>3º tri (jul–set)</option>
            <option value={4}>4º tri (out–dez)</option>
          </select>
        )}

        {value.preset === 'semestre' && (
          <select
            value={value.semester}
            onChange={(e) => set({ semester: Number(e.target.value) as 1 | 2 })}
            className={selectCls}
          >
            <option value={1}>1º sem (jan–jun)</option>
            <option value={2}>2º sem (jul–dez)</option>
          </select>
        )}

        {value.preset === 'personalizado' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={value.startDate}
              max={value.endDate || undefined}
              onChange={(e) => set({ startDate: e.target.value })}
              className={dateCls}
            />
            <span className="text-[11px] text-[#8B7D6B]">até</span>
            <input
              type="date"
              value={value.endDate}
              min={value.startDate || undefined}
              onChange={(e) => set({ endDate: e.target.value })}
              className={dateCls}
            />
          </div>
        )}

        <div className="flex-1" />

        {/* Data-base */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B]">Data-base</span>
          <div className="relative">
            <select
              value={value.basis}
              onChange={(e) => set({ basis: e.target.value as DateBasis })}
              title={DATE_BASIS_HINT[value.basis]}
              className={`${selectCls} pr-7 appearance-none`}
            >
              {allowedBases.map((b) => (
                <option key={b} value={b}>
                  {DATE_BASIS_LABEL[b]}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-[#8B7D6B] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button
            onClick={() => onChange(defaultPeriodFilter(value.year))}
            title="Voltar ao exercício inteiro, por vencimento"
            className="p-1.5 rounded-lg border border-[#EAE6DF] bg-[#F9F7F2] text-[#8B7D6B] hover:bg-[#F3F1ED] hover:text-[#2D2A26] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Resumo em texto: o que exatamente está sendo mostrado */}
      <div className="px-4 py-2 bg-[#F9F7F2] rounded-b-xl flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#8B7D6B]">
        <span>
          Mostrando <b className="text-[#2D2A26]">{resolved.label}</b>
          {resolved.start && resolved.end && (
            <>
              {' '}
              ({formatIsoBr(resolved.start)} a {formatIsoBr(resolved.end)})
            </>
          )}{' '}
          por <b className="text-[#2D2A26]">{DATE_BASIS_LABEL[resolved.basis].toLowerCase()}</b>.
        </span>
        {matched !== undefined && total !== undefined && (
          <span>
            <b className="text-[#2D2A26] tabular-nums">{matched.toLocaleString('pt-BR')}</b> de{' '}
            {total.toLocaleString('pt-BR')} registro(s) no recorte.
          </span>
        )}
        <span className="flex items-center gap-1 text-[#8B7D6B]">
          <Info className="w-3 h-3" />
          {DATE_BASIS_HINT[resolved.basis]}
        </span>
        {semDados && resolved.basis === 'pagamento' && (
          <span className="text-amber-700 font-bold">
            Nenhum registro: por pagamento, títulos em aberto não entram — eles ainda não têm data de pagamento.
          </span>
        )}
      </div>
    </div>
  );
};

export default PeriodFilterBar;
