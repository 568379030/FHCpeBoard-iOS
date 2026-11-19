(function(root){
  'use strict';
  const actions=['air6SetBands','air6SetRat','air6SetCell','air6SetCells','air6UnlockCell','air6ConfirmCell'];
  function create(rpc,emit,wait=ms=>new Promise(r=>setTimeout(r,ms)),limit=120){
    const check=r=>{if(r.error||r.code||String(r.status)==='0')throw Error(r.error||r.message||'控制请求失败');return r;};
    async function request(method,args){return check(await rpc('luci.air6modem',method,args));}
    async function follow(r){
      const tid=r.task_id;
      if(!/^[A-Za-z0-9_-]{1,64}$/.test(tid||''))throw Error('设备未返回任务编号，勿重复提交');
      for(let i=0;i<limit;i++){
        const t=await request('get_task',{task_id:tid});
        if(t.task_id!==tid)throw Error('任务编号不匹配');
        if(t.state==='awaiting_confirmation')return emit('air6WriteResult',{ok:false,pending:true,awaiting_confirmation:true,task_id:tid,message:'应用成功，等待确认；超时将自动回退'});
        if(['succeeded','confirmed'].includes(t.state))return emit('air6WriteResult',{ok:true,task_id:tid,message:'任务已成功完成'});
        if(['failed','rolled_back','rollback_failed','superseded'].includes(t.state))throw Error(t.result?.detail?.message||('任务状态：'+t.state));
        await wait(1000);
      }
      return emit('air6WriteResult',{ok:false,pending:true,task_id:tid,message:'任务结果尚未确认，请勿重复提交'});
    }
    return {actions,async write(m){
      if(m.action==='air6ConfirmCell'){
        if(!/^[A-Za-z0-9_-]{1,64}$/.test(m.task_id||''))throw Error('无效任务编号');
        try{await request('confirm_cell',{task_id:m.task_id});}
        catch(e){
          /* A timeout does not prove the confirmation failed: read the task
             back before telling the user anything. Never resend blindly. */
          if(!['TIMEOUT','NETWORK'].includes(e.code))throw e;
          const state=await request('get_task',{task_id:m.task_id});
          if(state.state==='confirmed'||state.state==='succeeded')return emit('air6WriteResult',{ok:true,task_id:m.task_id,message:'确认已生效（请求超时，但设备已记录）'});
          return emit('air6WriteResult',{ok:false,unknown:true,task_id:m.task_id,message:'确认结果未知（'+e.message+'），请刷新任务列表核对'});
        }
        return follow({task_id:m.task_id});
      }
      let method,args;
      if(m.action==='air6SetCell'){
        method='set_cell';args={rat:m.rat,arfcn:Number(m.arfcn),pci:Number(m.pci),band:0};
      }else if(m.action==='air6UnlockCell'){method='clear_cell';args={};}
      else if(m.action==='air6SetRat'){method='set_rat';args={mode:Number(m.rat)};}
      else if(m.action==='air6SetBands'){
        if(m.reset)throw Error('固件 set_bands 一次只接受单一制式，请分别选择 4G/5G 频段后保存');
        const selected=['lte','nr'].filter(k=>String(m[k]||'').trim());
        if(selected.length!==1)throw Error('每次请选择一种制式的频段，待任务完成后再设置另一种');
        const k=selected[0];method='set_bands';args={band_class:k.toUpperCase(),bands:String(m[k]).replace(/[BN]/gi,'').split(/[\s,/]+/).filter(Boolean).map(Number)};
      }else throw Error('固件 set_cell 一次只能锁一个小区，多小区锁定需要设备端支持');
      return follow(await request(method,args));
    }};
  }
  const api={create,actions};root.Air6AdapterTasks=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
