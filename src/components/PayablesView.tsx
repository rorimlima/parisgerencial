/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PayablesView — APOSENTADA.
 *
 * A tela de Contas a Pagar virou uma instância de `TitulosWorkspace`, o mesmo
 * componente que atende Contas a Receber. Os dois lados saem do relatório
 * RFN046 com layout idêntico; manter duas telas irmãs significava aplicar toda
 * correção duas vezes — e, na prática, aplicar uma vez só, até as duas
 * divergirem e ninguém saber qual estava certa.
 *
 * O arquivo permanece apenas como ponte para imports antigos. O App.tsx já
 * renderiza `TitulosWorkspace` com `movType="P"`.
 */

export { TitulosWorkspace as PayablesView } from './TitulosWorkspace';
export type { TitulosWorkspaceProps as PayablesViewProps } from './TitulosWorkspace';
