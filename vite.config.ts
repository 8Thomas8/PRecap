import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // relative base so dist/index.html works when opened via file://
  base: './',
  plugins: [tailwindcss()],
});
