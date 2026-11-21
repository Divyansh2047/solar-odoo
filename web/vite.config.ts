import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  preview: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const p = id.replace(/\\/g, '/');
          // the 3D stack (three, fiber and fiber's own reconciler) stays in a lazy chunk
          if (/node_modules\/(three|three-stdlib|@react-three|react-reconciler|its-fine|react-use-measure|suspend-react|zustand)\//.test(p)) return 'three';
          if (p.includes('/@zxing/')) return 'scanner';
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(p)) return 'react';
          if (id.includes('@tanstack') || id.includes('react-hook-form') || id.includes('zod')) return 'data';
          return undefined;
        },
      },
    },
  },
});
