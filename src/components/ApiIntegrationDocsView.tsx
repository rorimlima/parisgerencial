/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Key,
  Plus,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { ApiToken } from '../types';

interface ApiIntegrationDocsViewProps {
  apiTokens: ApiToken[];
  onGenerateToken: (name: string) => void;
}

export const ApiIntegrationDocsView: React.FC<ApiIntegrationDocsViewProps> = ({
  apiTokens,
  onGenerateToken,
}) => {
  const [newSystemName, setNewSystemName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCreateToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSystemName.trim()) return;
    onGenerateToken(newSystemName);
    setNewSystemName('');
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sampleCurl = `curl -X GET "https://seu-dominio-parisdakar.run.app/api/v1/external/financial-summary?year=2026" \\
  -H "X-API-Key: ${apiTokens[0]?.token || 'SEU_TOKEN_API'}" \\
  -H "Content-Type: application/json"`;

  const sampleJs = `// Exemplo de integração em JavaScript / Node.js
const fetchFinancialSummary = async () => {
  const response = await fetch('https://seu-dominio-parisdakar.run.app/api/v1/external/financial-summary?year=2026', {
    headers: {
      'X-API-Key': '${apiTokens[0]?.token || 'SEU_TOKEN_API'}',
      'Content-Type': 'application/json'
    }
  });
  const data = await response.json();
  console.log('Resultados Contábeis Paris Dakar:', data);
};`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              INTEGRAÇÃO CONTÁBIL
            </span>
            <span className="text-xs text-[#8B7D6B]">• API REST Segura com Token X-API-Key</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Integração via API com Sistemas Contábeis Externos</h2>
          <p className="text-xs text-[#8B7D6B]">
            Conecte sistemas como Prosoft, Alterdata, Domínio, Senior e ERPs externos para leitura e exportação automatizada.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg text-emerald-800 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Endpoint Ativo & Criptografado</span>
        </div>
      </div>

      {/* Token Management Card */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
          <Key className="w-4 h-4 text-[#C19A6B]" />
          Gerenciamento de Chaves e Tokens de Acesso à API
        </h3>

        {/* Create Token Form */}
        <form onSubmit={handleCreateToken} className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="text"
            required
            placeholder="Nome do sistema externo (Ex: Contabilidade Alterdata, Prosoft ERP...)"
            value={newSystemName}
            onChange={(e) => setNewSystemName(e.target.value)}
            className="w-full sm:flex-1 bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
          />
          <button
            type="submit"
            className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4 text-[#C19A6B]" />
            <span>Gerar Nova Chave API</span>
          </button>
        </form>

        {/* Tokens List */}
        <div className="border border-[#EAE6DF] rounded-lg overflow-hidden divide-y divide-[#EAE6DF]">
          {apiTokens.map((tok) => (
            <div key={tok.id} className="p-3.5 bg-[#FDFBF7] flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-[#2D2A26]">{tok.name}</p>
                <p className="text-[10px] text-[#8B7D6B] font-mono">
                  Gerado em: {new Date(tok.createdAt).toLocaleDateString('pt-BR')}
                </p>
              </div>

              <div className="flex items-center space-x-2 font-mono text-xs">
                <span className="bg-white px-3 py-1.5 rounded-lg border border-[#EAE6DF] text-[#C19A6B] font-bold">
                  {tok.token}
                </span>
                <button
                  onClick={() => copyToClipboard(tok.token, tok.id)}
                  className="p-2 bg-[#F3F1ED] hover:bg-[#EAE6DF] rounded-lg text-[#433E37] transition-colors"
                  title="Copiar Token"
                >
                  {copiedId === tok.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Code Snippets Section */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#C19A6B]" />
          Exemplos de Chamada de API para Desenvolvedores
        </h3>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1 text-xs text-[#8B7D6B] font-bold uppercase">
              <span>Chamada cURL</span>
              <button
                onClick={() => copyToClipboard(sampleCurl, 'curl')}
                className="text-[#C19A6B] hover:underline flex items-center gap-1 text-[11px]"
              >
                {copiedId === 'curl' ? 'Copiado!' : 'Copiar cURL'}
              </button>
            </div>
            <pre className="p-3.5 rounded-lg bg-[#2D2A26] border border-[#3F3B35] text-[#EAE6DF] text-xs font-mono overflow-x-auto">
              {sampleCurl}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1 text-xs text-[#8B7D6B] font-bold uppercase">
              <span>Integração JavaScript / Node.js</span>
              <button
                onClick={() => copyToClipboard(sampleJs, 'js')}
                className="text-[#C19A6B] hover:underline flex items-center gap-1 text-[11px]"
              >
                {copiedId === 'js' ? 'Copiado!' : 'Copiar Código'}
              </button>
            </div>
            <pre className="p-3.5 rounded-lg bg-[#2D2A26] border border-[#3F3B35] text-emerald-400 text-xs font-mono overflow-x-auto">
              {sampleJs}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
