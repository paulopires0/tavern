import os from 'node:os';
import { PORT, DM_PASSWORD } from './config.js';
import { getConfig } from './db.js';
import { createServer } from './app.js';

const { server } = createServer();

server.listen(PORT, () => {
  const nets = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal);
  const host = nets[0]?.address || 'localhost';
  console.log('Tavern is up.');
  console.log(`  Local:     http://localhost:${PORT}`);
  console.log(`  LAN:       http://${host}:${PORT}   <- players connect here`);
  console.log(`  TV view:   http://${host}:${PORT}/?tv=${getConfig('spectator_key')}`);
  if (DM_PASSWORD === 'dm1234') {
    console.log('  DM password is the default "dm1234" — set DM_PASSWORD to change it.');
  }
});
