/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * statementKeys.ts — Identidade dos lançamentos do Extrato Financeiro.
 *
 * POR QUE ESTE ARQUIVO EXISTE (leia antes de mexer)
 * -------------------------------------------------
 * Duplicidade em extrato não é bug cosmético: cada lançamento repetido entra
 * duas vezes no Resultado Financeiro e o caixa da empresa passa a mentir. A
 * única defesa confiável é uma CHAVE DETERMINÍSTICA — a mesma linha da mesma
 * planilha tem que gerar sempre a mesma chave, hoje, amanhã, em qualquer
 * máquina, seja pela tela de importação ou por script.
 *
 * Por isso a regra de chave mora AQUI e só aqui. A tela de importação e o
 * seeder (scripts/seedTesouraria.mjs) importam deste módulo. Se cada um
 * tivesse a própria fórmula, uma reimportação pela tela duplicaria tudo que o
 * script já tinha gravado — que é exatamente o problema que este arquivo evita.
 *
 * HIERARQUIA DE CHAVE
 * -------------------
 * 1. RFN019 (caixa/tesouraria): usa `Tesouraria_Codigo`, que é o ID do
 *    movimento no ERP — conferido nos dois extratos reais: 1.950 códigos
 *    distintos em 1.950 linhas e 175 em 175, zero colisão. É chave de verdade,
 *    não heurística.
 *
 *    ATENÇÃO: o código só é único DENTRO de uma conta. As faixas das duas
 *    contas se cruzam (30101 vai de 160.225 a 378.474, dentro da faixa da
 *    30108, de 69.907 a 378.337). Sem o código da conta na chave, um movimento
 *    do caixa sobrescreveria o da tesouraria em silêncio. Daí `accountCode`
 *    ser obrigatório aqui.
 *
 * 2. Bradesco / PagSeguro: o extrato bancário não traz identificador de
 *    movimento, então a chave é composta (fonte + data + documento + descrição
 *    + valores) com um contador de ocorrência para o caso legítimo de duas
 *    linhas idênticas no mesmo dia. O contador é estável porque depende só da
 *    ordem dentro do arquivo, que não muda entre reimportações do mesmo extrato.
 */

/** Contas de caixa/tesouraria atendidas pelo RFN019. */
export interface TesourariaAccount {
  code: string;
  label: string;
  shortLabel: string;
  description: string;
}

/**
 * O RFN019 NÃO traz o número da conta em nenhuma coluna — conferido nas duas
 * planilhas reais, coluna por coluna. O identificador que aparece
 * (`ContaGerencial_Identificador`) é a conta gerencial do lançamento (despesa,
 * transferência), não o caixa de origem. Ou seja: só quem exportou o relatório
 * sabe de qual conta ele é, e por isso a conta é escolhida na importação em vez
 * de adivinhada. Adivinhar aqui significaria lançar dinheiro na conta errada.
 */
export const TESOURARIA_ACCOUNTS: Record<string, TesourariaAccount> = {
  '30108': {
    code: '30108',
    label: 'Caixa 30108',
    shortLabel: 'Caixa 30108',
    description: 'Caixa da loja — recebimentos e pagamentos em dinheiro no balcão.',
  },
  '30101': {
    code: '30101',
    label: 'Tesouraria 30101',
    shortLabel: 'Tesouraria 30101',
    description: 'Tesouraria central — pagamentos em dinheiro de títulos e borderôs.',
  },
  '30107': {
    code: '30107',
    label: 'Caixa 30107',
    shortLabel: 'Caixa 30107',
    description: 'Caixa 301.07 — alimenta a tesouraria 30101 por transferência interna.',
  },
  '30110': {
    code: '30110',
    label: 'Caixa 30110',
    shortLabel: 'Caixa 30110',
    description: 'Caixa 301.10 — alimenta a tesouraria 30101 por transferência interna.',
  },
};

/**
 * A FAIXA 301xx É TODA CAIXA/TESOURARIA DA MESMA EMPRESA.
 *
 * O plano de contas reserva 301.xx para as contas de caixa e tesouraria —
 * 301.01 (tesouraria), 301.07, 301.08 e 301.10 (caixas). Dinheiro que sai de
 * uma dessas contas e entra em outra NÃO é receita: é a mesma nota trocando de
 * bolso, e cada movimento desses aparece DUAS vezes na base (como saída na
 * conta de origem e como entrada na conta de destino).
 *
 * Esta função é a definição única de "conta de caixa" no sistema. Ela responde
 * a partir do identificador da conta gerencial OU do texto da classificação,
 * porque o ERP nem sempre preenche os dois campos — e reconhece qualquer
 * sufixo (não só os quatro já cadastrados acima), para que uma conta nova
 * aberta no ERP não volte a inflar as entradas em silêncio.
 */
export const isCashAccountCode = (raw: any): boolean => {
  const digits = (raw ?? '').toString().replace(/\D/g, '');
  if (!digits) return false;
  return /^301\d{0,3}$/.test(digits);
};

/** Extrai o código da conta de caixa citada num texto ('CAIXA 301.07' → '30107'). */
export const extractCashAccountFromText = (raw: any): string => {
  const text = normalizeKeyText(raw);
  const m = text.match(/301\s*\.?\s*(\d{2})/);
  return m ? `301${m[1]}` : '';
};

export const DEFAULT_TESOURARIA_ACCOUNT = '30108';

/**
 * Normaliza um texto para uso em chave: minúsculo, sem acento, espaços
 * colapsados. Sem isso, "PAGTO ELETRON" e "Pagto  Eletron" viram chaves
 * diferentes e a mesma linha entra duas vezes.
 */
export const normalizeKeyText = (raw: any): string =>
  (raw ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Chave do RFN019. `Tesouraria_Codigo` + conta = identidade do movimento.
 * Reimportar a planilha inteira mil vezes atualiza as mesmas mil linhas.
 */
export const buildTesourariaDedupeKey = (accountCode: string, tesourariaCodigo: any): string =>
  `tesouraria|${accountCode}|${normalizeKeyText(tesourariaCodigo)}`;

/**
 * Chave dos extratos bancários, que não têm ID de movimento.
 * `occurrence` distingue linhas legitimamente idênticas no mesmo arquivo.
 */
export const buildBankDedupeKey = (params: {
  source: string;
  date: string;
  documentRef: string;
  description: string;
  entryAmount: number;
  exitAmount: number;
  occurrence: number;
}): string => {
  const { source, date, documentRef, description, entryAmount, exitAmount, occurrence } = params;
  const base = [
    source,
    date,
    normalizeKeyText(documentRef),
    normalizeKeyText(description),
    entryAmount.toFixed(2),
    exitAmount.toFixed(2),
  ].join('|');
  return `${base}#${occurrence}`;
};

/**
 * Chave do EXTRATO GERAL (formato único de importação, 8 colunas).
 *
 * POR QUE A COLUNA "ID" DA PLANILHA NÃO ENTRA AQUI
 * -----------------------------------------------
 * O ID do extrato geral é o número da linha, não o ID do movimento no banco.
 * Número de linha se renumera: inserir um lançamento em fevereiro empurra todos
 * os IDs seguintes. Se a chave fosse o ID, a próxima exportação da mesma
 * planilha geraria chaves novas para lançamentos que já estão gravados, e a base
 * inteira entraria duplicada — o oposto do que este arquivo existe para impedir.
 *
 * A identidade é, então, o CONTEÚDO: banco + data + histórico + valor líquido
 * (com sinal, porque é o sinal que separa entrada de saída). O chamador
 * acrescenta `#ocorrência` para o caso legítimo de dois lançamentos idênticos no
 * mesmo dia — duas tarifas iguais, dois PIX do mesmo valor.
 *
 * O valor entra com 2 casas fixas: 1500 e 1500.00 têm que gerar a mesma chave,
 * senão a mesma linha reimportada de um arquivo salvo em outro formato duplica.
 */
export const buildExtratoGeralDedupeKey = (params: {
  bank: string;
  date: string;
  description: string;
  netAmount: number;
}): string => {
  const { bank, date, description, netAmount } = params;
  return [
    'extrato_geral',
    normalizeKeyText(bank).replace(/[^a-z0-9]+/g, ''),
    date,
    normalizeKeyText(description),
    netAmount.toFixed(2),
  ].join('|');
};

/** Hash FNV-1a de 32 bits, estável entre execuções e plataformas. */
const fnv1a = (str: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

/**
 * Converte a chave em ID de documento do Firestore.
 *
 * O ID determinístico é o que permite gravar com `batch.set(..., {merge:true})`
 * SEM precisar ler a coleção inteira antes para descobrir se a linha já existe:
 * o próprio banco resolve o upsert. Numa importação de 2.125 linhas isso é a
 * diferença entre uma leitura de milhares de documentos + 2.125 idas ao
 * servidor e apenas 6 lotes de escrita.
 *
 * Restrições do Firestore respeitadas aqui: sem '/', sem '.' ou '..' isolados,
 * máximo de 1.500 bytes. Chaves longas (descrição de banco) viram prefixo
 * legível + hash, para continuarem únicas sem estourar o limite.
 */
export const statementDocId = (dedupeKey: string): string => {
  // '/' quebraria o caminho do documento; '|', ':' e '#' são legais mas viram
  // escape na URL do console do Firebase e atrapalham na hora de investigar um
  // lançamento na mão. Tudo vira '_'.
  const safe = dedupeKey
    .replace(/[\/\\#?\[\]*|:\s]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .replace(/_+/g, '_');
  // O hash entra sempre que o texto for cortado, para que duas descrições
  // longas com o mesmo começo não caiam no mesmo documento.
  if (safe.length <= 180) return `ext_${safe}`;
  return `ext_${safe.slice(0, 140)}_${fnv1a(dedupeKey)}`;
};
