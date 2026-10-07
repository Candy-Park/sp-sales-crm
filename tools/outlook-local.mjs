import {spawn} from 'node:child_process';
let active=null;
const states=new Map();
function invoke(input){
  return new Promise((resolve,reject)=>{
    const child=spawn('python',['tools/outlook_bridge.py'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';
    const timer=setTimeout(()=>child.kill(),900000);
    child.stdout.on('data',c=>{output+=c;if(output.length>10000)child.kill();});
    // Never forward child errors, credentials, mail bodies, or subprocess arguments.
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('Local collector unavailable'));});
    child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error();resolve(JSON.parse(output));}catch{reject(new Error('Local collector failed'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
}
export function localOutlook(config){
  return async(method,owner,authorization,mode='collect')=>{
    if(!['collect','review-sync'].includes(mode))throw new Error('Invalid collector mode');
    if(active&&active.owner!==owner)throw new Error('Collector occupied');
    if(method==='POST'){
      if(!active){
        active={owner};states.set(owner,{...states.get(owner),running:true,error:null});
        invoke({mode,owner,authorization,key:config.SUPABASE_PUBLISHABLE_KEY}).then(result=>states.set(owner,{...result,running:false}),()=>states.set(owner,{running:false,error:'local_collection_failed'})).finally(()=>{active=null;});
      }
      return states.get(owner);
    }
    if(active)return states.get(owner);
    const result=await invoke({mode:'status',owner});
    const state={...states.get(owner),...result,running:false};states.set(owner,state);return state;
  };
}
