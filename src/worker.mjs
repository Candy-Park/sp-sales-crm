import {handleApi} from './api.mjs';
import {publicConfig} from './public-config.mjs';
export default {
  async fetch(request,env) {
    if(new URL(request.url).pathname==='/config.json') {
      if(request.method!=='GET')return new Response(null,{status:405});
      const config=publicConfig(env);
      return Response.json(config ?? {error:'로그인 연결을 준비하고 있습니다.'},{status:config?200:503,headers:{'cache-control':'no-store'}});
    }
    if(new URL(request.url).pathname.startsWith('/api/')) return handleApi(request,env);
    return env.ASSETS.fetch(request);
  }
};
