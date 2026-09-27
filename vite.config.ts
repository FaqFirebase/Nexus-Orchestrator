import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const FONT_FILE_PATTERN = /\.(woff2?|ttf|otf|eot)$/;

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      // Never inline fonts as data: URIs — the server CSP only allows font-src 'self'.
      assetsInlineLimit: (filePath: string) => (FONT_FILE_PATTERN.test(filePath) ? false : undefined),
    },
  };
});
