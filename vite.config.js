import { defineConfig } from 'vite'

export default defineConfig({
  base: '/WebAIWord/',
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@hufe921/canvas-editor']
  },
  build: {
    target: 'esnext'
  }
})
