import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const appVersion=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;

export default defineConfig({
  plugins:[{name:'inject-app-version',transformIndexHtml(html){return html.replaceAll('__APP_VERSION__',appVersion);}}],
  input: {
    app: resolve(import.meta.dirname, 'index.html'),
    privacy: resolve(import.meta.dirname, 'privacy.html'),
    terms: resolve(import.meta.dirname, 'terms.html'),
    cookies: resolve(import.meta.dirname, 'cookies.html')
  }
});
