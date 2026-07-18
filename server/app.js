// App/server assembly, separated from index.js so tests can boot the whole
// stack on an ephemeral port.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { UPLOADS_DIR, CLIENT_DIST, UPLOAD_KINDS } from './config.js';
import { publicRouter } from './routes-public.js';
import { dmRouter } from './routes-dm.js';
import { playerRouter } from './routes-player.js';
import { ensureDefaultArt, resolveDefault } from './defaults.js';
import { setupSockets } from './sockets.js';

export function createServer() {
  ensureDefaultArt();
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', publicRouter);
  app.use('/api/dm', dmRouter);
  app.use('/api/player', playerRouter);

  // "/uploads/<kind>/default" is a stable URL: it serves default.png/jpg/webp
  // dropped into the folder by the user, falling back to the generated .svg.
  app.get('/uploads/:kind/default', (req, res) => {
    if (!UPLOAD_KINDS.includes(req.params.kind)) return res.status(404).end();
    const file = resolveDefault(req.params.kind);
    if (!file) return res.status(404).end();
    res.sendFile(file);
  });
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Built client. Any non-API GET falls back to index.html (the SPA routes by
  // login state + URL params, so every path serves the same page).
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/(api|uploads|socket\.io)\b).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
      if (err) res.status(200).send('Tavern server is running. Build the client first: cd client && npm run build');
    });
  });

  const server = http.createServer(app);
  const io = setupSockets(server);
  return { app, server, io };
}
