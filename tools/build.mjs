import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',outdir:'dist',minify:true});
await copyFile('web/index.html','dist/index.html');
await copyFile('web/style.css','dist/style.css');
await copyFile('node_modules/bootstrap/dist/css/bootstrap.min.css','dist/bootstrap.css');
console.log('CRM browser build complete');
