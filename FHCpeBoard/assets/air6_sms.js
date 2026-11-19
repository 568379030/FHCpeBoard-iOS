/* AIR6 SMS parsing: AT+CMGL text-mode output -> app contract.
 *
 * The firmware answers AT+CMGL="ALL" after AT+CMGF=1,AT+CSCS="UCS2", so every
 * body arrives as UCS2 hex and multipart messages carry an 8-bit concatenation
 * UDH (05 00 03 <ref> <total> <seq>). Pure functions, no DOM/network, so the
 * real capture in test/fixtures/sms-cmgl.txt can drive the tests.
 */
(function(root){
 'use strict';
 const HEADER=/^\+CMGL:\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/;
 const OUTGOING=/SENT|SUBMIT/i;

 function normalizeTime(value){
  const text=String(value||'').trim();
  const match=text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(!match)return text;
  const pad=n=>String(n).padStart(2,'0');
  return match[1]+'-'+pad(match[2])+'-'+pad(match[3])+' '+pad(match[4])+':'+match[5]+':'+pad(match[6]||0);
 }
 function ucs2(hex){
  let out='';
  for(let i=0;i+3<hex.length;i+=4)out+=String.fromCharCode(parseInt(hex.substr(i,4),16));
  return out;
 }
 /* Concatenation UDH: 8-bit ref (IEI 0x00, 3 bytes) or 16-bit ref
    (IEI 0x08, 4 bytes). Anything else is treated as a plain body. */
 function readUdh(hex){
  if(hex.length<14)return null;
  const udhl=parseInt(hex.substr(0,2),16);
  if(!(udhl>=5&&udhl<=20)||(udhl+1)*2>=hex.length)return null;
  let index=2;
  const endIndex=(udhl+1)*2;
  while(index+4<=endIndex){
   const iei=parseInt(hex.substr(index,2),16),len=parseInt(hex.substr(index+2,2),16);
   const body=hex.substr(index+4,len*2);
   if(iei===0x00&&len===3){
    return {ref:parseInt(body.substr(0,2),16),total:parseInt(body.substr(2,2),16),seq:parseInt(body.substr(4,2),16),wide:false,offset:endIndex};
   }
   if(iei===0x08&&len===4){
    return {ref:parseInt(body.substr(0,4),16),total:parseInt(body.substr(4,2),16),seq:parseInt(body.substr(6,2),16),wide:true,offset:endIndex};
   }
   index+=4+len*2;
  }
  return null;
 }
 /* Returns {text, udh:{ref,total,seq,wide}|null, encoding}. */
 function decodeBody(raw){
  const hex=String(raw||'').replace(/\s+/g,'');
  if(!hex||hex.length%4||!/^[0-9A-Fa-f]+$/.test(hex))return {text:String(raw||'').trim(),udh:null,encoding:'text'};
  const udh=readUdh(hex);
  let offset=udh?udh.offset:0;
  let text=ucs2(hex.slice(offset));
  let encoding='ucs2';
  const control=(text.match(/[\u0000-\u0008\u000b\u000e-\u001f]/g)||[]).length;
  if(!text||control>text.length/4){
   /* Not UCS2: fall back to the raw line, never to a best-effort guess. */
   text=String(raw||'').trim();
   encoding='raw';
  }
  return {text,udh,encoding};
 }
 function parse(text){
  const rows=[];
  let current=null;
  for(const line of String(text||'').replace(/\r/g,'').split('\n')){
   const trimmed=line.trim();
   const header=HEADER.exec(trimmed);
   if(header){
    current={index:Number(header[1]),state:header[2],number:header[3],time:normalizeTime(header[5]),body:''};
    rows.push(current);
    continue;
   }
   if(!current||!trimmed||trimmed==='OK')continue;
   if(/^\+CMGL:/.test(trimmed))continue;
   current.body+=trimmed;
  }
  return rows.map(row=>{
   const decoded=decodeBody(row.body);
   return {index:row.index,state:row.state,number:row.number,time:row.time,text:decoded.text,udh:decoded.udh,encoding:decoded.encoding};
  });
 }
 /* Merges concatenated parts and marks direction. Output order follows the
    device storage index, which is also what delete/read need. */
 function group(rows){
  const groups=[],byRef=Object.create(null);
  for(const row of Array.isArray(rows)?rows:[]){
   if(row.udh&&row.udh.total>1){
    const key=(OUTGOING.test(row.state)?'s':'r')+row.udh.ref+'_'+row.udh.total+'_'+(row.udh.wide?'w':'n');
    if(byRef[key]){
     /* The same part can be re-read after a retry; ignore duplicates. */
     if(!byRef[key].parts.some(part=>part.udh.seq===row.udh.seq))byRef[key].parts.push(row);
     continue;
    }
    byRef[key]={parts:[row]};
    groups.push(byRef[key]);
    continue;
   }
   groups.push({parts:[row]});
  }
  return groups.map(entry=>{
   const parts=entry.parts.slice().sort((a,b)=>(a.udh?a.udh.seq:0)-(b.udh?b.udh.seq:0));
   const first=parts[0];
   const total=first.udh&&first.udh.total>1?first.udh.total:1;
   const have=parts.length;
   const text=parts.map(part=>part.text).join('');
   return {
    indexes:parts.map(part=>part.index).sort((a,b)=>a-b),
    outgoing:OUTGOING.test(first.state),
    number:first.number,
    time:first.time,
    text:have<total?text+'…（还缺 '+(total-have)+' 段，内容不完整）':text,
    unread:parts.some(part=>/UNREAD/i.test(part.state)),
    state:first.state,
    parts:have,
    total:total,
    complete:have>=total,
    encoding:first.encoding||'ucs2'
   };
  }).sort((a,b)=>a.indexes[0]-b.indexes[0]);
 }
 function storage(text){
  const match=String(text||'').match(/\+CPMS:\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)/);
  if(!match)return null;
  return {location:match[1],used:Number(match[2]),total:Number(match[3])};
 }
 /* App payloads ------------------------------------------------------- */
 function payload(rows){
  const groups=group(rows),recv=[],send=[],refs=Object.create(null);
  for(const entry of groups){
   const index=(entry.outgoing?'s':'r')+entry.indexes.join('_');
   refs[index]={indexes:entry.indexes};
   if(entry.outgoing)send.push({Index:index,Msg:entry.text,Receiver:entry.number,Sendtime:entry.time});
   else recv.push({Index:index,Msg:entry.text,Sender:entry.number,Recvtime:entry.time,Isopened:entry.unread?'0':'1'});
  }
  return {recv,send,refs,groups};
 }
 const api={parse,group,decodeBody,storage,payload,normalizeTime,HEADER};
 root.Air6Sms=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
