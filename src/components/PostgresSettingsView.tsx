/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileCode,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { PostgresConfig } from '../types';

interface PostgresSettingsViewProps {
  dbConfig: PostgresConfig;
  onTestConnection: (config: Partial<PostgresConfig>) => void;
}

export const PostgresSettingsView: React.FC<PostgresSettingsViewProps> = ({
  dbConfig,
  onTestConnection,
}) => {
  const [host, setHost] = useState(dbConfig.host || 'localhost');
  const [port, setPort] = useState(dbConfig.port ? dbConfig.port.toString() : '5432');
  const [database, setDatabase] = useState(dbConfig.database || 'parisgerencial');
  const [user, setUser] = useState(dbConfig.user || 'postgress');
  const [password, setPassword] = useState(dbConfig.password || '1987');

  const [isTesting, setIsTesting] = useState(false);
  const [copiedDdl, setCopiedDdl] = useState(false);

  const ddlScript = `-- SCRIPTS DDL DE CRIAÇÃO DO BANCO DE DADOS POSTGRESQL (COMPATÍVEL COM PGADMIN)
-- Empresa: Paris Dakar Gerencial
--
-- INSTRUÇÕES DE USO NO PGADMIN:
-- 1. No pgAdmin, clique com botão direito em "Databases" -> "Create" -> "Database..." e crie o banco "parisgerencial".
-- 2. Clique com botão direito sobre o banco "parisgerencial" e abra o "Query Tool".
-- 3. Cole o script abaixo e clique no botão Play (ou tecle F5) para criar as tabelas.

-- Tabela de Usuários e Permissões (RBAC)
CREATE TABLE IF NOT EXISTS usuarios (
    id VARCHAR(50) PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    funcao VARCHAR(20) NOT NULL CHECK (funcao IN ('admin', 'gestor', 'analista')),
    senha_hash VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserir/Atualizar Usuário Padrão 'rorim' (Senha: 1987)
INSERT INTO usuarios (id, nome, email, funcao, senha_hash)
VALUES ('usr_rorim', 'Rorim Admin', 'rorim@parisdakar.com.br', 'admin', '1987')
ON CONFLICT (email) DO UPDATE SET senha_hash = '1987', nome = 'Rorim Admin';

-- Tabela de Clientes
CREATE TABLE IF NOT EXISTS clientes (
    id VARCHAR(50) PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    cnpj_cpf VARCHAR(20) NOT NULL,
    razao_social VARCHAR(150) NOT NULL,
    nome_fantasia VARCHAR(150),
    contato_nome VARCHAR(100),
    telefone VARCHAR(30),
    email VARCHAR(100),
    cidade VARCHAR(80),
    estado CHAR(2),
    limite_credito NUMERIC(15,2) DEFAULT 0.00,
    saldo_atual NUMERIC(15,2) DEFAULT 0.00,
    valor_inadimplente NUMERIC(15,2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'Adimplente',
    ultima_compra DATE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de DRE Resultado Econômico
CREATE TABLE IF NOT EXISTS resultado_economico (
    id SERIAL PRIMARY KEY,
    ano INT NOT NULL,
    mes_chave VARCHAR(3) NOT NULL,
    receita_bruta NUMERIC(15,2) DEFAULT 0.00,
    cmv NUMERIC(15,2) DEFAULT 0.00,
    margem_bruta NUMERIC(15,2) DEFAULT 0.00,
    despesas_fixas NUMERIC(15,2) DEFAULT 0.00,
    resultado_economico NUMERIC(15,2) DEFAULT 0.00,
    ponto_equilibrio NUMERIC(15,2) DEFAULT 0.00,
    CONSTRAINT unq_ano_mes_eco UNIQUE (ano, mes_chave)
);

-- Tabela de Fluxo Financeiro
CREATE TABLE IF NOT EXISTS resultado_financeiro (
    id SERIAL PRIMARY KEY,
    ano INT NOT NULL,
    mes_chave VARCHAR(3) NOT NULL,
    entradas_bancos NUMERIC(15,2) DEFAULT 0.00,
    entradas_tesouraria NUMERIC(15,2) DEFAULT 0.00,
    total_entradas NUMERIC(15,2) DEFAULT 0.00,
    total_saidas NUMERIC(15,2) DEFAULT 0.00,
    resultado_financeiro NUMERIC(15,2) DEFAULT 0.00,
    estoque NUMERIC(15,2) DEFAULT 0.00,
    inadimplencia_mensal NUMERIC(15,2) DEFAULT 0.00,
    inadimplencia_acumulada NUMERIC(15,2) DEFAULT 0.00,
    CONSTRAINT unq_ano_mes_fin UNIQUE (ano, mes_chave)
);

-- Tabela de Títulos Inadimplentes
CREATE TABLE IF NOT EXISTS titulos_inadimplentes (
    id VARCHAR(50) PRIMARY KEY,
    numero_titulo VARCHAR(40) NOT NULL,
    cliente_id VARCHAR(50) REFERENCES clientes(id),
    data_emissao DATE NOT NULL,
    data_vencimento DATE NOT NULL,
    valor_original NUMERIC(15,2) NOT NULL,
    valor_atualizado NUMERIC(15,2) NOT NULL,
    dias_atraso INT DEFAULT 0,
    faixa_aging VARCHAR(10) CHECK (faixa_aging IN ('1-30', '31-60', '61-90', '>90')),
    status_cobranca VARCHAR(30) DEFAULT 'Aguardando',
    observacoes TEXT
);

-- =================================================================
-- CARGA DE DADOS INICIAIS DE TESTE (VALORES REAIS EXTRAÍDOS DOS PDFS)
-- =================================================================

-- 1. Usuário de Acesso 'rorim' (Senha: 1987)
INSERT INTO usuarios (id, nome, email, funcao, senha_hash)
VALUES ('usr_rorim', 'Rorim Admin', 'rorim@parisdakar.com.br', 'admin', '1987')
ON CONFLICT (email) DO UPDATE SET senha_hash = '1987', nome = 'Rorim Admin';

-- 2. DRE - Resultado Econômico 2025 (Dados do PDF 1) e 2026
INSERT INTO resultado_economico (ano, mes_chave, receita_bruta, cmv, margem_bruta, despesas_fixas, resultado_economico, ponto_equilibrio)
VALUES 
(2025, 'jan', 478317.96, 348429.12, 129888.84, 141766.31, -11877.47, 522056.95),
(2025, 'fev', 407662.97, 296007.43, 111655.54, 137509.75, -25854.21, 502058.68),
(2025, 'mar', 623080.63, 454524.20, 168556.43, 138546.16, 30010.27, 512145.57),
(2025, 'abr', 655737.82, 480545.77, 175192.05, 147458.19, 27733.86, 551930.94),
(2025, 'mai', 716433.77, 538068.94, 178364.83, 155857.07, 22507.76, 626027.39),
(2025, 'jun', 605405.88, 457875.31, 147530.57, 138502.33, 9028.24, 568357.63),
(2026, 'jan', 628917.11, 440824.00, 188093.11, 134704.41, 53388.70, 450404.10),
(2026, 'fev', 599684.82, 463016.77, 136668.05, 137317.36, -649.31, 602533.92),
(2026, 'mar', 536606.00, 399562.42, 137043.58, 134760.79, 2282.79, 527667.54),
(2026, 'abr', 595122.72, 433805.67, 161317.05, 131854.14, 29462.91, 486429.64),
(2026, 'mai', 628661.96, 442552.36, 186109.60, 140051.35, 46058.25, 473081.22),
(2026, 'jun', 694768.07, 496234.67, 198533.40, 140031.55, 58501.85, 490040.72),
(2026, 'jul', 728279.92, 531113.70, 197166.22, 139985.45, 57180.77, 517069.26),
(2026, 'ago', 535844.58, 391765.49, 144079.09, 143508.96, 570.13, 533724.21),
(2026, 'set', 657064.01, 480548.85, 176515.16, 141043.36, 35471.80, 525022.98),
(2026, 'out', 634553.94, 463520.47, 171033.47, 138229.14, 32804.33, 512846.08),
(2026, 'nov', 491073.13, 370028.42, 121044.71, 113275.30, 7769.41, 459552.97),
(2026, 'dez', 603973.36, 448095.58, 155877.78, 155512.51, 365.27, 602558.06)
ON CONFLICT (ano, mes_chave) DO UPDATE SET 
receita_bruta = EXCLUDED.receita_bruta,
cmv = EXCLUDED.cmv,
margem_bruta = EXCLUDED.margem_bruta,
despesas_fixas = EXCLUDED.despesas_fixas,
resultado_economico = EXCLUDED.resultado_economico,
ponto_equilibrio = EXCLUDED.ponto_equilibrio;

-- 3. Fluxo Financeiro 2026 (Dados do PDF 2)
INSERT INTO resultado_financeiro (ano, mes_chave, entradas_bancos, entradas_tesouraria, total_entradas, total_saidas, resultado_financeiro, estoque, inadimplencia_mensal, inadimplencia_acumulada)
VALUES
(2026, 'jan', 363360.65, 52945.00, 416305.65, 486128.44, -69822.79, 3096333.10, 32723.19, 247895.79),
(2026, 'fev', 343203.62, 104959.50, 448163.12, 400303.22, 47859.90, 3066970.66, 49696.03, 266259.03),
(2026, 'mar', 448402.09, 82075.00, 530477.09, 470947.67, 59529.42, 3085527.22, 93237.01, 274578.00),
(2026, 'abr', 618932.21, 57553.00, 676485.21, 728214.36, -51729.15, 3021020.62, 120262.92, 324385.87),
(2026, 'mai', 505053.52, 81104.63, 586158.15, 625704.02, -39545.87, 3396248.94, 91534.79, 372590.10),
(2026, 'jun', 440508.65, 64469.00, 504977.65, 572018.05, -67040.40, 3313253.68, 98381.11, 410206.24)
ON CONFLICT (ano, mes_chave) DO UPDATE SET
entradas_bancos = EXCLUDED.entradas_bancos,
entradas_tesouraria = EXCLUDED.entradas_tesouraria,
total_entradas = EXCLUDED.total_entradas,
total_saidas = EXCLUDED.total_saidas,
resultado_financeiro = EXCLUDED.resultado_financeiro,
estoque = EXCLUDED.estoque,
inadimplencia_mensal = EXCLUDED.inadimplencia_mensal,
inadimplencia_acumulada = EXCLUDED.inadimplencia_acumulada;

-- 4. Cadastro de Clientes
INSERT INTO clientes (id, codigo, cnpj_cpf, razao_social, nome_fantasia, contato_nome, telefone, email, cidade, estado, limite_credito, saldo_atual, valor_inadimplente, status, ultima_compra)
VALUES
('cli-001', 'CLI001', '12.345.678/0001-90', 'Auto Peças Paris Dakar Ltda', 'Paris Dakar Peças', 'Fernando Oliveira', '(11) 98765-4321', 'financeiro@parisdakarpecas.com.br', 'São Paulo', 'SP', 250000.00, 124500.00, 45200.00, 'Inadimplente', '2026-05-15'),
('cli-002', 'CLI002', '98.765.432/0001-10', 'Transportadora Sertão Rally S.A.', 'Sertão Express', 'Cláudia Mendes', '(21) 99123-8877', 'cobranca@sertaoexpress.com', 'Rio de Janeiro', 'RJ', 500000.00, 310200.00, 98381.11, 'Inadimplente', '2026-06-02'),
('cli-003', 'CLI003', '45.112.334/0001-55', 'Mecânica e Serviços Garagem Central', 'Garagem Central', 'Antônio Prado', '(31) 98444-2211', 'contato@garagemcentral.com.br', 'Belo Horizonte', 'MG', 150000.00, 42000.00, 0.00, 'Adimplente', '2026-06-20'),
('cli-004', 'CLI004', '33.888.777/0001-22', 'Distribuidora de Peças Rota 4x4', 'Rota 4x4', 'Beatriz Lima', '(41) 99888-3344', 'financeiro@rota4x4.com', 'Curitiba', 'PR', 300000.00, 180000.00, 62400.00, 'Risco', '2026-05-28'),
('cli-005', 'CLI005', '21.555.444/0001-99', 'Logística e Frotas Offroad do Brasil', 'Frotas Offroad', 'Henrique Viana', '(71) 99333-1122', 'financeiro@frotasoffroad.com.br', 'Salvador', 'BA', 400000.00, 85000.00, 0.00, 'Adimplente', '2026-06-18')
ON CONFLICT (id) DO UPDATE SET
razao_social = EXCLUDED.razao_social,
nome_fantasia = EXCLUDED.nome_fantasia,
saldo_atual = EXCLUDED.saldo_atual,
valor_inadimplente = EXCLUDED.valor_inadimplente,
status = EXCLUDED.status;

-- 5. Títulos Inadimplentes
INSERT INTO titulos_inadimplentes (id, numero_titulo, cliente_id, data_emissao, data_vencimento, valor_original, valor_atualizado, dias_atraso, faixa_aging, status_cobranca, observacoes)
VALUES
('tit-001', 'DUP-2026-0891', 'cli-001', '2026-03-10', '2026-04-10', 45200.00, 48364.00, 72, '61-90', 'Em Cobrança', 'Cliente alegou atraso de repasse do cliente final. Promessa de quitação parcial.'),
('tit-002', 'DUP-2026-0942', 'cli-002', '2026-04-05', '2026-05-05', 98381.11, 104283.98, 47, '31-60', 'Acordo em Andamento', 'Proposta de parcelamento em 3x enviada ao departamento jurídico.'),
('tit-003', 'DUP-2026-1015', 'cli-004', '2026-05-12', '2026-06-12', 62400.00, 63648.00, 10, '1-30', 'Aguardando', 'Notificação extrajudicial de cobrança amigável enviada por e-mail.'),
('tit-004', 'DUP-2026-0711', 'cli-001', '2026-01-15', '2026-02-15', 79200.00, 88704.00, 126, '>90', 'Negativado', 'Título encaminhado ao Cartório de Protestos de São Paulo.')
ON CONFLICT (id) DO UPDATE SET
valor_atualizado = EXCLUDED.valor_atualizado,
dias_atraso = EXCLUDED.dias_atraso,
status_cobranca = EXCLUDED.status_cobranca,
observacoes = EXCLUDED.observacoes;`;

  const handleTest = (e: React.FormEvent) => {
    e.preventDefault();
    setIsTesting(true);
    onTestConnection({ host, port: parseInt(port, 10), database, user, password });
    setTimeout(() => {
      setIsTesting(false);
    }, 1200);
  };

  const copyDdlToClipboard = () => {
    navigator.clipboard.writeText(ddlScript);
    setCopiedDdl(true);
    setTimeout(() => setCopiedDdl(false), 2000);
  };

  const downloadDdlFile = () => {
    const blob = new Blob([ddlScript], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema_parisgerencial.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              BANCO DE DADOS
            </span>
            <span className="text-xs text-[#8B7D6B]">• Firebase Firestore: paris-dakar-gerencial</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Configurações do Banco de Dados Firebase Firestore</h2>
          <p className="text-xs text-[#8B7D6B]">
            Banco principal: Firebase Firestore (NoSQL em nuvem). Script SQL DDL disponível para referência/migração.
          </p>
        </div>

        <div className="px-3 py-1.5 rounded-lg border flex items-center gap-2 text-xs font-bold bg-emerald-50 text-emerald-800 border-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Firebase Firestore · Projeto: paris-dakar-gerencial</span>
        </div>
      </div>

      {/* Connection Config Form */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
          <Database className="w-4 h-4 text-[#C19A6B]" />
          Parâmetros de Conexão com o Banco PostgreSQL
        </h3>

        <form onSubmit={handleTest} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Host do PostgreSQL</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Porta</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Nome do Banco de Dados</label>
            <input
              type="text"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#C19A6B] font-mono font-bold focus:outline-none focus:border-[#C19A6B]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Usuário (User)</label>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Senha (Password)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isTesting}
              className="w-full py-2.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-4 h-4 text-[#C19A6B] ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'Testando Conexão...' : 'Testar Conexão com PostgreSQL'}</span>
            </button>
          </div>
        </form>

        {dbConfig.error && (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p>{dbConfig.error}</p>
          </div>
        )}
      </div>

      {/* DDL Script Viewer */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#2D2A26] flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[#C19A6B]" />
            Script DDL de Criação do Banco PostgreSQL (schema_parisgerencial.sql)
          </h3>

          <div className="flex items-center space-x-2">
            <button
              onClick={copyDdlToClipboard}
              className="px-3 py-1.5 text-xs font-bold bg-[#F9F7F2] hover:bg-[#EAE6DF] text-[#2D2A26] rounded-lg border border-[#EAE6DF] transition-colors flex items-center gap-1"
            >
              {copiedDdl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedDdl ? 'Copiado!' : 'Copiar SQL'}</span>
            </button>
            <button
              onClick={downloadDdlFile}
              className="px-3 py-1.5 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-colors flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5 text-[#C19A6B]" />
              <span>Baixar .SQL</span>
            </button>
          </div>
        </div>

        <pre className="p-4 rounded-lg bg-[#2D2A26] border border-[#3F3B35] text-[#EAE6DF] text-xs font-mono overflow-x-auto max-h-96">
          {ddlScript}
        </pre>
      </div>
    </div>
  );
};
