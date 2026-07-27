/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PayablesForecastPanel — APOSENTADO.
 *
 * A "previsão de pagamento" deixou de ser uma base e uma tela separadas. Um
 * título previsto e um título pago são a MESMA linha do RFN046 em momentos
 * diferentes, distinguidos por `Titulo_Status`. Enquanto foram duas bases, o
 * mesmo compromisso conseguia existir nas duas ao mesmo tempo e o fluxo de
 * caixa contava a saída duas vezes — uma como previsão, outra como realizado.
 *
 * Hoje a previsão é um filtro dentro de `TitulosWorkspace` (aba Títulos →
 * situação "Em aberto") e uma linha do Fluxo de Caixa.
 */

export { TitulosWorkspace as PayablesForecastPanel } from './TitulosWorkspace';
