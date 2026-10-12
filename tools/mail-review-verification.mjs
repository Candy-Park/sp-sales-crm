// Isolated synthetic browser harness. No environment, credentials, real mail or database.
import {createServer} from 'node:http';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
const directory='notes/mail-review-verification/';await mkdir(directory,{recursive:true});
await build({entryPoints:['tests/fixtures/mail-review-browser.mjs'],bundle:true,format:'esm',outfile:directory+'app.js'});
await copyFile('web/index.html',directory+'index.html');
const files=new Map([['/assets/fonts/PretendardVariable.woff2',['web/assets/fonts/PretendardVariable.woff2','font/woff2']],['/',[directory+'index.html','text/html']],['/app.js',[directory+'app.js','text/javascript']],['/style.css',['web/style.css','text/css']],['/bootstrap.css',['node_modules/bootstrap/dist/css/bootstrap.min.css','text/css']],['/assets/sp-logo-transparent.png',['web/assets/sp-logo-transparent.png','image/png']]]);
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self'; form-action 'none'; frame-ancestors 'none'");
 if(req.method!=='GET'||req.headers.host!=='127.0.0.1:4330'){res.writeHead(403);res.end();return;}
 const file=files.get(req.url);if(!file){res.writeHead(404);res.end();return;}
 try{res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8'});res.end(await readFile(file[0]));}catch{res.writeHead(500);res.end();}
}).listen(4330,'127.0.0.1',()=>console.log('Synthetic mail review verification ready on 127.0.0.1:4330'));
