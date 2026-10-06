export function publicConfig(env){
  if(env.SUPABASE_URL!=='https://glscckjmlwvxilzneqdf.supabase.co'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY??''))return null;
  return {url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY};
}
