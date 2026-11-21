export function health(index, runs, now=Date.now(), maxAgeMinutes=120) {
 const age=(now-Date.parse(index?.updated_at))/60000;
 const problems=[];
 if(!Number.isFinite(age)||age< -5) problems.push('Catalog timestamp missing or invalid');
 else if(age>maxAgeMinutes) problems.push(`Catalog is ${Math.round(age)} minutes old (limit ${maxAgeMinutes})`);
 if(!index?.cards||!Object.keys(index.cards).length) problems.push('Catalog is empty');
 const latest=runs.find(r=>r.status==='completed');
 if(!latest)problems.push('No completed collector run observed');
 if(latest&&latest.conclusion!=='success') problems.push(`Latest completed collector ${latest.id}: ${latest.conclusion}`);
 return {healthy:!problems.length,problems,updated_at:index?.updated_at??null,age_minutes:Number.isFinite(age)?Math.round(age):null,cards:Object.keys(index?.cards||{}).length};
}
export function parseFeedback(body) {
 const raw=body?.match(/```json\s*([\s\S]*?)```/)?.[1]; if(!raw)return null;
 try {const p=JSON.parse(raw);
 if(p.schema!==1||p.consent_public!==true||p.purpose!=='real_task'||!/^[-a-f0-9]{36}$/.test(p.task_id)||
 !['improved','same','worse','unknown'].includes(p.helpfulness)||!['completed','failed','abandoned'].includes(p.outcome)||
 !['self_report','local_receipt'].includes(p.evidence)||!Number.isInteger(p.checks_passed)||p.checks_passed<0||p.checks_passed>10000||
 !Number.isInteger(p.checks_total)||p.checks_total<p.checks_passed||p.checks_total>10000)return null;
 return p;
 }catch{return null;}
}
export function usage(issues, excluded=['jinsim']) {
 const seen=new Set(),users=new Set(),counts={reports:0,completed:0,failed:0,abandoned:0,improved:0,same:0,worse:0,unknown:0,receipt_backed:0,excluded:0};
 for(const issue of issues){if(!issue.title?.startsWith('[Usage]'))continue;
 const actor=issue.user;const p=parseFeedback(issue.body);
 if(!p||!actor||actor.type!=='User'||excluded.includes(actor.login.toLowerCase())||/\[bot\]$/i.test(actor.login)||issue.labels?.some(l=>['monitor-test','internal-test'].includes(l.name))){counts.excluded++;continue;}
 const key=actor.login.toLowerCase()+':'+p.task_id;if(seen.has(key)){counts.excluded++;continue;}seen.add(key);users.add(actor.login.toLowerCase());
 counts.reports++;counts[p.outcome]++;counts[p.helpfulness]++;if(p.evidence==='local_receipt')counts.receipt_backed++;
 }
 return {...counts,external_reporting_accounts:users.size,qualification:'Opt-in self-reports, not all users or independently verified people/quality. Receipt-backed means client-reported checks, not remote attestation.'};
}
export function credentialWarning(expiresOn, now=Date.now()) {
 const expiry=Date.parse(expiresOn+'T00:00:00Z');
 if(!/^\d{4}-\d\d-\d\d$/.test(expiresOn||'')||!Number.isFinite(expiry))return 'External scheduler credential expiry metadata is invalid';
 const days=Math.floor((expiry-now)/86400000);
 if(days>14)return null;
 return days<0?`External scheduler credential expired on ${expiresOn}; rotate it`:`External scheduler credential expires on ${expiresOn} (in ${days} days); rotate it before expiry`;
}
