/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WhatsAppLink — telefone de contato do devedor com atalho para o WhatsApp.
 *
 * O ERP entrega o telefone como "85 988765430" (DDD + número, sem país). Quem
 * está cobrando não deveria ter que copiar, limpar e discar isso à mão, então o
 * número aparece formatado e clicável. Quando o que veio na planilha não tem
 * cara de telefone brasileiro (fixo/celular com DDD), mostramos o texto cru sem
 * link — abrir uma conversa com o número errado é pior do que não abrir.
 */

import React from 'react';
import { MessageCircle } from 'lucide-react';
import { formatPhoneBr, toWhatsAppNumber } from '../utils/sheetParsers';

interface WhatsAppLinkProps {
  phone?: string;
  /** `inline` para tabelas densas; `button` para painéis de detalhe. */
  variant?: 'inline' | 'button';
  className?: string;
}

export const WhatsAppLink: React.FC<WhatsAppLinkProps> = ({
  phone,
  variant = 'inline',
  className = '',
}) => {
  const raw = (phone || '').trim();
  if (!raw) return <span className="text-[#8B7D6B] text-[11px]">Sem telefone</span>;

  const wa = toWhatsAppNumber(raw);
  const label = formatPhoneBr(raw);

  if (!wa) {
    return <span className={`font-mono text-[11px] text-[#8B7D6B] ${className}`}>{label}</span>;
  }

  const base =
    variant === 'button'
      ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors'
      : 'inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-700 hover:text-emerald-900 hover:underline transition-colors';

  return (
    <a
      href={`https://wa.me/${wa}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir conversa no WhatsApp com ${label}`}
      className={`${base} ${className}`}
    >
      <MessageCircle className={variant === 'button' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      <span>{label}</span>
    </a>
  );
};
