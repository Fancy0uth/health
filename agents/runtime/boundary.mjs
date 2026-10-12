export const TOOL_NAMES=Object.freeze(['healththread_read_source','healththread_retrieve_context','healththread_stage_candidates','healththread_get_confirmed_instructions','healththread_stage_result']);
export function runtimeError(code) { return Object.assign(new Error(code),{code,publicMessage:code}); }
export function assertTools(names) {
  if (!Array.isArray(names)||names.length!==TOOL_NAMES.length||new Set(names).size!==names.length||TOOL_NAMES.some(name=>!names.includes(name))) throw runtimeError('AGH_TOOL_BOUNDARY');
}
export function assertAgnes(configuration) {
  const p=configuration?.provider;
  if (!configuration?.configured||!p?.credentialConfigured) throw runtimeError('AGENT_NOT_CONFIGURED');
  if (p.id!=='agnes-ai'||!p.route||!p.model) throw runtimeError('AGNES_PROVIDER_REQUIRED');
  return Object.freeze({provider:p.id,route:p.route,model:p.model});
}
export function createBindings() {
  const records=new Map();
  const lookup=key=>{const entry=records.get(key); if(!entry||entry.revoked) throw runtimeError('AGH_SCOPE_INVALID'); entry.signal?.throwIfAborted(); entry.check?.(); if(entry.repairs>2) throw runtimeError('AGH_REPAIR_LIMIT'); return entry;};
  const context=ctx=>{if(ctx.session?.depth!==0||ctx.session?.generationDepth!==0) throw runtimeError('AGH_SCOPE_INVALID'); const entry=lookup(ctx.session?.key);if(entry.finalizationOnly)throw runtimeError('AGH_FINALIZATION_ONLY');return entry;};
  const reject=(key,reason)=>{const entry=lookup(key); if(entry.rejections.has(reason)) return; entry.rejections.add(reason); if(entry.repairs>=2){entry.repairs=3; entry.revoked=true; throw runtimeError('AGH_REPAIR_LIMIT');} entry.repair?.(reason); entry.repairs++;};
  return Object.freeze({lookup,context,reject,
    finalize(key){lookup(key).finalizationOnly=true;},
    reserve(key,entry){if(records.has(key))throw runtimeError('AGH_SCOPE_DUPLICATE'); records.set(key,{...entry,repairs:0,rejections:new Set(),invocations:[]});},
    revoke(key){const entry=records.get(key); if(entry)entry.revoked=true;},
    remove(key){records.delete(key);},
    async execute(name,args,ctx){const entry=context(ctx); if(!TOOL_NAMES.includes(name)||typeof entry.tools[name]!=='function')throw runtimeError('AGH_SCOPE_INVALID'); const result=await entry.tools[name](args,{session_key:ctx.session.key,tool_use_id:ctx.session.toolUseId}); entry.invocations.push({name,args:structuredClone(args),toolUseId:ctx.session.toolUseId,receipt:result.receipt}); return result;},
  });
}
