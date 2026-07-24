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
  onGoogleLogin: () => void | Promise<void>;
  loginError?: string;
}

/** Ícone oficial "G" do Google (SVG inline, sem dependência externa). */
const GoogleIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  onGoogleLogin,
  loginError,
}) => {
  if (!isOpen) return null;

  const [email, setEmail] = useState('rorim@parisdakar.com.br');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);

  const handleGoogleClick = async () => {
    setIsGoogleLoading(true);
    try {
      await onGoogleLogin();
    } finally {
      setIsGoogleLoading(false);
    }
  };

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

        <div className="p-6 space-y-4">
          {/* Login com Google — método principal */}
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={isGoogleLoading || isLoading}
            className="w-full py-3 text-xs font-extrabold bg-white hover:bg-[#F9F7F2] disabled:opacity-60 text-[#2D2A26] border border-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center justify-center gap-2.5"
          >
            <GoogleIcon />
            <span>{isGoogleLoading ? 'Abrindo o Google...' : 'Entrar com o Google'}</span>
          </button>

          <p className="text-center text-[10px] text-[#8B7D6B]">
            Use a conta Google (Gmail) autorizada no sistema.
          </p>

          {/* Mensagem de erro */}
          {loginError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <p className="text-xs text-rose-700 font-medium">{loginError}</p>
            </div>
          )}

          {/* Separador */}
          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-[#EAE6DF]" />
            <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wide">ou</span>
            <div className="h-px flex-1 bg-[#EAE6DF]" />
          </div>

          {/* Alternativa: e-mail e senha */}
          {!showEmailLogin ? (
            <button
              type="button"
              onClick={() => setShowEmailLogin(true)}
              className="w-full py-2.5 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26] rounded-lg transition-all"
            >
              Entrar com e-mail e senha
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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

              <button
                type="submit"
                disabled={isLoading || isGoogleLoading}
                className="w-full py-3 text-xs font-extrabold bg-[#2D2A26] hover:bg-[#3F3B35] disabled:opacity-60 text-white rounded-lg shadow-xs transition-all flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4 text-[#C19A6B]" />
                <span>{isLoading ? 'Autenticando...' : 'Entrar no Paris Dakar Gerencial'}</span>
              </button>

              <p className="text-center text-[10px] text-[#8B7D6B]">
                Primeiro acesso de um e-mail autorizado: a senha digitada define seu acesso definitivo.
              </p>
            </form>
          )}

          <p className="text-center text-[10px] text-[#8B7D6B] pt-1">
            Autenticação segura via{' '}
            <span className="text-[#C19A6B] font-bold">Firebase Auth</span> · Projeto:{' '}
            <span className="font-mono">paris-dakar-gerencial</span>
          </p>
        </div>
      </div>
    </div>
  );
};
