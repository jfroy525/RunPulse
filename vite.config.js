import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500, // Increases the warning limit to 1.5MB
    rollupOptions: {
      output: {
        manualChunks: {
          // Splits these heavy libraries into their own separate file to speed up initial loading
          vendor: ['react', 'react-dom', 'recharts', 'firebase', 'lucide-react'],
        }
      }
    }
  }
})