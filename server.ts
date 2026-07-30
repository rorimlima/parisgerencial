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
  FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || 'paris-dakar-gerencial',
  APP_NAME: process.env.VITE_APP_NAME || 'Paris Dakar Gerencial',
  APP_URL: process.env.VITE_APP_URL || `http://localhost:${PORT}`,
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
    console.log(`📦 Banco de dados: Firebase Firestore (${ENV.FIREBASE_PROJECT_ID})\n`);
  });
}

startServer();
