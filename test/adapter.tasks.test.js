'use strict';
const assert=require('assert');
const {create}=require('../FHCpeBoard/assets/adapter_tasks');
(async()=>{
 const calls=[],events=[];let state='running';
 const rpc=async(o,m,a)=>{calls.push({o,m,a});if(m==='set_cell')return {status:'1',task_id:'original'};if(m==='confirm_cell'){assert.deepEqual(a,{task_id:'original'});state='confirmed';return {status:'1'};}return {status:'1',task_id:'original',state};};
 const t=create(rpc,async(n,r)=>events.push(r),async()=>{state='awaiting_confirmation';},3);
 await t.write({action:'air6SetCell',rat:'lte',arfcn:1400,pci:101});
 assert.equal(events.at(-1).awaiting_confirmation,true);
 await t.write({action:'air6ConfirmCell',task_id:'original'});
 assert.equal(events.at(-1).ok,true);
 assert.equal(calls.filter(c=>c.m==='set_cell').length,1);
 assert.equal(calls.filter(c=>c.m==='confirm_cell').length,1);
 const bad=create(async()=>({status:'1',task_id:'different',state:'succeeded'}),()=>{},async()=>{},1);
 await assert.rejects(()=>bad.write({action:'air6ConfirmCell',task_id:'original'}),/不匹配/);
 const pending=[];const p=create(async()=>({status:'1',task_id:'original',state:'running'}),async(n,r)=>pending.push(r),async()=>{},1);
 await p.write({action:'air6SetCell'});assert.equal(pending[0].ok,false);assert.equal(pending[0].pending,true);
 console.log('PASS adapter apply/await/confirm original ID; mismatch rejected; pending is not success');
})().catch(e=>{console.error(e);process.exit(1);});
