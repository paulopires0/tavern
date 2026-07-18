import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy points at the API server (PORT env of the backend, default 8030).
const backend = `http://localhost:${process.env.PORT || 8030}`;

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['..'] }, // client imports ../shared/hex.js
    proxy: {
      '/api': backend,
      '/uploads': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
});
