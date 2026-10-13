import {check,LIMITS} from './domain-errors.mjs';
import {extractPdf} from './pdf.mjs';
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
function dimensions(w,h){check(w>0&&h>0&&w*h<=40_000_000,'INVALID_DOCUMENT',422);}
function png(bytes){check(bytes.length>=45&&bytes.subarray(0,8).equals(pngSignature),'INVALID_DOCUMENT',422);let pos=8,header=false,data=false,end=false;while(pos+12<=bytes.length){const size=bytes.readUInt32BE(pos),name=bytes.toString('ascii',pos+4,pos+8);check(size<=bytes.length-pos-12,'INVALID_DOCUMENT',422);if(!header){check(name==='IHDR'&&size===13,'INVALID_DOCUMENT',422);dimensions(bytes.readUInt32BE(pos+8),bytes.readUInt32BE(pos+12));header=true;}if(name==='IDAT')data=true;if(name==='IEND'){check(size===0&&pos+12===bytes.length,'INVALID_DOCUMENT',422);end=true;}pos+=size+12;}check(header&&data&&end&&pos===bytes.length,'INVALID_DOCUMENT',422);}
function jpeg(bytes){
 check(bytes.length>10&&bytes[0]===255&&bytes[1]===216,'INVALID_DOCUMENT',422);
 let pos=2,frame=null,scans=0;const components=new Set();
 while(pos<bytes.length){
  check(bytes[pos++]===255,'INVALID_DOCUMENT',422);while(bytes[pos]===255)pos++;
  check(pos<bytes.length,'INVALID_DOCUMENT',422);const marker=bytes[pos++];
  if(marker===217){check(frame&&scans>0&&pos===bytes.length,'INVALID_DOCUMENT',422);return;}
  check(marker!==0&&marker!==216&&!(marker>=208&&marker<=215)&&pos+2<=bytes.length,'INVALID_DOCUMENT',422);
  const length=bytes.readUInt16BE(pos);check(length>=2&&pos+length<=bytes.length,'INVALID_DOCUMENT',422);
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
   check(!frame&&length>=11,'INVALID_DOCUMENT',422);dimensions(bytes.readUInt16BE(pos+5),bytes.readUInt16BE(pos+3));
   const count=bytes[pos+7];check(count>=1&&count<=4&&length===8+3*count,'INVALID_DOCUMENT',422);
   for(let i=0;i<count;i++){const id=bytes[pos+8+3*i];check(!components.has(id),'INVALID_DOCUMENT',422);components.add(id);}frame=marker;
  }
  if(marker!==218){pos+=length;continue;}
  check(frame&&length>=8,'INVALID_DOCUMENT',422);const count=bytes[pos+2];check(count>=1&&count<=components.size&&length===6+2*count,'INVALID_DOCUMENT',422);
  const scanComponents=new Set();for(let i=0;i<count;i++){const id=bytes[pos+3+2*i],tables=bytes[pos+4+2*i];check(components.has(id)&&!scanComponents.has(id)&&(tables>>4)<=3&&(tables&15)<=3,'INVALID_DOCUMENT',422);scanComponents.add(id);}
  const spectral=pos+3+2*count,ss=bytes[spectral],se=bytes[spectral+1],approx=bytes[spectral+2];
  if(frame===192||frame===193)check(ss===0&&se===63&&approx===0,'INVALID_DOCUMENT',422);
  if(frame===194)check(ss<=se&&se<=63&&(ss!==0||se===0)&&(ss===0||count===1)&&(approx>>4)<=13&&(approx&15)<=13&&((approx>>4)===0||(approx>>4)===(approx&15)+1),'INVALID_DOCUMENT',422);
  pos+=length;let data=0;
  while(pos<bytes.length){
   if(bytes[pos]!==255){data++;pos++;continue;}
   const markerStart=pos;while(bytes[pos]===255)pos++;check(pos<bytes.length,'INVALID_DOCUMENT',422);const next=bytes[pos];
   if(next===0){data++;pos++;continue;}
   if(next>=208&&next<=215){check(data>0,'INVALID_DOCUMENT',422);data=0;pos++;continue;}
   pos=markerStart;break;
  }
  check(data>0,'INVALID_DOCUMENT',422);scans++;
 }
 check(false,'INVALID_DOCUMENT',422);
}
export async function extractDocument(bytes,mediaType,limits={}){
 limits={...LIMITS,...limits};bytes=Buffer.from(bytes);check(bytes.length>0,'INVALID_DOCUMENT',422);check(bytes.length<=limits.uploadBytes,'PAYLOAD_TOO_LARGE',413);
 check(['image/png','image/jpeg','application/pdf','text/plain'].includes(mediaType),'UNSUPPORTED_DOCUMENT',415);
 if(mediaType==='application/pdf')return {...await extractPdf(bytes,limits),media_type:mediaType};
 if(mediaType==='text/plain'){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{check(false,'INVALID_DOCUMENT',422);}check(text.trim()&&!text.includes('\0'),'INVALID_DOCUMENT',422);check(Buffer.byteLength(text)<=limits.textBytes,'PAYLOAD_TOO_LARGE',413);return{bytes,media_type:mediaType,text,pages:[]};}
 (mediaType==='image/png'?png:jpeg)(bytes);return{bytes,media_type:mediaType,text:'',pages:[],requires_transcription:true};
}
