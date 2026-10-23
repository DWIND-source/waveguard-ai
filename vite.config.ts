import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: process.env.VITE_STATIC_DEMO === 'true' ? '/waveguard-ai/' : '/',
  plugins: [react(), tailwindcss()],
});
