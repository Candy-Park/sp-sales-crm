import {id} from './write-input.mjs';
const fields=['q','rate_gbps','form_factor','medium','reach_m','min_c','max_c','wavelength_nm','packing'];
export function productQuery(params){
 const out={};
 for(const [key,value] of params){
  if(!fields.includes(key)||key in out)throw new Error('제품 검색 조건을 확인해주세요.');
  if(key==='packing'){if(!['true','false'].includes(value))throw new Error('Packing 조건을 확인해주세요.');out.packing=value==='true';}
  else if(['q','form_factor','medium'].includes(key)){
   if(!value.trim()||value.length>100)throw new Error('검색어를 확인해주세요.');out[key]=value.trim();
   if(key==='medium'&&!['SMF','OM3','OM4'].includes(value))throw new Error('매체를 선택해주세요.');
  }else{
   if(!/^-?\d+(\.\d+)?$/.test(value))throw new Error('검색 수치와 단위를 확인해주세요.');
   out[key]=Number(value);
   if(!Number.isFinite(out[key])||Math.abs(out[key])>1e7||(!['min_c','max_c'].includes(key)&&out[key]<=0))throw new Error('검색 범위를 확인해주세요.');
  }
 }
 if(out.reach_m!==undefined&&!out.medium)throw new Error('거리 조건에는 매체 선택이 필요합니다.');
 if((out.min_c===undefined)!==(out.max_c===undefined)||(out.min_c!==undefined&&out.min_c>out.max_c))throw new Error('동작 온도 최저/최고를 함께 확인해주세요.');
 return out;
}
export function searchProducts(products,query){
 return products.filter(p=>!query.q||[p.pn,p.name,p.application].join(' ').toLowerCase().includes(query.q.toLowerCase())).map(product=>{
  const checks=[];
  const check=(name,known,fits)=>checks.push({name,result:!known?'unknown':fits?'match':'mismatch'});
  for(const [input,key,label] of [['rate_gbps','family_rate_gbps','제품군 속도'],['form_factor','form_factor','Form Factor']])if(query[input]!==undefined)check(label,product[key]!==undefined,typeof query[input]==='string'?String(product[key]).toLowerCase()===query[input].toLowerCase():product[key]===query[input]);
  if(query.medium){
   const reach=Array.isArray(product.reach)?product.reach:null;
   const selected=reach?.filter(r=>r.medium===query.medium);
   check('매체',Boolean(reach?.length),Boolean(selected?.length));
   if(query.reach_m!==undefined)check('거리',Boolean(reach?.length)&&(!selected?.length||selected.every(r=>Number.isFinite(r.min_m)&&Number.isFinite(r.max_m))),Boolean(selected?.some(r=>r.min_m<=query.reach_m&&r.max_m>=query.reach_m)));
  }
  if(query.min_c!==undefined){const t=product.temperature;check('케이스 동작 온도',t?.basis==='case_operating'&&Number.isFinite(t.min_c)&&Number.isFinite(t.max_c),t?.min_c<=query.min_c&&t?.max_c>=query.max_c);}
  if(query.wavelength_nm!==undefined){const waves=product.wavelengths_nm;check('출력 파장 범위',Array.isArray(waves)&&waves.length>0&&waves.every(w=>Number.isFinite(w.min)&&Number.isFinite(w.max)),waves?.some(w=>w.min<=query.wavelength_nm&&w.max>=query.wavelength_nm));}
  if(query.packing)check('Packing 자료',product.packing_specification_status==='verified',true);
  return {product,match:!checks.length?'unfiltered':checks.some(c=>c.result==='mismatch')?'mismatch':checks.some(c=>c.result==='unknown')?'unknown':'match',checks};
 }).sort((a,b)=>['match','unknown','unfiltered','mismatch'].indexOf(a.match)-['match','unknown','unfiltered','mismatch'].indexOf(b.match));
}
export function linkInput(data){
 if(!data||Array.isArray(data)||Object.keys(data).some(k=>!['id','product_id','disposition','reason'].includes(k)))throw new Error('허용되지 않은 후보 입력입니다.');
 if(!['candidate','selected','needs_confirmation','excluded'].includes(data.disposition))throw new Error('후보 검토 상태를 선택해주세요.');
 if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>2000)throw new Error('선택·검토 근거를 입력해주세요.');
 return {id:id(data.id),product_id:id(data.product_id),disposition:data.disposition,reason:data.reason};
}
