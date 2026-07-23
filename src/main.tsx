import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// ── Registro do Service Worker (PWA) ─────────────────────────────────────────
// O autoUpdate faz o SW atualizar silenciosamente quando há nova versão.
// Se quiser mostrar notificação de atualização, use updateSW().
const updateSW = registerSW({
  onNeedRefresh() {
    // Atualiza automaticamente sem prompt
    updateSW(true);
  },
  onOfflineReady() {
    console.log('[PWA] Paris Dakar Gerencial está pronto para uso offline!');
  },
  onRegistered(r) {
    if (r) {
      console.log('[PWA] Service Worker registrado com sucesso.');
    }
  },
  onRegisterError(error) {
    console.warn('[PWA] Falha ao registrar Service Worker:', error);
  },
});

// ── Render ────────────────────────────────────────────────────────────────────
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
