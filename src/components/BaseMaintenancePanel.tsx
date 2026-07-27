/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BaseMaintenancePanel — zeramento controlado das bases de títulos.
 *
 * POR QUE ISTO EXISTE COMO TELA
 * =============================
 * A troca da fonte de dados (RFN006 + RFN029 → RFN046) deixa para trás bases
 * antigas que não conversam com o modelo novo. Enquanto elas continuarem no
 * Firestore, todo relatório soma duas realidades: o que veio da fonte velha e
 * o que veio da nova. O gestor precisa de um lugar para dizer "esta base morreu"
 * sem depender de alguém abrir o console do Firebase e apagar documento a
 * documento — que é como se apaga a base errada.
 *
 * AS TRÊS TRAVAS
 * --------------
 * 1. LISTA FECHADA. Só aparecem aqui as coleções de títulos. As bases que
 *    sustentam o histórico gerencial — resultado econômico e financeiro, fluxo
 *    de caixa, faturamento, vendas, estoque, clientes, vendedores e o EXTRATO
 *    BANCÁRIO — não têm botão. Não é uma escolha de interface: elas nem chegam
 *    à tela, então não existe clique errado possível.
 * 2. SELEÇÃO EXPLÍCITA. Nada vem marcado. Zerar é sempre um ato deliberado.
 * 3. CONFIRMAÇÃO DIGITADA. É preciso escrever ZERAR para o botão liberar.
 *    Firestore não tem lixeira; depois do commit, não há de onde voltar.
 */

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Loader2, Lock, ShieldAlert, Trash2 } from 'lucide-react';

import { zerarColecao } from '../firebaseService';
import { PROTECTED_COLLECTIONS, RESETTABLE_COLLECTIONS } from '../services/titulosService';

interface BaseMaintenancePanelProps {
  userRole: string;
  /** Chamado após o zeramento, para a tela recarregar o que ficou. */
  onCleared?: () => void;
}

export const BaseMaintenancePanel: React.FC<BaseMaintenancePanelProps> = ({ userRole, onCleared }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ key: string; label: string; removed: number; error?: string }[] | null>(null);

  // Zerar base é ato de administrador. Gestor e analista importam e conciliam;
  // apagar histórico é outra categoria de decisão.
  if (userRole !== 'admin') return null;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setReport(null);
  };

  const podeExecutar = selected.size > 0 && confirmText.trim().toUpperCase() === 'ZERAR' && !busy;

  const executar = async () => {
    if (!podeExecutar) return;
    setBusy(true);
    const saida: { key: string; label: string; removed: number; error?: string }[] = [];

    for (const col of RESETTABLE_COLLECTIONS) {
      if (!selected.has(col.key)) continue;
      try {
        const removed = await zerarColecao(col.key);
        saida.push({ key: col.key, label: col.label, removed });
      } catch (err) {
        saida.push({ key: col.key, label: col.label, removed: 0, error: (err as Error).message });
      }
    }

    setReport(saida);
    setSelected(new Set());
    setConfirmText('');
    setBusy(false);
    onCleared?.();
  };

  return (
    <div className="bg-white border border-rose-200 rounded-xl shadow-xs overflow-hidden">
      <div className="px-6 py-4 bg-rose-50 border-b border-rose-200 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-bold text-rose-900">Manutenção da base — zeramento de títulos</h3>
          <p className="text-[11px] text-rose-800 mt-0.5 max-w-3xl">
            Use ao trocar a fonte de dados. O que for zerado aqui <b>não volta</b>: o Firestore não tem lixeira.
            Exporte antes se o histórico ainda tiver valor de auditoria.
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Bases que podem ser zeradas */}
        <div className="space-y-2">
          {RESETTABLE_COLLECTIONS.map((c) => (
            <label
              key={c.key}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected.has(c.key) ? 'bg-rose-50 border-rose-300' : 'bg-[#F9F7F2] border-[#EAE6DF] hover:border-rose-200'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(c.key)}
                onChange={() => toggle(c.key)}
                className="w-4 h-4 mt-0.5 accent-rose-600"
              />
              <div className="flex-1">
                <p className="text-xs font-bold text-[#2D2A26] flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-[#8B7D6B]" />
                  {c.label}
                  <code className="text-[10px] font-mono text-[#8B7D6B] bg-white px-1.5 py-0.5 rounded border border-[#EAE6DF]">
                    {c.key}
                  </code>
                </p>
                <p className="text-[11px] text-[#8B7D6B] mt-0.5">{c.description}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Bases intocáveis — visíveis para dar segurança, sem controle algum */}
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-[11px] font-bold text-emerald-900 flex items-center gap-1.5 mb-1.5">
            <Lock className="w-3.5 h-3.5" />
            Bases preservadas — não têm botão nesta tela
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROTECTED_COLLECTIONS.map((c) => (
              <span
                key={c}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-white text-emerald-800 border border-emerald-200"
              >
                {c}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-emerald-800 mt-2">
            Resultado econômico e financeiro, fluxo de caixa, faturamento, vendas, estoque, clientes, vendedores e os
            extratos de Bradesco, PagBank e Caixa/Tesouraria continuam intactos.
          </p>
        </div>

        {/* Confirmação */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-[#8B7D6B] mb-1">
              Digite ZERAR para liberar
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ZERAR"
              className="px-3 py-2 text-sm font-bold border border-[#EAE6DF] rounded-lg bg-white text-[#2D2A26] focus:outline-none focus:ring-2 focus:ring-rose-300 w-40"
            />
          </div>
          <button
            onClick={executar}
            disabled={!podeExecutar}
            className="px-5 py-2.5 text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 rounded-lg shadow-xs transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Zerar {selected.size > 0 ? `${selected.size} base(s)` : 'base selecionada'}
          </button>
          {selected.size > 0 && confirmText.trim().toUpperCase() !== 'ZERAR' && (
            <span className="text-[11px] text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Confirme digitando ZERAR
            </span>
          )}
        </div>

        {/* Resultado */}
        {report && (
          <div className="p-4 rounded-lg bg-[#F9F7F2] border border-[#EAE6DF] space-y-1.5">
            <p className="text-xs font-bold text-[#2D2A26] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Zeramento concluído
            </p>
            {report.map((r) => (
              <p key={r.key} className="text-[11px] text-[#433E37] pl-6">
                {r.error ? (
                  <span className="text-rose-700">✕ {r.label}: {r.error}</span>
                ) : (
                  <>
                    • <b>{r.label}</b>: {r.removed.toLocaleString('pt-BR')} documento(s) removido(s)
                  </>
                )}
              </p>
            ))}
            <p className="text-[10px] text-[#8B7D6B] pl-6 pt-1">
              Recarregue a página para as telas refletirem as bases vazias.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BaseMaintenancePanel;
