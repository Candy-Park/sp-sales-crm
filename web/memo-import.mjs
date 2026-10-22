import {validateMemoImport} from '../src/memo-import.mjs';
export function initMemoImport({root,api,getUser,selection=null,onImported=async()=>{}}){
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const details=el('details'),summary=el('summary','선별 메모 보존·연결'),preview=el('div'),status=el('p'),save=el('button','3건 보존·연결');status.setAttribute('role','status');save.type='button';save.className='btn btn-primary';save.disabled=true;
 details.append(summary,el('p','준비된 선택 목록과 원본 JSON을 사용합니다. B 원본은 변경하지 않으며 가져온 시점의 복사본을 보존합니다.'));
 let epoch=0,records=null,manifest=null,chosen=selection,busy=false,reading=0;
 const files=[];function picker(label,handler){const wrap=el('label',label),input=el('input');input.type='file';input.accept='.json,application/json';wrap.append(input);details.append(wrap);files.push(input);input.addEventListener('change',async()=>{const active=epoch,seq=++reading;records=null;manifest=null;save.disabled=true;preview.replaceChildren();status.textContent='';const file=input.files?.[0];if(!file)return;try{if(file.size>100000)throw Error('JSON 파일 크기를 확인하세요.');const data=JSON.parse(await file.text());if(active!==epoch||seq!==reading)return;await handler(data,active,seq);}catch(e){if(active===epoch&&seq===reading)status.textContent=e.message;}});return input;}
 if(!selection)picker('선택 목록 JSON',async data=>{chosen=data;status.textContent='선택 목록을 읽었습니다. 원본 메모 JSON을 선택하세요.';});
 picker('원본 메모 JSON',async(data,active,seq)=>{const user=getUser();if(!user||chosen?.expected_target_project_ref!==user.projectRef)throw Error('대상 CRM 계정과 프로젝트를 확인하세요.');const validated=await validateMemoImport(data,chosen,user.id);if(active!==epoch||seq!==reading)return;records=validated;manifest=data;preview.append(el('p',`대상 계정 ${user.email||user.id} · ${data.targetProjectRef}`));for(const r of records)preview.append(el('p',`${r.category==='personal'?'개인':'업무'} · 기한 없음${r.homeTask?' · 독립 할 일':''} · ${r.content} · 원본 ${r.origin.id} / revision ${r.origin.revision}`));save.disabled=false;});
 details.append(preview,status,save);root.append(details);
 save.addEventListener('click',async()=>{if(busy||!records)return;const active=epoch,user=getUser();if(!user)return;busy=true;save.disabled=true;for(const f of files)f.disabled=true;status.textContent='';
  try{const input=await validateMemoImport(manifest,chosen,user.id);if(active!==epoch)return;
   for(let i=0;i<input.length;i++){if(active!==epoch||getUser()?.id!==user.id)return;await api('/api/memos','POST',{requestId:crypto.randomUUID(),input:input[i]});if(active!==epoch)return;status.textContent=`${i+1}/3 저장 응답 확인. 전체 연결 대조 중…`;}
   const {memos}=await api('/api/memos');if(active!==epoch)return;
   for(const r of input){const matches=memos.filter(m=>m.origin?.projectRef===r.origin.projectRef&&m.origin?.ownerId===r.origin.ownerId&&m.origin?.entity===r.origin.entity&&m.origin?.id===r.origin.id);if(matches.length!==1||matches[0].origin.sha256!==r.origin.sha256||matches[0].origin.snapshot!==r.origin.snapshot||matches[0].homeTask!==r.homeTask)throw Error('최종 원본 매핑을 확인하지 못했습니다. 다시 확인하세요.');}
   await onImported();if(active===epoch)status.textContent='3건 연결 확인. 같은 파일로 다시 실행해도 중복 생성하지 않습니다.';
  }catch(e){if(active===epoch)status.textContent=`${status.textContent} ${e.message||'결과 미확인'}. 성공한 항목을 보존했습니다. 같은 파일로 재시도할 수 있습니다.`;}
  finally{if(active===epoch){busy=false;save.disabled=!records;for(const f of files)f.disabled=false;}}
 });
 function reset(){epoch++;reading++;records=null;manifest=null;chosen=selection;busy=false;for(const f of files){f.value='';f.disabled=false;}preview.replaceChildren();status.textContent='';save.disabled=true;details.open=false;}
 return {reset};
}
