import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = process.env.KIUMI_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The server owns `/assets/*` for mirrored template media, so the app's own
  // bundles must not live there.
  build: { assetsDir: 'static' },
  server: {
    port: 5180,
    proxy: {
      '/api': target,
      '/assets': target,
      '/uploads': target,
    },
  },
});
