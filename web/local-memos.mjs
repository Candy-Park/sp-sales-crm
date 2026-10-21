export function initMemos({quickRoot,pageRoot,api,autoload=true,cloud=false,onChanged=()=>{}}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 let items=[],category='all',completed=false,busy=false,sequence=0,epoch=0,uncertain=false;
 const status=el('p','','message');status.setAttribute('role','status');pageRoot.append(el('h1','메모'),el('p',cloud?'계정에 저장됩니다. PC가 꺼져도 개인 메모와 업무 메모를 관리할 수 있습니다.':'이 PC에 저장됩니다. 개인 메모와 업무 메모를 함께 관리하세요.','section-hint'));
 const editor=el('section',null,'task-panel'),list=el('div',null,'memo-list'),controls=el('div',null,'memo-controls');pageRoot.append(editor,controls,status,list);
 const contexts=[];
 function form(root,prefix,title){
  root.append(el('h2',title));const f=el('form',null,'memo-form'),text=el('textarea'),select=el('select'),date=el('input');
  text.id=prefix+'-content';text.rows=3;text.maxLength=10000;text.required=true;text.placeholder='전화할 곳, 확인할 내용, 잊지 않을 일을 적어주세요.';
  select.id=prefix+'-category';for(const [value,label] of [['personal','개인'],['work','업무']]){const o=el('option',label);o.value=value;select.append(o);}
  date.id=prefix+'-date';date.type='date';
  const label=el('label','메모 내용');label.htmlFor=text.id;f.append(label,text);
  const grid=el('div',null,'memo-fields');for(const [control,title] of [[select,'구분'],[date,'기한 (선택)']]){const label=el('label',title);label.htmlFor=control.id;const wrap=el('div');wrap.append(label,control);grid.append(wrap);}f.append(grid);
  const error=el('p','','message');error.setAttribute('role','status');const save=el('button','저장','btn btn-primary'),cancel=el('button','수정 취소','btn btn-outline-secondary');save.type='submit';cancel.type='button';cancel.hidden=true;f.append(error,save,cancel);root.append(f);
  const ctx={f,text,select,date,error,cancel,save,editing:null,request:null};contexts.push(ctx);
  const reset=()=>{ctx.editing=null;ctx.request=null;text.value='';select.value='personal';date.value='';cancel.hidden=true;save.textContent='저장';error.textContent='';error.classList.remove('error');};ctx.reset=reset;
  cancel.addEventListener('click',()=>{if(!busy)reset();});
  f.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;const input={content:text.value.trim(),category:select.value,dueDate:date.value||null};if(!input.content){error.textContent='메모 내용을 입력하세요.';return;}
   const payload=JSON.stringify({id:ctx.editing?.id,revision:ctx.editing?.revision,input});if(ctx.request?.payload!==payload)ctx.request={payload,id:crypto.randomUUID()};setBusy(true);error.classList.remove('error');error.textContent='저장 중…';
   const active=epoch;
   try{const data=ctx.editing?await api('/api/memos/'+ctx.editing.id,'PATCH',{requestId:ctx.request.id,revision:ctx.editing.revision,patch:input}):await api('/api/memos','POST',{requestId:ctx.request.id,input});if(active!==epoch)return;replace(data.memo);reset();error.textContent='저장했습니다.';}
   catch(e){if(active===epoch){error.textContent=e.message||'저장하지 못했습니다. 입력은 유지됩니다.';error.classList.add('error');}}
   finally{if(active===epoch)setBusy(false);}
  });return ctx;
 }
 const quick=form(quickRoot,'memo-quick','빠른 메모'),full=form(editor,'memo-editor','메모 작성');
 function setBusy(value){busy=value;for(const ctx of contexts)for(const control of ctx.f.querySelectorAll('textarea,input,select,button'))control.disabled=value||uncertain;for(const control of list.querySelectorAll('input,button'))control.disabled=value||uncertain;}
 function replace(memo){sequence++;items=[memo,...items.filter(m=>m.id!==memo.id)];render();}
 function edit(memo){if(busy||uncertain)return;full.editing=memo;full.request=null;full.text.value=memo.content;full.select.value=memo.category;full.date.value=memo.dueDate||'';full.cancel.hidden=false;full.save.textContent='수정 저장';full.error.textContent='';full.text.focus();editor.scrollIntoView?.({block:'start',behavior:'smooth'});}
 async function toggle(memo){if(busy||uncertain)return;const active=epoch;setBusy(true);status.textContent='저장 중…';try{const {memo:saved}=await api('/api/memos/'+memo.id,'PATCH',{requestId:crypto.randomUUID(),revision:memo.revision,patch:{completed:!memo.completedAt}});if(active!==epoch)return;replace(saved);status.textContent=saved.completedAt?'완료 기록에 보관했습니다.':'미완료로 되돌렸습니다.';}catch(e){if(active===epoch){uncertain=true;status.textContent='결과 미확인. 서버 재조회 중…';const ok=await load();if(active!==epoch)return;status.textContent=ok?'저장 결과를 서버에서 다시 확인했습니다.': '결과 미확인. 새로고침으로 확인한 뒤 다시 조작하세요.';render();}}finally{if(active===epoch)setBusy(false);}}
 function filterButton(text,value,kind){const button=el('button',text,'btn btn-outline-secondary');button.type='button';button.addEventListener('click',()=>{if(kind==='category')category=value;else completed=value;render();});button.dataset.kind=kind;button.dataset.value=String(value);controls.append(button);}
 for(const [value,label] of [['all','전체'],['personal','개인'],['work','업무']])filterButton(label,value,'category');filterButton('미완료',false,'completed');filterButton('완료',true,'completed');const refresh=el('button','새로고침','btn btn-outline-secondary');refresh.type='button';refresh.addEventListener('click',load);controls.append(refresh);
 function render(){
  onChanged(structuredClone(items));
  list.replaceChildren();for(const button of controls.querySelectorAll('[data-kind]'))button.setAttribute('aria-pressed',String(button.dataset.kind==='category'?category===button.dataset.value:String(completed)===button.dataset.value));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const visible=items.filter(m=>(category==='all'||m.category===category)&&Boolean(m.completedAt)===completed).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(!visible.length)list.append(el('p',completed?'완료한 메모가 없습니다.':'미완료 메모가 없습니다.','section-hint'));
  for(const memo of visible){const card=el('article',null,'task-panel memo-card'),label=el('label'),check=el('input');check.type='checkbox';check.checked=Boolean(memo.completedAt);check.disabled=busy||uncertain;check.setAttribute('aria-label',memo.completedAt?'완료 취소':'완료 체크');check.addEventListener('change',()=>toggle(memo));label.append(check,el('span',memo.content));card.append(label,el('p',`${memo.category==='personal'?'개인':'업무'} · 기한 ${memo.dueDate||'없음'}${!memo.completedAt&&memo.dueDate&&memo.dueDate<today?' · 기한 지남':''}`,'section-hint'));const modify=el('button','수정','btn btn-outline-secondary');modify.type='button';modify.disabled=busy||uncertain;modify.addEventListener('click',()=>edit(memo));card.append(modify);
   if(cloud&&memo.origin){const source=el('details'),info=el('pre',memo.origin.snapshot);source.append(el('summary','가져온 메모 · 원본 정보'),el('p',`가져온 시점 ${memo.origin.capturedAt} · 원본 ${memo.origin.id} · 이후 B 변경은 자동 반영하지 않습니다.`,'section-hint'),info);info.style&&(info.style.whiteSpace='pre-wrap');info.style&&(info.style.overflowWrap='anywhere');card.append(source);}
   list.append(card);}
 }
 async function load(){const active=++sequence;status.textContent='메모 불러오는 중…';try{const data=await api('/api/memos');if(active!==sequence)return false;items=data.memos;uncertain=false;render();setBusy(busy);status.textContent='';return true;}catch(e){if(active===sequence)status.textContent=e.message||'메모를 불러오지 못했습니다.';return false;}}
 function reset(){epoch++;sequence++;items=[];uncertain=false;onChanged([]);category='all';completed=false;for(const ctx of contexts)ctx.reset();setBusy(false);list.replaceChildren();status.textContent='';}
 if(autoload)void load();return {load,reset,open(id){const memo=items.find(m=>m.id===id);if(memo){category='all';completed=Boolean(memo.completedAt);render();edit(memo);}},async toggle(id){if(uncertain)throw Error('결과 미확인. 메모에서 새로고침하세요.');if(busy)throw Error('저장 결과 확인 중입니다.');const memo=items.find(m=>m.id===id);if(memo){await toggle(memo);if(uncertain)throw Error('결과 미확인. 메모에서 새로고침하세요.');}},hasDraft:()=>contexts.some(c=>c.text.value.trim()),quick};
}
