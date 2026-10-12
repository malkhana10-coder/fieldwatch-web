import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vite build --mode single` makes one JS + one CSS file (used for the claude.ai preview page).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    rollupOptions: mode === 'single' ? { output: { inlineDynamicImports: true } } : {},
  },
}))
