/**
 * server.ts — Paris Dakar Gerencial
 * Servidor Express simples para desenvolvimento com Vite.
 * O banco de dados é Firebase Firestore (acesso direto do frontend).
 * Este servidor serve apenas o app React e proxy de desenvolvimento.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);

// Variáveis de ambiente carregadas do .env
const ENV = {
  FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || '',
  FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || 'paris-dakar-gerencial',
  FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  APP_NAME: process.env.VITE_APP_NAME || 'Paris Dakar Gerencial',
  APP_URL: process.env.VITE_APP_URL || `http://localhost:${PORT}`,
  API_SECRET_KEY: process.env.API_SECRET_KEY || process.env.VITE_API_SECRET_KEY || '',
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // ── Endpoint: Health check / Status ───────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: ENV.APP_NAME,
      database: 'Firebase Firestore',
      project: ENV.FIREBASE_PROJECT_ID,
      timestamp: new Date().toISOString(),
      env: {
        firebase_project: ENV.FIREBASE_PROJECT_ID,
        firebase_auth_domain: ENV.FIREBASE_AUTH_DOMAIN,
        app_url: ENV.APP_URL,
      },
    });
  });

  // ── Endpoint: Config pública do Firebase (lida do .env) ───────────────────
  // O frontend já lê do VITE_ via import.meta.env, mas deixamos aqui para
  // sistemas externos ou depuração.
  app.get('/api/firebase-config', (_req, res) => {
    if (!ENV.FIREBASE_API_KEY) {
      return res.status(503).json({ error: 'Firebase não configurado no .env' });
    }
    res.json({
      apiKey: ENV.FIREBASE_API_KEY,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: ENV.FIREBASE_PROJECT_ID,
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.VITE_FIREBASE_APP_ID,
    });
  });

  // ── Vite Dev Server / Produção ─────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 [Paris Dakar Gerencial] Servidor rodando em http://localhost:${PORT}`);
    console.log(`📦 Banco de dados: Firebase Firestore (${ENV.FIREBASE_PROJECT_ID})`);
    console.log(`🔑 Firebase API Key: ${ENV.FIREBASE_API_KEY ? '✓ configurada' : '⚠ não encontrada no .env'}\n`);
  });
}

startServer();
