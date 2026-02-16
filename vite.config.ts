import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/frontend',
  build: {
    outDir: '../../dist-vite',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/frontend/index.html'),
    },
  },
  server: {
    port: 3000,
  },
});
