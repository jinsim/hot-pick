// The caller decides whether external expertise is useful. This is validation, not an LLM or classifier.
export function directDecision(task) {
  const decision=task?.external_help;
  if(decision===undefined)return null;
  if(!decision||typeof decision!=='object'||typeof decision.needed!=='boolean')throw Error('external_help.needed must be boolean');
  if(decision.needed)return null;
  if(typeof decision.reason!=='string'||!decision.reason.trim()||decision.reason.length>2000)throw Error('Direct work requires a concise reason');
  if(!Array.isArray(decision.checks)||!decision.checks.length||decision.checks.length>12||decision.checks.some(x=>typeof x!=='string'||!x.trim()||x.length>1000))throw Error('Direct work requires 1–12 planned checks');
  return {strategy:'direct',reason:decision.reason,planned_checks:decision.checks,trust:'caller_assessment',external_project_used:false};
}
