import {handleRemoteApi} from './remote-api.mjs';
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  let result;
  if(url.pathname.startsWith('/api/')||url.pathname==='/config.json')result=await handleRemoteApi(request,env);
  else if(!['GET','HEAD'].includes(request.method))result=new Response(null,{status:405});
  else result=await env.ASSETS.fetch(request);
  const headers=new Headers(result.headers);
  headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://glscckjmlwvxilzneqdf.supabase.co; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
  headers.set('referrer-policy','no-referrer');headers.set('x-content-type-options','nosniff');
  headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
  headers.set('strict-transport-security','max-age=31536000');
  if(url.pathname.startsWith('/api/'))headers.set('cache-control','no-store');
  return new Response(result.body,{status:result.status,headers});
 }
};
