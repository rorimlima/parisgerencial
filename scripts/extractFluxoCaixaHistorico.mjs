/**
 * Imprime em JSON os planos mensais de Fluxo de Caixa extraídos da planilha
 * legada "FLUXO DE CAIXA (1).xlsx" — para conferência antes de importar.
 * A lógica de extração está em scripts/lib/fluxoCaixaHistoricoParser.mjs.
 *
 * Uso: node scripts/extractFluxoCaixaHistorico.mjs "<caminho.xlsx>" [anoInicial]
 *      (anoInicial = ano do primeiro bloco "MARÇO"; padrão 2025)
 */
import { extractFluxoCaixaHistorico } from './lib/fluxoCaixaHistoricoParser.mjs';

const file = process.argv[2];
const anoInicial = parseInt(process.argv[3], 10) || 2025;

if (!file) {
  console.error('Uso: node scripts/extractFluxoCaixaHistorico.mjs "<caminho.xlsx>" [anoInicial]');
  process.exit(1);
}

try {
  const plans = extractFluxoCaixaHistorico(file, anoInicial);
  console.log(JSON.stringify(plans, null, 2));
} catch (err) {
  console.error('Erro:', err.message);
  process.exit(1);
}
