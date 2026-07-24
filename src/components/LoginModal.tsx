/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LoginModal.tsx — Autenticação via Firebase Auth
 */

import React, { useState } from 'react';
import { AlertCircle, Lock, LogIn, User, X } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (credentials: { email: string; password: string }) => void;
  loginError?: string;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  loginError,
}) => {
  if (!isOpen) return null;

  const [email, setEmail] = useState('rorim@parisdakar.com.br');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onLoginSuccess({
        email: email.includes('@') ? email : `${email}@parisdakar.com.br`,
        password,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D2A26]/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-md shadow-lg overflow-hidden text-[#2D2A26]">
        {/* Header */}
        <div className="p-6 bg-[#F9F7F2] border-b border-[#EAE6DF] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-[#2D2A26] flex items-center justify-center text-[#C19A6B] font-black shadow-xs">
              PD
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#2D2A26]">Paris Dakar Gerencial</h3>
              <p className="text-xs text-[#8B7D6B]">Autenticação Firebase — Controle por perfil (RBAC)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-[#8B7D6B] hover:text-[#2D2A26]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* E-mail */}
          <div>
            <label className="block text-xs font-bold text-[#8B7D6B] mb-1">E-mail Corporativo</label>
            <div className="relative">
              <User className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-3" />
              <input
                type="text"
                required
                placeholder="rorim@parisdakar.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2.5 rounded-lg focus:outline-none focus:border-[#C19A6B] font-mono"
              />
            </div>
          </div>

          {/* Senha */}
          <div>
            <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Senha de Acesso</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-3" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2.5 rounded-lg focus:outline-none focus:border-[#C19A6B] font-mono"
              />
            </div>
          </div>

          {/* Mensagem de erro */}
          {loginError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <p className="text-xs text-rose-700 font-medium">{loginError}</p>
            </div>
          )}

          {/* Botão de login */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 text-xs font-extrabold bg-[#2D2A26] hover:bg-[#3F3B35] disabled:opacity-60 text-white rounded-lg shadow-xs transition-all flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4 text-[#C19A6B]" />
              <span>{isLoading ? 'Autenticando...' : 'Entrar no Paris Dakar Gerencial'}</span>
            </button>
          </div>

          <p className="text-center text-[10px] text-[#8B7D6B]">
            Autenticação segura via{' '}
            <span className="text-[#C19A6B] font-bold">Firebase Auth</span> · Projeto:{' '}
            <span className="font-mono">paris-dakar-gerencial</span>
            <br />
            Primeiro acesso de um e-mail autorizado: a senha digitada define seu acesso definitivo.
          </p>
        </form>
      </div>
    </div>
  );
};
