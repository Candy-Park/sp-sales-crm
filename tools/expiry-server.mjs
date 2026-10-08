import {createServer} from 'node:http';
import {readFile, mkdir, copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {handleApi} from '../src/api.mjs';
import {publicConfig} from '../src/public-config.mjs';

const origin = 'http://127.0.0.1:4321';
const output = 'D:/AI/projects/sp-sales-crm/outputs/expiry-ui';
const config = {SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY};
if (!publicConfig(config)) throw new Error('Valid CRM public configuration required');
await mkdir(output + '/assets', {recursive: true});
await build({entryPoints: ['web/app.mjs'], bundle: true, format: 'esm', outfile: output + '/app.js',
  alias: {'@supabase/supabase-js': resolve('tools/expiry-sdk.mjs')}, minify: true});
for (const file of ['index.html', 'style.css', 'assets/sp-logo-transparent.png']) await copyFile('web/' + file, output + '/' + file);
await copyFile('node_modules/bootstrap/dist/css/bootstrap.min.css', output + '/bootstrap.css');
const files = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/bootstrap.css', ['bootstrap.css', 'text/css']], ['/assets/sp-logo-transparent.png', ['assets/sp-logo-transparent.png', 'image/png']]]);
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://glscckjmlwvxilzneqdf.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (req.headers.host !== '127.0.0.1:4321' || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: '검수 전용 화면에서는 업무 저장을 지원하지 않습니다.'})); return;
    }
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const response = await handleApi(new Request(url, {headers: req.headers}), config);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname === '/config.json') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(publicConfig(config))); return;
    }
    const file = files.get(url.pathname);
    if (!file) {res.writeHead(404); res.end(); return;}
    res.setHeader('Content-Type', file[1]); res.end(await readFile(output + '/' + file[0]));
  } catch {res.writeHead(503); res.end('Expiry verification unavailable');}
}).listen(4321, '127.0.0.1', () => console.log('CRM expiry verification: ' + origin));
