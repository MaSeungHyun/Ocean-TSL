import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({ plugins: [tailwindcss()], build: { target: 'esnext', chunkSizeWarningLimit: 6000 } })
