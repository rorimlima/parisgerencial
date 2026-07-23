import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Smartphone, X } from 'lucide-react';

// ── Hook de instalação PWA ────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UsePwaInstallResult {
  isInstallable: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  install: () => Promise<void>;
}

export function usePwaInstall(): UsePwaInstallResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as any).MSStream;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setIsInstallable(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      setDeferredPrompt(null);
    }
  };

  return { isInstallable, isIOS, isStandalone, install };
}

// ── Componente Banner de Instalação ──────────────────────────────────────────

const DISMISSED_KEY = 'pdg_pwa_install_dismissed';

export const PwaInstallBanner: React.FC = () => {
  const { isInstallable, isIOS, isStandalone, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [visible, setVisible] = useState(false);

  // Atrasa a exibição 2s para não distrair no carregamento
  useEffect(() => {
    if ((isInstallable || isIOS) && !isStandalone && !dismissed) {
      const t = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(t);
    }
  }, [isInstallable, isIOS, isStandalone, dismissed]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch { /* */ }
  };

  const handleInstall = async () => {
    await install();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96 animate-in slide-in-from-bottom-4 duration-500"
      role="alertdialog"
      aria-label="Instalar Paris Dakar Gerencial"
    >
      <div className="bg-[#1a1714] border border-[#C19A6B]/40 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        {/* Ícone */}
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#C19A6B]/20 border border-[#C19A6B]/30 flex items-center justify-center">
          <Smartphone className="w-6 h-6 text-[#C19A6B]" />
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight">
            Instalar Paris Dakar Gerencial
          </p>

          {isIOS ? (
            <p className="text-[11px] text-[#8B7D6B] mt-1 leading-relaxed">
              Toque em <strong className="text-[#C19A6B]">Compartilhar</strong> →{' '}
              <strong className="text-[#C19A6B]">Adicionar à Tela Inicial</strong> para instalar o app.
            </p>
          ) : (
            <p className="text-[11px] text-[#8B7D6B] mt-1">
              Acesse o sistema como um app nativo, offline e mais rápido.
            </p>
          )}

          {!isIOS && (
            <div className="flex items-center gap-2 mt-3">
              <button
                id="pwa-install-btn"
                onClick={handleInstall}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C19A6B] hover:bg-[#B08A5B] text-white text-xs font-bold rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Instalar App</span>
              </button>
              <button
                id="pwa-dismiss-btn"
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs text-[#8B7D6B] hover:text-white rounded-lg transition-colors"
              >
                Agora não
              </button>
            </div>
          )}
        </div>

        {/* Fechar */}
        <button
          id="pwa-close-btn"
          onClick={handleDismiss}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[#8B7D6B] hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// ── Componente de Atualização Disponível ──────────────────────────────────────

interface PwaUpdateBannerProps {
  onUpdate: () => void;
  needRefresh: boolean;
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({ onUpdate, needRefresh }) => {
  if (!needRefresh) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-auto max-w-sm animate-in slide-in-from-top-4 duration-500"
      role="status"
      aria-live="polite"
    >
      <div className="bg-[#1a1714] border border-emerald-500/40 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-white">Nova versão disponível!</p>
          <p className="text-[11px] text-[#8B7D6B]">Atualize para obter as últimas melhorias.</p>
        </div>
        <button
          id="pwa-update-btn"
          onClick={onUpdate}
          className="flex-shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors"
        >
          Atualizar
        </button>
      </div>
    </div>
  );
};
