// This is diagnostic-only. Core still validates the untouched native arguments.
// Paths are composed exclusively from the approved schema and numeric indexes;
// neither model values nor arbitrary additional-property names become context.
export function argumentDiagnostics(schema,args){
 const escape=s=>s.replaceAll('~','~0').replaceAll('/','~1');
 const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
 const matches=(t,v)=>t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):type(v)===t;
 function walk(s,v,path,depth){
  if(depth>16)return [];
  if(s.$ref)s=schema.$defs[s.$ref.split('/').at(-1)];
  if(!s)return [];
  if(s.oneOf){
   // Prefer an exact schema-owned discriminator (kind/format_version), never
   // a different workflow merely because its payload has fewer errors.
   const selected=v&&typeof v==='object'?s.oneOf.filter(x=>Object.entries(x.properties||{}).some(([name,child])=>Object.hasOwn(child,'const')&&Object.hasOwn(v,name)&&v[name]===child.const)):[];
   const variants=(selected.length?selected:s.oneOf).map(x=>walk(x,v,path,depth+1));return variants.sort((a,b)=>a.length-b.length)[0];
  }
  const types=s.type?[s.type].flat():[];
  if(types.length&&!types.some(t=>matches(t,v)))return [{path:path||'/',expected:types.join(' or '),received:type(v)}];
  const errors=[];
  if(Object.hasOwn(s,'const')&&v!==s.const)errors.push({path:path||'/',rule:'use the declared constant',allowed_values:[s.const]});
  if(s.enum&&!s.enum.includes(v))errors.push({path:path||'/',rule:'use a declared enum value',allowed_values:s.enum});
  if(s.type==='object'){
   if(s.additionalProperties===false&&Object.keys(v).some(name=>!Object.hasOwn(s.properties||{},name)))errors.push({path:path||'/',rule:'forbidden additional field; retain only declared properties',allowed_fields:Object.keys(s.properties||{})});
   for(const name of s.required||[])if(!Object.hasOwn(v,name))errors.push({path:path+'/'+escape(name),rule:'missing required field'});
   for(const [name,child]of Object.entries(s.properties||{}))if(Object.hasOwn(v,name))errors.push(...walk(child,v[name],path+'/'+escape(name),depth+1));
  }else if(s.type==='array'){
   if(s.maxItems!==undefined&&v.length>s.maxItems)errors.push({path:path||'/',rule:'too many items',maximum:s.maxItems});
   for(let i=0;i<Math.min(v.length,100);i++)errors.push(...walk(s.items,v[i],path+'/'+i,depth+1));
  }
  return errors.slice(0,6);
 }
 return walk(schema,args,'',0);
}
