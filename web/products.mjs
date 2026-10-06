const labels={candidate:'검토 후보',selected:'사용자 선택',needs_confirmation:'HQ 확인 필요',excluded:'검토 제외'};
const matches={match:'입력 조건 일치',unknown:'사양 확인 필요',mismatch:'입력 조건 불일치',unfiltered:'사양 조건 미입력'};
export function initProducts({api,message}){
 const el=id=>document.getElementById(id);
 let inquiry=null,generation=0,searchVersion=0;
 const add=(parent,tag,text,className)=>{const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;parent.append(e);return e;};
 function facts(parent,p){
  const source=p.source??{};
  add(parent,'p',`${p.family_rate_gbps??'미확인'}G 제품군 · 실제 aggregate ${p.aggregate_bit_rate_gbps??'미확인'} Gbps · ${p.form_factor??'미확인'} · ${p.application??'미확인'}`);
  add(parent,'p',`${p.fiber_type??'미확인'} / ${p.connector??'미확인'} · ${(p.reach??[]).map(r=>`${r.medium} ${r.min_m}–${r.max_m} m`).join(' · ')||'거리 미확인'}`);
  add(parent,'p',`케이스 동작 온도 ${p.temperature?.min_c??'?'}–${p.temperature?.max_c??'?'} °C · 소비전력 최대 ${p.max_power_dissipation_w??'?'} W · ${p.laser??'Laser 미확인'}`);
  add(parent,'p',`파장: ${(p.wavelengths_nm??[]).map(w=>`${w.lane??''} ${w.min}–${w.max} nm / Typical ${w.typical??'미확인'}${w.nominal_feature?' / Features nominal '+w.nominal_feature+' nm':''}`).join(' · ')||'미확인'}`);
  add(parent,'p',`자료 ${source.file??'미확인'} · ${source.document_no??''} Rev ${source.revision??'?'} · 자료일 ${source.document_date??'?'} · 검토일 ${p.reviewed_on??'?'} (HQ 확정일과 다름)`);
  add(parent,'p','판매 상태·최신본 여부·가격·납기·PLM 담당자·Packing: 미확인. 자료 조건의 일치는 판매 또는 공급 확정이 아닙니다.','section-hint');
  const detail=add(parent,'details','');add(detail,'summary','사양 출처와 추가 정보');
  add(detail,'p',Object.entries(source.evidence??{}).map(([key,value])=>`${key}: ${value}`).join(' · '));
  add(detail,'p',`전원 ${p.supply_v?.min??'?'}–${p.supply_v?.max??'?'} V / Typical ${p.supply_v?.typical??'?'} V · 저전력 최대 ${p.max_low_power_dissipation_w??'?'} W · Digital diagnostics ${p.digital_diagnostics===true?'지원':'미확인'}`);
  add(detail,'p',`원본 SHA256 ${p.source_sha256??'미확인'}`);
 }
 async function history(epoch=generation){
  const iid=inquiry?.id;if(!iid)return;
  try{const data=await api('/api/inquiries/'+iid+'/products');if(epoch!==generation)return;
   const list=el('product-history');list.replaceChildren();
   for(const row of data.links){const item=add(list,'li','');add(item,'strong',`${row.snapshot?.spec?.pn??'P/N 미확인'} · ${labels[row.disposition]??row.disposition}`);add(item,'p',row.reason);add(item,'p',new Date(row.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · 서울 시각');const d=add(item,'details','');add(d,'summary','기록 당시 제품 근거');facts(d,{...row.snapshot?.spec,...row.snapshot});}
   if(!data.links.length)add(list,'li','아직 연결한 후보가 없습니다.');
   message('product-history-message',data.truncated?'최근 1,000개 기록을 표시합니다. 전체 이력은 범위 확장이 필요합니다.':'기록 당시 제품 근거를 보존합니다. 최신 검토 상태는 각 P/N의 가장 위 기록입니다.');
  }catch(e){if(epoch===generation)message('product-history-message',e.message,true);}
 }
 function linkForm(parent,p){
  if(inquiry.status==='closed'){add(parent,'p','종료된 문의에는 후보 기록을 추가할 수 없습니다.','section-hint');return;}
  const form=add(parent,'form','');
  const label=add(form,'label','후보 검토 상태'),select=add(label,'select','');select.className='form-select';
  for(const [v,t]of Object.entries(labels)){const o=add(select,'option',t);o.value=v;}
  const reasonLabel=add(form,'label','선택·검토 근거'),reason=add(reasonLabel,'textarea','');reason.className='form-control';reason.required=true;reason.maxLength=2000;
  const button=add(form,'button','문의에 후보 기록');button.className='btn btn-outline-secondary';
  const status=add(form,'p','','message');status.setAttribute('role','status');
  let requestId=crypto.randomUUID(),pending=false;const epoch=generation,iid=inquiry.id;
  form.addEventListener('submit',async e=>{e.preventDefault();if(pending)return;pending=true;button.disabled=true;status.textContent='저장하고 있습니다.';
   try{await api('/api/inquiries/'+iid+'/products','POST',{id:requestId,product_id:p.id,disposition:select.value,reason:reason.value});if(epoch!==generation)return;requestId=crypto.randomUUID();status.textContent='후보 검토 기록을 저장했습니다.';await history(epoch);}
   catch(e){if(epoch===generation)status.textContent=e.message;}
   finally{pending=false;if(epoch===generation)button.disabled=false;}
  });
 }
 el('product-search-form').addEventListener('submit',async e=>{
  e.preventDefault();const epoch=generation,search=++searchVersion;if(!inquiry)return;
  const params=new URLSearchParams();for(const input of e.currentTarget.elements)if(input.name){if(input.type==='checkbox'){if(input.checked)params.set(input.name,'true');}else if(input.value)params.set(input.name,input.value);}
  el('product-results').replaceChildren();message('product-message','제품 사양을 비교하고 있습니다.');
  try{const data=await api('/api/products?'+params);if(epoch!==generation||search!==searchVersion)return;
   for(const {product:p,match,checks}of data.products){const card=add(el('product-results'),'article','','product-card');add(card,'h3',p.pn);add(card,'strong',matches[match]);add(card,'p',checks.map(c=>`${c.name}: ${matches[c.result]}`).join(' · ')||'사양 필터를 입력해 비교하세요.');facts(card,p);linkForm(card,p);}
   const fit=data.products.filter(p=>p.match==='match').length;
   message('product-message',data.catalogCount===0?'제품 DB가 비어 있습니다. 승인된 가져오기 적용이 필요합니다.':`등록 ${data.catalogCount}개 · 검색 ${data.products.length}개 · 조건 일치 ${fit}개. 불일치·미확인 근거도 함께 표시합니다.`);
  }catch(e){if(epoch===generation&&search===searchVersion)message('product-message',e.message,true);}
 });
 el('product-history-reload').addEventListener('click',()=>history());
 return {bind(i){generation++;inquiry=i;el('product-results').replaceChildren();el('product-history').replaceChildren();message('product-message','검색은 문의 상태를 자동 변경하지 않습니다.');history();},reset(){generation++;inquiry=null;el('product-results').replaceChildren();el('product-history').replaceChildren();el('product-search-form').reset();message('product-message','');message('product-history-message','');}};
}
