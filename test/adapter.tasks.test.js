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

(async()=>{
 // 确认重复提交：第二次 confirm 由设备拒绝，不得当成成功
 const calls=[];
 const rpc=async(o,m,a)=>{calls.push(m);if(m==='confirm_cell'){if(calls.filter(v=>v==='confirm_cell').length>1)throw Object.assign(Error('已确认过'),{code:'DEVICE_ERROR'});return {status:'1'};}return {status:'1',task_id:'t',state:'confirmed'};};
 const t=create(rpc,()=>{},async()=>{},2);
 await t.write({action:'air6ConfirmCell',task_id:'t'});
 await assert.rejects(()=>t.write({action:'air6ConfirmCell',task_id:'t'}),/已确认过/);

 // 确认超时但任务已确认：回读判定成功，不重发
 const timeoutRpc=async(o,m,a)=>{
  if(m==='confirm_cell')throw Object.assign(Error('设备请求超时'),{code:'TIMEOUT'});
  if(m==='get_task')return {status:'1',task_id:'t',state:'confirmed'};
  return {status:'1'};
 };
 const events=[];
 const t2=create(timeoutRpc,async(n,r)=>events.push(r),async()=>{},2);
 await t2.write({action:'air6ConfirmCell',task_id:'t'});
 assert.equal(events.at(-1).ok,true);
 assert.match(events.at(-1).message,/已记录/);

 // 确认超时且状态未知：报告 unknown，不宣称成功
 const unknownRpc=async(o,m,a)=>{
  if(m==='confirm_cell')throw Object.assign(Error('设备请求超时'),{code:'TIMEOUT'});
  return {status:'1',task_id:'t',state:'awaiting_confirmation'};
 };
 const events2=[];
 const t3=create(unknownRpc,async(n,r)=>events2.push(r),async()=>{},2);
 await t3.write({action:'air6ConfirmCell',task_id:'t'});
 assert.equal(events2.at(-1).unknown,true);
 console.log('PASS adapter duplicate-confirm / timeout-then-verified / unknown');
})().catch(e=>{console.error(e);process.exit(1);});

})().catch(e=>{console.error(e);process.exit(1);});
