import {actionBucket} from './basic-work.mjs';
export function dashboardSummary(data,now) {
  const counts={today:0,overdue:0,waiting:0};
  for(const action of data.actions){const bucket=actionBucket(action,now);if(bucket==='today'||bucket==='overdue')counts[bucket]++;}
  counts.waiting=data.inquiries.filter(i=>['waiting_for_hq','waiting_for_customer'].includes(i.status)).length;
  return counts;
}
