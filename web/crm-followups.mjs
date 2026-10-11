// Observe linked conversations without changing confirmed business states.
const HOUR=3600000,SEOUL=9*HOUR;
export function nextFollowupDelay(now){
 const local=new Date(+now+SEOUL),hour=local.getUTCHours();
 const next=new Date(+local);next.setUTCMinutes(0,0,0);
 if(hour<10)next.setUTCHours(10);
 else if(hour<18)next.setUTCHours(hour+1);
 else{next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(10);}
 while([0,6].includes(next.getUTCDay())){next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(10);}
 return +next-SEOUL-(+now);
}
export function followupWindow(now){
 const local=new Date(+now+SEOUL),hour=local.getUTCHours();
 return ![0,6].includes(local.getUTCDay())&&hour>=10&&(hour<18||(hour===18&&local.getUTCMinutes()===0));
}
export function initFollowups({root,api,isConnected,open,label=()=>'',schedule=setTimeout,cancel=clearTimeout,now=()=>new Date(),onChecked=()=>{}}){
 let epoch=0,timer=null,busy=false,lastChecked=null;
 const make=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const heading=make('h2','후속 메일 확인'),status=make('p','CRM 계정을 연결하면 받은·보낸 메일을 함께 확인합니다.');
 const hint=make('p','한국 시간 평일 10:00~18:00 매 정각 자동 확인 · 수동 확인은 언제든 가능 · CRM 연결·탭 유지 및 Outlook 실행 필요');
 const button=make('button','지금 메일 확인');button.type='button';button.className='btn btn-outline-primary btn-sm';button.disabled=true;
 const list=document.createElement('ul');root.append(heading,status,button,hint,list);
 const stopTimer=()=>{if(timer!==null)cancel(timer);timer=null;};
 function render(data){
  list.replaceChildren();
  if(data.error){status.textContent=data.error+' 자동 확인을 중지했습니다.';status.classList.add('error');return;}
  status.classList.remove('error');
  if(data.skipped==='outlook_not_running'){status.textContent='Outlook이 실행되지 않아 이번 확인을 건너뛰었습니다. 다음 평일 정각에 다시 확인합니다.';return;}
  if(data.running){status.textContent='Outlook에서 받은·보낸 후속 메일을 확인하고 있습니다.';return;}
  if(!data.ready){status.textContent='아직 확인하지 않았습니다. Outlook이 실행 중이어야 합니다.';return;}
  const changes=(data.updates||[]).filter(row=>row.later_sent||row.later_received);
  const time=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(data.last_checked_at));
  status.textContent=`마지막 확인 ${time} · ${changes.length?changes.length+'개 업무에 후속 메일 — 내용 확인 필요':'새로 검토할 후속 메일 없음'}`;
  for(const row of changes){
   const li=document.createElement('li'),link=make('button',label(row.mail_id)||'연결 업무 확인');link.type='button';link.addEventListener('click',()=>open(row.inquiry_id));
   li.append(link,make('p',`받은 메일 ${row.later_received} · 보낸 메일 ${row.later_sent} · 기존 처리 상태 유지`));list.append(li);
   if(row.proposal?.next_action)li.append(make('p',row.proposal.next_action));
  }
  if((data.updates||[]).some(row=>row.conversation_missing))list.append(make('li','대화 식별자가 없는 업무는 자동 대조에서 제외됐습니다.'));
 }
 const arm=()=>{timer=schedule(()=>void check(),nextFollowupDelay(now()));};
 async function check(refresh=true,manual=false){
  if(busy||!isConnected())return;stopTimer();
  if(refresh&&!manual&&!followupWindow(now())){arm();return;}
  busy=true;button.disabled=true;const active=epoch;
  try{
   const data=await api('/api/followups',refresh?'POST':'GET',refresh?{operation:'refresh'}:undefined);
   if(active!==epoch||!isConnected())return;render(data);
   if(!data.error&&!data.running&&data.skipped!=='outlook_not_running'&&data.last_checked_at){if(lastChecked!==data.last_checked_at)await onChecked();lastChecked=data.last_checked_at;}
   if(active!==epoch||!isConnected())return;
   if(!data.error){if(data.running)timer=schedule(()=>void check(false),4000);else arm();}
  }catch(error){if(active===epoch&&isConnected()){status.textContent=error.message+' 자동 확인을 중지했습니다.';status.classList.add('error');}}
  finally{if(active===epoch){busy=false;button.disabled=!isConnected();}}
 }
 button.addEventListener('click',()=>void check(true,true));
 return {start(){epoch++;busy=false;stopTimer();button.disabled=false;void check(false);},stop(){epoch++;busy=false;stopTimer();button.disabled=true;list.replaceChildren();status.classList.remove('error');status.textContent='CRM 계정을 연결하면 받은·보낸 메일을 함께 확인합니다.';}};
}
