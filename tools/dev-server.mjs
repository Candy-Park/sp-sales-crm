import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {handleApi} from '../src/api.mjs';
import {publicConfig} from '../src/public-config.mjs';
import {localOutlook,localWorkflow,localHandling} from './outlook-local.mjs';

const origin='http://127.0.0.1:4317';
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/bootstrap.css',['bootstrap.css','text/css; charset=utf-8']],['/assets/sp-logo-transparent.png',['assets/sp-logo-transparent.png','image/png']]]);
const config={SUPABASE_URL:process.env.SUPABASE_URL ?? 'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY ?? ''};
config.localOutlook=localOutlook(config);
config.localWorkflow=localWorkflow;
config.localHandling=localHandling;
createServer(async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://glscckjmlwvxilzneqdf.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if(req.headers.host!=='127.0.0.1:4317' || (req.headers.origin && req.headers.origin!==origin)) {
      res.writeHead(403);res.end('Forbidden');return;
    }
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')) {
      let body;
      if(!['GET','HEAD'].includes(req.method)){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>800000){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'입력 내용이 너무 큽니다.'}));return;}chunks.push(chunk);}
        body=Buffer.concat(chunks);
      }
      const response=await handleApi(new Request(url,{method:req.method,headers:req.headers,body}),config);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    if(url.pathname==='/config.json') {
      res.setHeader('Content-Type','application/json');
      const safe=publicConfig(config);
      if(!safe){res.writeHead(503);res.end(JSON.stringify({error:'로그인 연결을 준비하고 있습니다.'}));return;}
      res.end(JSON.stringify(safe));return;
    }
    const file=files.get(url.pathname);if(!file){res.writeHead(404);res.end();return;}
    const content=await readFile(new URL('../dist/'+file[0],import.meta.url));
    res.setHeader('Content-Type',file[1]);res.end(content);
  } catch {res.writeHead(503);res.end('CRM temporarily unavailable');}
}).listen(4317,'127.0.0.1',()=>console.log('CRM local preview: '+origin));
