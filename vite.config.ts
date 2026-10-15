import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'local-dev-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        // React Fast Refresh injects a local inline preamble in development.
        // The packaged build retains the strict script-src 'self' policy.
        return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
      },
    },
  }],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/release/**', '**/.cache/**', '**/artifacts/**', '**/dist-electron/**'] },
  },
  build: {
    target: 'chrome142', sourcemap: false,
    rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } } },
  },
});
