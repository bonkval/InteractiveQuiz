import {defineConfig} from 'vite';
import {resolve} from 'node:path';

export default defineConfig({
  input: {
    app: resolve(import.meta.dirname, 'index.html'),
    privacy: resolve(import.meta.dirname, 'privacy.html'),
    terms: resolve(import.meta.dirname, 'terms.html'),
    cookies: resolve(import.meta.dirname, 'cookies.html')
  }
});
