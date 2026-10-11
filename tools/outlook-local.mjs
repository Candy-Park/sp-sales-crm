import {spawn} from 'node:child_process';
let active=null;
const states=new Map();
function invoke(input,script='tools/outlook_bridge.py'){
  return new Promise((resolve,reject)=>{
    const child=spawn('python',['-X','utf8',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';
    const timer=setTimeout(()=>child.kill(),script==='tools/outlook_followups.py'?(input.mode==='refresh'?400000:20000):['tools/outlook_workflow.py','tools/outlook_handling.py','tools/outlook_discovery.py'].includes(script)?12000:900000);
    child.stdout.on('data',c=>{output+=c;if(output.length>(script==='tools/outlook_followups.py'?1000000:['tools/outlook_handling.py','tools/outlook_discovery.py'].includes(script)?300000:10000))child.kill();});
    // Do not log raw child errors, credentials or arguments. Reviewed excerpts stay in authenticated responses.
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('Local collector unavailable'));});
    child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error();resolve(JSON.parse(output));}catch{reject(new Error('Local collector failed'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
}
export const localWorkflow=(owner,identity,category)=>invoke({owner,identity,category},'tools/outlook_workflow.py');
export const localHandling=owner=>invoke({owner},'tools/outlook_handling.py');
export const localDiscovery=input=>invoke(input,'tools/outlook_discovery.py');
let followupJob=null;
const followupResults=new Map();
export async function localFollowups(input){
 if(input.mode==='analysis')return invoke(input,'tools/outlook_followups.py');
 if(followupJob&&followupJob.owner!==input.owner)throw Error('Followup scan occupied');
 if(input.mode==='status'){
  const cached=followupResults.get(input.owner);
  if(cached?.running)return {...cached,updates:[]};
  if(cached?.error)return {...cached,updates:[]};
  if(cached?.updates?.length===input.targets.length&&input.targets.every(t=>cached.updates.some(row=>row.mail_id===t.id&&row.inquiry_id===t.inquiry_id)))return cached;
  return {...await invoke(input,'tools/outlook_followups.py'),running:false};
 }
 if(!followupJob){
  followupJob={owner:input.owner};
  followupResults.set(input.owner,{...followupResults.get(input.owner),running:true,error:null});
  invoke(input,'tools/outlook_followups.py').then(result=>followupResults.set(input.owner,{...result,running:false}),()=>followupResults.set(input.owner,{...followupResults.get(input.owner),running:false,error:'Outlook 메일 확인을 완료하지 못했습니다. Outlook 연결·프로필을 확인한 뒤 다시 실행하세요.'})).finally(()=>{followupJob=null;});
 }
 return followupResults.get(input.owner);
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
