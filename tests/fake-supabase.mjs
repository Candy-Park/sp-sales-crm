// Used ONLY by the synthetic browser fixture build, never production tools/build.mjs.
export function createClient(){let session=null;let callback=()=>{};return {auth:{
  async getSession(){return {data:{session}};},
  async signInWithPassword(){session={access_token:'synthetic-browser-token'};return {error:null};},
  async signOut(){session=null;callback('SIGNED_OUT');return {error:null};},
  onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){}}}};}
}};}
