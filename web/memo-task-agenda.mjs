export function initMemoTaskAgenda({root,onOpen,onToggle}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 let items=[],busy=false,epoch=0;
 const list=el('div'),status=el('p','','message');status.setAttribute('role','status');root.append(el('h2','독립 할 일'),el('p','문의와 별도로 관리하는 메모 할 일입니다.','section-hint'),status,list);
 function render(){list.replaceChildren();const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),tasks=[...new Map(items.filter(m=>m.homeTask&&!m.completedAt).map(m=>[m.id,m])).values()];
  if(!tasks.length)list.append(el('p','미완료 독립 할 일이 없습니다.','section-hint'));
  for(const m of tasks){const row=el('article',null,'memo-card'),check=el('input'),open=el('button',m.content,'btn btn-outline-secondary');row.dataset.key='memo:'+m.id;check.type='checkbox';check.checked=false;check.disabled=busy;check.setAttribute('aria-label',m.content+' 완료 체크');open.type='button';open.disabled=busy;open.addEventListener('click',()=>onOpen(m.id));check.addEventListener('change',async()=>{if(busy)return;const active=epoch;busy=true;status.textContent='저장 결과 확인 중…';render();try{await onToggle(m.id);if(active===epoch)status.textContent='';}catch(e){if(active===epoch)status.textContent=e.message||'결과 미확인. 메모에서 새로고침하세요.';}finally{if(active===epoch){busy=false;render();}}});row.append(check,open,el('p',m.dueDate?`${m.dueDate} · ${m.dueDate<today?'기한 지남':m.dueDate===today?'오늘':'예정'}`:'기한 없음','section-hint'));list.append(row);}
 }
 function reset(){epoch++;items=[];busy=false;status.textContent='';render();}
 return {setItems(value){items=structuredClone(value);render();},reset};
}
