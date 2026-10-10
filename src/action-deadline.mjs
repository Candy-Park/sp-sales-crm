const DAY=86400000;
function today(now){
 if(!(now instanceof Date)||!Number.isFinite(+now))throw Error('날짜를 확인하세요.');
 return new Date(+now+9*3600000).toISOString().slice(0,10);
}
function add(value){
 const d=new Date(value+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)throw Error('기한을 확인하세요.');
 return new Date(+d+3*DAY).toISOString().slice(0,10);
}
export function defaultActionDue(now=new Date()){return add(today(now));}
export function extendActionDue(value,now=new Date()){
 const date=today(now);if(value)add(value);
 return add(value&&value>date?value:date);
}
