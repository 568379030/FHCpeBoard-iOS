(function(root){
 'use strict';
 const Tasks=typeof module!=='undefined'?require('./adapter_tasks'):root.Air6AdapterTasks;
 const error=(s,c)=>Object.assign(Error(s),c?{code:c}:{});
 async function detect(o){try{const r=await o.fetch(o.host+'/cgi-bin/luci/',{timeoutMs:8000});return /luci|qwrt|openwrt/i.test(await r.text());}catch(_){return false;}}
 function create(o){
  let session='',sequence=0,requestId;
  const emit=(name,value)=>o.evalJS?o.evalJS('window.'+name+'&&window.'+name+'('+JSON.stringify({...value,requestId}).replace(/</g,'\\u003c')+')'):Promise.resolve();
  async function rpc(object,method,args={},anonymous=false){
   if(o.isActive&&!o.isActive())throw error('旧设备会话已取消','STALE');
   if(!anonymous&&!session)throw error('请先登录设备','SESSION_EXPIRED');
   const id=++sequence;
   const r=await o.fetch(o.host+'/ubus/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:'call',params:[anonymous?'00000000000000000000000000000000':session,object,method,args]}),timeoutMs:15000});
   if(!r.ok)throw error('设备请求失败（HTTP '+r.status+'）','NETWORK');
   const v=JSON.parse(await r.text());
   if(v.id!==id||v.error||v.result?.[0]!==0)throw error('设备接口失败：'+object+'.'+method,(v.result?.[0]===6?'AUTH_REJECTED':undefined));
   const data=v.result[1]||{};if(data.error||Number(data.code)>0||String(data.status)==='0')throw error(data.error||data.message||'设备拒绝请求');return data;
  }
  const call=(m,a)=>rpc('luci.air6modem',m,a),tasks=Tasks.create(rpc,emit);
  async function sample(){
   const s=await call('get_status');if(s.initializing||!s.available)throw error(s.error||'设备状态采集中，请稍后重试','NETWORK');
   const carriers=Array.isArray(s.carriers)?s.carriers:[];
   const val=v=>v==null||v===''?'--':v;
   return {deviceOnline:true,deviceName:'SoftBank',deviceModel:'Air6',operator:val(s.operator),mode:val(s.rat),swVersion:'QWRT / AIR6 v4.2',imei:val(s.imei),imsi:val(s.imsi),iccid:val(s.iccid),wanIp:val(s.network?.['ipv4-address']?.[0]?.address),carriers,allCells:carriers,bandTag:val(s.band),pci:val(s.pci),pccArfcn:val(s.arfcn),modemTemp:val(s.temperature),rsrp:val(carriers[0]?.rsrp),rsrq:val(carriers[0]?.rsrq),sinr:val(carriers[0]?.sinr),updateTime:new Date().toLocaleString(),downSpeed:'--',upSpeed:'--'};
  }
  return {
   async connect(user,password){
    const r=await rpc('session','login',{username:user,password,timeout:300},true);
    if(!/^[a-f0-9]{32}$/i.test(r.ubus_rpc_session||''))throw error('用户名或密码错误','AUTH_REJECTED');
    session=r.ubus_rpc_session;await call('get_status');
    return {result:0,data:{modelName:'SoftBank Air6'},line:{mode:'air6',label:'SoftBank Air6 · 统一 RPC'}};
   },
   probe:async()=>{await call('get_status');return true;},sample,
   speed:async()=>null,initialize:()=>o.platform?.initialize?.(),setReconnect(){},
   request(){throw error('AIR6 样品不支持此接口');},
   async action(m){
    requestId=m.requestId;
    if(tasks.actions.includes(m.action)){try{return await tasks.write(m);}catch(e){await emit('air6WriteResult',{ok:false,message:e.message});throw e;}}
    if(m.action==='air6ReadControlSummary')return;
    if(m.action==='air6ReadControls'){
     try{const bands=await call('get_bands');return emit('air6ControlData',{section:m.section,bands});}
     catch(e){return emit('air6WriteResult',{ok:false,message:e.message});}
    }
    if(m.action==='switchPage')return emit('updateData',await sample());
    if(m.action==='smsBadgeProbe')return;
    if(m.action==='air6Ota')return emit('air6OtaData',{ok:false,message:'安卓版样品暂不提供固件升级'});
    if(['getUiPrefs','setUiPrefs','getHomeCards','setHomeCards','speedUnit','smsTab'].includes(m.action))return o.platform?.action(m);
    throw error('此功能尚未接入当前设备 RPC');
   }
  };
 }
 const api={create,detect};root.Air6Rpc=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
