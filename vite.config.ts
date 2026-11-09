import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Chemins relatifs + tout intégré en base64 : le build peut devenir un seul fichier HTML
  // (voir scripts/single-file.mjs) qui s'ouvre d'un double-clic, sans serveur.
  base: './',
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
  },
  server: { port: 5173 },
});
