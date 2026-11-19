/* AIR6 Android line: real /ubus/ + session.login + luci.air6modem.
 *
 * The engine never falls back to the legacy cmodem paths (they return 404 on
 * this firmware). Everything the overview shows is mapped from the firmware
 * schema by air6_map.js; missing firmware fields stay null instead of 0.
 */
(function(root){
 'use strict';
 const Tasks=typeof module!=='undefined'?require('./adapter_tasks'):root.Air6AdapterTasks;
 const Mapper=typeof module!=='undefined'?require('./air6_map'):root.Air6Map;
 const Sms=typeof module!=='undefined'?require('./air6_sms'):root.Air6Sms;
 const error=(s,c)=>Object.assign(Error(s),c?{code:c}:{});
 async function detect(o){
  try{
   const r=await o.fetch(o.host+'/cgi-bin/luci/',{timeoutMs:8000});
   /* QWRT answers 403 on the LuCI root without a session; that is still proof
      of a LuCI front-end, so do not require the page body to match. */
   if(r.status===401||r.status===403)return true;
   return /luci|qwrt|openwrt/i.test(await r.text());
  }catch(_){return false;}
 }
 function create(o){
  let session='',sequence=0,requestId;
  let lastCounters=null,l3Name='';
  const smsInflight=new Set();
  /* Only "this firmware has no such method" is cached. Permission denied and
     session problems are transient and must never blacklist a method. */
  const unsupported=Object.create(null);
  const emit=(name,value)=>o.evalJS?o.evalJS('window.'+name+'&&window.'+name+'('+JSON.stringify({...value,requestId}).replace(/</g,'\\u003c')+')'):Promise.resolve();
  /* Some page callbacks take a bare boolean (window.rebootSaveResult). */
  const emitRaw=(name,value)=>o.evalJS?o.evalJS('window.'+name+'&&window.'+name+'('+JSON.stringify(value).replace(/</g,'\\u003c')+')'):Promise.resolve();
  async function rpc(object,method,args={},anonymous=false){
   if(o.isActive&&!o.isActive())throw error('旧设备会话已取消','STALE');
   if(!anonymous&&!session)throw error('请先登录设备','SESSION_EXPIRED');
   const id=++sequence;
   const r=await o.fetch(o.host+'/ubus/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:'call',params:[anonymous?'00000000000000000000000000000000':session,object,method,args]}),timeoutMs:15000});
   if(!r.ok)throw error('设备请求失败（HTTP '+r.status+'）','NETWORK');
   let v;
   try{v=JSON.parse(await r.text());}catch(_){throw error('设备返回内容无法解析','PROTOCOL');}
   if(v.error){
    /* rpcd answers -32002 ("Access denied") when the ACL forbids the object;
       that is a policy answer, not an expired session. */
    if(v.error.code===-32002)throw error('设备未授权该接口：'+object+'.'+method,'PERMISSION_DENIED');
    if(v.error.code===-32001||/session/i.test(String(v.error.message||'')))throw error('设备会话已失效，请重新登录','SESSION_EXPIRED');
    throw error('设备接口错误：'+(v.error.message||v.error.code),'PROTOCOL');
   }
   if(v.id!==id)throw error('设备响应编号不匹配','PROTOCOL');
   const code=v.result?.[0];
   if(code!==0){
    /* ubus status codes: 0 ok, 1 invalid command, 2 invalid argument,
       3 method not found, 4 not found, 5 no data, 6 permission denied,
       7 timeout, 8 not supported, 9 unknown error. */
    if(code===3||code===4||code===8)throw error('设备未提供接口：'+object+'.'+method,'METHOD_MISSING');
    if(code===2)throw error('设备拒绝了参数（'+object+'.'+method+'）','INVALID_ARGUMENT');
    if(code===6)throw error('设备会话已失效，请重新登录','SESSION_EXPIRED');
    if(code===7)throw error('设备处理超时（'+object+'.'+method+'）','TIMEOUT');
    throw error('设备接口失败：'+object+'.'+method+'（status '+code+'）','PROTOCOL');
   }
   const data=v.result[1]||{};
   /* "initializing" is a normal transient state: the collector has not written
      its first cache yet. It must not be reported as a device error. */
   if(data.initializing===true)return data;
   if(data.error||Number(data.code)>0||String(data.status)==='0'){
    const deviceCode=Number(data.code);
    /* 75 is the adapter's "another task holds the lock" answer. */
    if(deviceCode===75)throw error(data.error||data.message||'设备正忙，请稍后重试','DEVICE_BUSY');
    if(deviceCode===6||/permission|denied|unauthor/i.test(String(data.error||'')))throw error(data.error||'设备拒绝该请求（权限不足）','PERMISSION_DENIED');
    throw error(data.error||data.message||'设备拒绝请求','DEVICE_ERROR');
   }
   return data;
  }
  const call=(m,a)=>rpc('luci.air6modem',m,a);
  /* Optional method: a firmware without it yields null instead of failing the
     whole overview. */
  async function soft(object,method,args){
   const key=object+'.'+method;
   if(unsupported[key])return null;
   try{return await rpc(object,method,args||{});}
   catch(e){
    /* A missing method is permanent for this firmware; a denied/expired
       session is not, so it is re-tried next time. */
    if(e.code==='METHOD_MISSING'){unsupported[key]=true;return null;}
    if(e.code==='PERMISSION_DENIED')return null;
    throw e;
   }
  }
  async function readStatus(){
   const status=await call('get_status');
   if(!status.available)throw error(status.error||'设备未提供状态采集','NETWORK');
   if(status.initializing)throw error('设备状态采集中，请稍后重试','NETWORK');
   return status;
  }
  /* uptime/memory come from procd; the CPU percentage comes from LuCI's
     getCPUUsage. Both are granted by the air6 ALC on the live device. */
  async function systemInfo(){
   const info=await soft('system','info');
   const cpu=await soft('luci','getCPUUsage');
   if(!info&&!cpu)return null;
   return Object.assign({},info||{},{cpu_usage:cpu?cpu.cpuusage:undefined});
  }
  async function deviceCounters(status){
   const network=(status&&status.network)||{};
   const direct=Mapper.countersOf(network);
   if(direct)return direct;
   const name=network.l3_device||network.device||'';
   if(!name)return null;
   return Mapper.countersOf(await soft('network.device','status',{name:name}));
  }
  async function sample(){
   const status=await readStatus();
   const cells=(await soft('luci.air6modem','get_cells'))||{};
   const system=await systemInfo();
   let counters=null;
   try{counters=await deviceCounters(status);}catch(_){counters=null;}
   const now=Date.now();
   const network=(status&&status.network)||{};
   if(network.l3_device||network.device)l3Name=network.l3_device||network.device;
   const data=Mapper.sample({status,cells,system,counters,store:o.storage,now:now});
   if(counters)lastCounters={rx:counters.rx,tx:counters.tx,at:now,iface:l3Name};
   /* The device caches get_status for up to 30 s: expose the sampling age so
      the page can show "sampled N s ago" instead of implying real time. */
   data.fetchedAt=now;
   data.dataAgeMs=Number.isFinite(Number(status.cache_age))?Number(status.cache_age)*1000:0;
   data.cellsStale=!!cells.stale;
   const rate=Mapper.speed(status);
   if(rate){data.downSpeed=rate.down;data.upSpeed=rate.up;}
   return data;
  }
  const tasks=Tasks.create(rpc,emit);
  /* Speed must come from counters that actually move. The carrier
     dl_kbytes_per_second fields sit behind the device's 30 s status cache, so
     polling them once a second would mostly repeat a stale number. */
  async function rate(){
   if(!l3Name){
    try{const status=await call('get_status');const n=(status&&status.network)||{};l3Name=n.l3_device||n.device||'';}
    catch(e){if(['STALE','SESSION_EXPIRED','AUTH_REJECTED'].includes(e.code))throw e;return null;}
   }
   if(l3Name){
    const counters=Mapper.countersOf(await soft('network.device','status',{name:l3Name}));
    if(counters){
     const now={rx:counters.rx,tx:counters.tx,at:Date.now(),iface:l3Name};
     /* A different l3_device means a new interface: the previous baseline is
        meaningless, so start over instead of reporting a bogus spike. */
     const previous=lastCounters&&lastCounters.iface===l3Name?lastCounters:null;
     const delta=(previous&&now.at-previous.at>10000)?null:Mapper.speedFromCounters(now,previous);
     lastCounters=now;
     if(delta&&delta.down<=102400&&delta.up<=102400)return {down:delta.down,up:delta.up};
     /* No previous baseline yet: fall through to the coarse reading so the
        first second is not an empty "--". */
    }
   }
   /* Firmware without network.device: fall back to carrier throughput and mark
      the sample as coarse so the UI can label its resolution. */
   try{
    const status=await call('get_status');
    const direct=Mapper.speed(status);
    return direct?{down:direct.down,up:direct.up,coarse:true}:null;
   }catch(e){
    if(['STALE','SESSION_EXPIRED','AUTH_REJECTED'].includes(e.code))throw e;
    return null;
   }
  }
  async function controlData(section){
   const status=await readStatus();
   const raw=await call('get_bands');
   const bands=Mapper.bands(raw);
   const payload={section:section==='rat'?'rat':'band',bands:bands,ratText:status.rat||null};
   if(!bands.readable){delete payload.bands;payload.errors={bands:bands.error||'频段读取失败'};}
   await emit('air6ControlData',payload);
  }

  /* ---- SMS ------------------------------------------------------------ */
  let smsCache=null,smsAt=0,smsRefs=Object.create(null),smsStorage='';
  /* Cheap stable hash for the full message body; used to prove that a storage
     index still points at the same message before deleting. */
  const hash=text=>{let h=5381;for(let i=0;i<text.length;i++)h=((h*33)^text.charCodeAt(i))>>>0;return h.toString(36);};
  async function smsData(force){
   if(!force&&smsCache&&Date.now()-smsAt<15000)return smsCache;
   const raw=await call('list_sms');
   const parsed=Sms.payload(Sms.parse(raw.output||''));
   const storageLocation=Sms.storage(raw.storage)?Sms.storage(raw.storage).location:'';
   const fingerprint=(row,number,time)=>{
    const indexes=parsed.refs[row.Index].indexes.join(',');
    return [number,time,String(row.Msg||'').length,hash(String(row.Msg||'')),indexes,storageLocation].join('|');
   };
   smsRefs=Object.create(null);
   for(const row of parsed.recv){
    if(row.encoding==='raw')row.Msg='（无法解码，原文如下）'+row.Msg;
    smsRefs[row.Index]={indexes:parsed.refs[row.Index].indexes,number:row.Sender,time:row.Recvtime,fp:fingerprint(row,row.Sender,row.Recvtime)};
   }
   for(const row of parsed.send){
    if(row.encoding==='raw')row.Msg='（无法解码，原文如下）'+row.Msg;
    smsRefs[row.Index]={indexes:parsed.refs[row.Index].indexes,number:row.Receiver,time:row.Sendtime,fp:fingerprint(row,row.Receiver,row.Sendtime)};
   }
   smsStorage=storageLocation;
   smsCache={recv:parsed.recv,send:parsed.send,storage:Sms.storage(raw.storage)};
   smsAt=Date.now();
   return smsCache;
  }
  const wanted=(list,keys)=>{
   const set=new Set((keys||[]).map(v=>String(v&&v.Index!==undefined?v.Index:v)));
   return list.filter(m=>set.has(m.Index));
  };
  const indexesOf=keys=>{
   const out=[];
   for(const key of keys||[]){
    const ref=smsRefs[String(key&&key.Index!==undefined?key.Index:key)];
    if(ref)out.push(...ref.indexes);
   }
   return [...new Set(out)].sort((a,b)=>a-b);
  };
  async function sendSms(number,text){
   if(!/^\+?[0-9]{3,20}$/.test(number))return emit('air6SmsResult',{type:'send',ok:false,message:'号码格式不正确'});
   if(!text)return emit('air6SmsResult',{type:'send',ok:false,message:'短信内容为空'});
   if(!/^[ -~]*$/.test(text)||text.length>160)return emit('air6SmsResult',{type:'send',ok:false,message:'固件短信发送只接受 GSM 7-bit 字符（英文/数字/基本符号）且不超过 160 字；中文会在设备端被拒，请改用手机或路由器后台发送'});
   try{
    const result=await call('send_sms',{number:number,text:text});
    const ok=!!(result&&(result.success===true||Number(result.code)===0));
    smsCache=null;
    return emit('air6SmsResult',{type:'send',ok:ok,message:ok?'短信已发送':(result&&result.error)||'设备未确认短信提交'});
   }catch(e){
    /* A timeout does not mean failure: the modem may have queued it. Report
       unknown and never retry automatically. */
    const unknown=['TIMEOUT','NETWORK','PROTOCOL'].includes(e.code);
    return emit('air6SmsResult',{type:'send',ok:false,unknown:unknown,
     message:unknown?'发送结果未知（'+e.message+'），请稍后到短信列表核对，不要重复发送':e.message});
   }
  }
  function fingerprintOf(row,sender,time){
   const indexes=(smsRefs[row.Index]&&smsRefs[row.Index].indexes)||[];
   return [sender,time,String(row.Msg||'').length,hash(String(row.Msg||'')),indexes.join(','),smsStorage].join('|');
  }
  /* ---- AT / radio ----------------------------------------------------- */
  async function atCommand(command){
   const result=await soft('luci.air6modem','run_at',{command});
   if(!result)return null;
   return {ok:Number(result.code)===0,output:String(result.output||'')};
  }
  async function cfunMode(){
   const info=await atCommand('AT+CFUN?');
   const match=info&&info.ok&&info.output.match(/\+CFUN:[ \t]*(\d+)/);
   return match?match[1]:null;
  }
  /* set_radio is the only coordinated radio path (air6-task + rollback).
     Anything else would bypass the fence, so it is not offered. */
  async function radio(enabled){
   const submitted=await call('set_radio',{enabled:!!enabled});
   const id=submitted&&submitted.task_id;
   if(!id)return submitted;
   for(let i=0;i<40;i++){
    const task=await call('get_task',{task_id:id});
    if(['succeeded','confirmed'].includes(task.state))return task;
    if(['failed','rolled_back','rollback_failed','superseded'].includes(task.state))throw error(task.result&&task.result.detail&&task.result.detail.message||('设备任务状态：'+task.state));
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   throw error('设备未在 40 秒内确认射频开关结果，请稍后刷新核对');
  }
  /* ---- AT console -----------------------------------------------------
     Only exact, known read commands are allowed. A regex "must end with ?"
     rule would both miss legitimate reads (ATI, AT+CESQ) and let concatenated
     or control-character payloads through, so matching is literal. */
  const AT_LITERALS=new Set([
   'AT','ATI','AT+GMR','AT+CGMM','AT+CGSN','AT+CLAC','AT+CBC',
   'AT+CSQ','AT+CESQ','AT+CIMI','AT+ICCID',
   'AT+CFUN?','AT+CPIN?','AT+COPS?','AT+CPMS?','AT+CSCA?','AT+CGDCONT?','AT+CGACT?',
   'AT+CREG?','AT+CGREG?','AT+CEREG?','AT+CTZU?','AT+CCLK?','AT+CSMS?','AT+CNMI?',
   'AT+CMGF?','AT+CSCS?','AT+CMEE?','AT+CGCONTRDP','AT+CGPADDR','AT+CGPIAF?','AT+CPWD?'
  ]);
  async function atConsole(command){
   const raw=command===null||command===undefined?'':String(command);
   if(/[\u0000-\u001f\u007f]/.test(raw))return {ok:false,output:'指令包含换行或控制字符，已拒绝'};
   const text=raw.trim();
   if(!text)return {ok:false,output:'请输入 AT 指令'};
   if(text.length>64)return {ok:false,output:'指令过长（上限 64 字符）'};
   const upper=text.toUpperCase();
   if(!/^AT[A-Z0-9+?=,_-]*$/.test(upper))return {ok:false,output:'指令包含不被允许的字符（不允许分号、引号、空格拼接）'};
   /* AT+CMGR / AT+CPMS=<n> change state (read flag, storage) and are not part
      of the read-only console; they live in the SMS business path only. */
   if(!AT_LITERALS.has(upper))
    return {ok:false,output:'只放行无副作用的查询指令：'+[...AT_LITERALS].join('、')};
   const info=await atCommand(upper);
   if(!info)return {ok:false,output:'固件未开放 AT 通道（luci.air6modem.run_at）'};
   return {ok:info.ok,output:info.output||'(无返回)'};
  }
  /* ---- scheduled reboot (device-side cron) ---------------------------- */
  const daysText=week=>{
   const value=String(week===undefined||week===null?'*':week).trim();
   if(value==='*'||value==='')return '0,1,2,3,4,5,6';
   return value.split(/[\s,]+/).filter(v=>/^[0-6]$/.test(v)).join(',');
  };
  function rebootSummary(schedule){
   if(!schedule||schedule.enabled!==true)return '已禁用';
   const hour=String(schedule.hour===undefined?'2':schedule.hour).padStart(2,'0');
   const minute=String(schedule.minute===undefined?'0':schedule.minute).padStart(2,'0');
   const days=daysText(schedule.week);
   const label=days==='0,1,2,3,4,5,6'?'每天':days.split(',').map(d=>'周'+'日一二三四五六'[Number(d)]).join(' ');
   return label+' '+hour+':'+minute;
  }
  /* ---- Wi-Fi (uci wireless) ------------------------------------------- */
  const WIFI_BAND={'2g':'2.4G','5g':'5G','6g':'6G'};
  const WIFI_ENC={'none':'none','psk2':'psk2','psk2+ccmp':'psk2+ccmp','sae':'sae','sae+ccmp':'sae+ccmp','sae-mixed':'sae-mixed'};
  async function wifiConfig(){
   const data=await soft('uci','get',{config:'wireless'});
   const values=(data&&data.values)||{};
   const devices=Object.create(null);
   for(const [name,entry] of Object.entries(values)){
    if(entry&&entry['.type']==='wifi-device')devices[name]=entry;
   }
   const networks=[];
   for(const [name,entry] of Object.entries(values)){
    if(!entry||entry['.type']!=='wifi-iface'||String(entry.mode||'ap')!=='ap')continue;
    const device=devices[entry.device]||{};
    const band=WIFI_BAND[String(device.band||'').toLowerCase()]||String(device.band||'').toUpperCase()||'Wi-Fi';
    networks.push({
     section:name,
     band:band,
     device:entry.device||'',
     ssid:String(entry.ssid||''),
     encryption:WIFI_ENC[String(entry.encryption||'none')]||'none',
     enabled:String(entry.disabled||'0')!=='1',
     hidden:String(entry.hidden||'0')==='1',
     canSetPassword:String(entry.encryption||'none')!=='none',
     radioDisabled:String(device.disabled||'0')==='1'
    });
   }
   networks.sort((a,b)=>a.band.localeCompare(b.band));
   return {networks:networks,values:values};
  }
  /* rpcd's uci.set takes {config,section,values:{...}} on this firmware;
     the older {option,value} form answers ubus status 2 (verified live). */
  async function wifiApply(changes){
   for(const change of changes){
    await soft('uci','set',{config:'wireless',section:change.section,values:change.options});
   }
   const commit=await soft('uci','commit',{config:'wireless'});
   if(!commit)throw error('无线配置提交失败，未生效');
   /* /sbin/wifi is explicitly whitelisted for exec in this firmware's ACL
      (verified live: `file exec` returns {code,stdout}). */
   const reload=await soft('file','exec',{command:'/sbin/wifi',params:['reload']});
   if(!reload||Number(reload.code)!==0){
    const init=await soft('rc','init',{name:'network',action:'reload'});
    if(!init)throw error('配置已提交，但设备未确认无线重载，请在路由器后台重启无线');
   }
   return true;
  }
  async function wifiRestore(section,previous){
   const values={};
   for(const [option,value] of Object.entries(previous||{}))if(value!==undefined)values[option]=String(value);
   if(!Object.keys(values).length)return;
   try{await soft('uci','set',{config:'wireless',section:section,values:values});}catch(_){}
   try{await soft('uci','commit',{config:'wireless'});}catch(_){}
   try{await soft('file','exec',{command:'/sbin/wifi',params:['reload']});}catch(_){}
  }
  return {
   async connect(user,password){
    let r;
    try{r=await rpc('session','login',{username:user,password,timeout:300},true);}
    catch(e){
     /* During login a rejected credential surfaces as ubus status 6. */
     if(e.code==='SESSION_EXPIRED')throw error('用户名或密码错误','AUTH_REJECTED');
     throw e;
    }
    if(!/^[a-f0-9]{32}$/i.test(r.ubus_rpc_session||''))throw error('用户名或密码错误','AUTH_REJECTED');
    session=r.ubus_rpc_session;await call('get_status');
    return {result:0,data:{modelName:'SoftBank Air6'},line:{mode:'air6',label:'SoftBank Air6 · 统一 RPC'}};
   },
   probe:async()=>{await call('get_status');return true;},
   sample,
   speed:rate,
   initialize:()=>o.platform?.initialize?.(),
   setReconnect(){},
   request(){throw error('AIR6 采用统一 RPC，不使用旧 cmodem 接口','UNSUPPORTED');},
   async action(m){
    requestId=m.requestId;
    if(tasks.actions.includes(m.action)){try{return await tasks.write(m);}catch(e){await emit('air6WriteResult',{ok:false,message:e.message});throw e;}}
    if(m.action==='air6ReadControlSummary'){
     try{
      const status=await readStatus();
      const raw=await call('get_bands');
      const bands=Mapper.bands(raw);
      const mode=await cfunMode();
      const payload={bands:bands,imei:{imei:status.imei||''},cfun:mode?{mode:mode}:null,usb:{supported:false},ratText:status.rat||null};
      if(!bands.readable){delete payload.bands;payload.errors={bands:bands.error||'频段读取失败'};}
      return emit('air6ControlSummary',payload);
     }catch(e){return emit('air6ControlSummary',{errors:{bands:e.message}});}
    }
    if(m.action==='air6ReadControls'){
     try{return await controlData(m.section);}
     catch(e){return emit('air6ControlData',{section:m.section,errors:{bands:e.message}});}
    }
    if(m.action==='wanInfo'){
     try{
      const network=await call('get_network');
      let state={};
      try{state=JSON.parse(network.status||'{}');}catch(_){state={};}
      const items=[{
       interface:'modem5g',up:!!state.up,proto:state.proto||'',
       'ipv4-address':state['ipv4-address']||[],'ipv6-address':state['ipv6-address']||[],
       'dns-server':state['dns-server']||[],
       uptime:state.uptime||0,l3Device:state.l3_device||''
      }];
      if(!items[0]['ipv4-address'].length&&network.status)items[0].raw=network.status;
      return emit('air6WanData',{ok:true,items:items,rat:network.rat||null,radio:network.radio||null});
     }catch(e){return emit('air6WanData',{ok:false,message:e.message,items:[]});}
    }
    if(m.action==='air6Clients'){
     const leases=await soft('luci-rpc','getDHCPLeases');
     if(!leases)return emit('air6ClientsData',{ok:false,message:'固件未开放 DHCP 租约接口（luci-rpc.getDHCPLeases）'});
     const rows=Object.create(null);
     const row=mac=>{
      const key=String(mac||'').toUpperCase()||'unknown';
      if(!rows[key])rows[key]={name:'',mac:key,ipv4:[],ipv6:[]};
      return rows[key];
     };
     for(const lease of leases.dhcp_leases||[]){
      const entry=row(lease.macaddr);
      if(lease.hostname)entry.name=String(lease.hostname);
      if(lease.ipaddr&&entry.ipv4.indexOf(lease.ipaddr)<0)entry.ipv4.push(lease.ipaddr);
     }
     for(const lease of leases.dhcp6_leases||[]){
      const entry=row(lease.macaddr);
      if(lease.hostname&&!entry.name)entry.name=String(lease.hostname);
      const addresses=Array.isArray(lease.ip6addrs)&&lease.ip6addrs.length?lease.ip6addrs:(lease.ip6addr?[lease.ip6addr]:[]);
      for(const address of addresses){
       const value=String(address).split('/')[0];
       if(value&&entry.ipv6.indexOf(value)<0)entry.ipv6.push(value);
      }
     }
     return emit('air6ClientsData',{ok:true,rows:Object.keys(rows).map(k=>rows[k])});
    }
    if(m.action==='rebootDevice'){
     try{
      const submitted=await soft('luci.air6modem','reboot_async');
      if(!submitted)return emit('air6RebootResult',{ok:false,message:'固件未开放重启接口'});
      session='';
      return emit('air6RebootResult',{ok:true,message:'重启指令已下发，设备将在 1–2 分钟内断开并恢复'});
     }catch(e){return emit('air6RebootResult',{ok:false,message:e.message});}
    }
    if(m.action==='sendAtCommand'){
     try{return emit('atResult',await atConsole(m.cmd));}
     catch(e){return emit('atResult',{ok:false,output:e.message});}
    }
    if(m.action==='getRebootInfo'){
     try{
      const schedule=await call('get_schedule');
      const enabled=schedule&&schedule.enabled===true;
      const hour=String((schedule&&schedule.hour)===undefined?'2':schedule.hour).padStart(2,'0');
      const minute=String((schedule&&schedule.minute)===undefined?'0':schedule.minute).padStart(2,'0');
      const days=daysText(schedule&&schedule.week);
      const summary=rebootSummary(schedule);
      await emit('populateRebootModal',{GatewayRebootEnable:enabled?'1':'0',DaysOfWeek:days,Hour:hour,Minute:minute});
      return emit('updateData',{rebootEnabled:enabled?'1':'0',rebootText:summary});
     }catch(e){return emit('showUpdateToast','读取定时重启失败：'+e.message);}
    }
    if(m.action==='setRebootInfo'){
     try{
      const enabled=m.enable===true||String(m.enable)==='1'||String(m.enable)==='true';
      const time=String(m.time||'02:00');
      const match=time.match(/^(\d{1,2}):(\d{2})$/);
      if(!match)throw error('时间格式应为 HH:MM');
      const hour=Number(match[1]),minute=Number(match[2]);
      if(hour>23||minute>59)throw error('时间超出范围');
      const days=daysText(m.daysOfWeek);
      if(enabled&&!days)throw error('请至少选择一天');
      const week=days==='0,1,2,3,4,5,6'?'*':days;
      await call('set_schedule',{enabled:enabled,hour:hour,minute:minute,week:week,month:'*',day:'*'});
      const readback=await call('get_schedule');
      if(!!readback.enabled!==enabled||String(readback.hour)!==String(hour))throw error('设备回读与提交不一致，请刷新核对');
      await emit('updateData',{rebootEnabled:enabled?'1':'0',rebootText:rebootSummary(readback)});
      return emitRaw('rebootSaveResult',true);
     }catch(e){
      await emitRaw('rebootSaveResult',false);
      return emit('showUpdateToast','保存定时重启失败：'+e.message);
     }
    }
    if(m.action==='air6WifiLoad'){
     try{
      const config=await wifiConfig();
      if(!config.networks.length)return emit('air6WifiData',{ok:false,message:'设备未配置 AP 无线网络'});
      return emit('air6WifiData',{ok:true,networks:config.networks});
     }catch(e){return emit('air6WifiData',{ok:false,message:'读取无线配置失败：'+e.message});}
    }
    if(m.action==='air6WifiSave'){
     /* Wireless writes are not covered by the air6-task fence on this
        firmware. Writing uci directly would bypass the coordinator, so the
        entry stays read-only until a coordinated path exists. */
     return emit('air6WifiResult',{ok:false,section:String(m.section||''),
      message:'固件未把无线配置写入纳入 air6-task 协调器，本版只读；如需修改请在路由器后台操作'});
    }
    if(m.action==='air6PendingTasks'){
     try{
      const list=await call('list_tasks');
      const tasks=Array.isArray(list&&list.tasks)?list.tasks:[];
      const rows=tasks.map(task=>{
       const state=String(task.state||'unknown');
       const group=['awaiting_confirmation'].includes(state)?'pending_confirm':
        ['queued','running','applying','submitted'].includes(state)?'applying':
        ['rolled_back','rollback_failed'].includes(state)?'rolled_back':
        ['failed','superseded'].includes(state)?'failed':'unknown';
       return {
        task_id:String(task.task_id||task.id||''),
        state:state,
        group:group,
        kind:String(task.kind||task.action||task.type||''),
        target:[task.params&&task.params.rat,task.params&&task.params.arfcn,task.params&&task.params.pci].filter(v=>v!==undefined&&v!==null).join(' '),
        created:Number(task.created_at||task.created||0)||null,
        deadline:Number(task.confirm_deadline||task.deadline||0)||null,
        message:String((task.result&&task.result.detail&&task.result.detail.message)||task.message||'')
       };
      }).filter(row=>row.task_id);
      return emit('air6Pending',{ok:true,tasks:rows});
     }catch(e){return emit('air6Pending',{ok:false,message:e.message,tasks:[]});}
    }
    if(m.action==='switchPage')return emit('updateData',await sample());
    if(m.action==='smsBadgeProbe'){
     /* AT+CMGL needs ~4 s; never hold up login or page switches for a badge. */
     smsData().then(data=>emit('smsUpdate',{type:'badge',count:data.recv.filter(v=>v.Isopened==='0').length})).catch(()=>{});
     return;
    }
    if(m.action==='smsList'||m.action==='smsGet'){
     const type=m.action==='smsList'?'list':'get';
     try{
      const data=await smsData(true);
      if(type==='badge')return emit('smsUpdate',{type:'badge',count:data.recv.filter(v=>v.Isopened==='0').length});
      if(type==='list')return emit('smsUpdate',{type:'list',recv_index_list:data.recv.map(v=>({Index:v.Index,Isopened:v.Isopened})),send_index_list:data.send.map(v=>({Index:v.Index}))});
      return emit('smsUpdate',{type:'get',recv_msg_list:wanted(data.recv,m.recv),send_msg_list:wanted(data.send,m.send),storage:data.storage});
     }catch(e){return emit('smsUpdate',{type:type,error:e.message});}
    }
    if(m.action==='smsRead'){
     const indexes=indexesOf((m.recv||[]).map(v=>v&&v.Index!==undefined?v.Index:v));
     if(!indexes.length)return emit('air6SmsResult',{type:'read',ok:false,recv:m.recv||[],message:'短信已变化，请刷新后重试'});
     const failed=[];
     for(const index of indexes){
      const info=await atCommand('AT+CMGR='+index);
      if(!info||!info.ok)failed.push(index);
     }
     smsCache=null;
     return emit('air6SmsResult',{type:'read',ok:failed.length===0,recv:m.recv||[],readStates:{},message:failed.length?'部分短信标记失败：'+failed.join(','):'已标记为已读'});
    }
    if(m.action==='smsDelete'){
     const keys=(m.recv||[]).concat(m.send||[]).map(v=>String(v&&v.Index!==undefined?v.Index:v));
     const before={};
     for(const key of keys){if(smsRefs[key])before[key]=smsRefs[key];}
     /* Re-read the list and confirm the storage indexes still point at the
        same messages before deleting anything. */
     let fresh=null;
     try{fresh=await smsData(true);}catch(e){return emit('air6SmsResult',{type:'delete',ok:false,recv:m.recv||[],message:'删除前复核失败：'+e.message+'；未修改设备'});}
     const current=Object.create(null);
     for(const row of fresh.recv)current[row.Index]=fingerprintOf(row,row.Sender,row.Recvtime);
     for(const row of fresh.send)current[row.Index]=fingerprintOf(row,row.Receiver,row.Sendtime);
     for(const key of keys){
      const was=before[key],now=current[key];
      if(!was)return emit('air6SmsResult',{type:'delete',ok:false,recv:m.recv||[],message:'短信已变化，请刷新后重试'});
      if(!now||now!==was.fp)
       return emit('air6SmsResult',{type:'delete',ok:false,recv:m.recv||[],message:'短信内容或索引已变化（新收/被删/重排），未执行删除，请刷新后重试'});
     }
     const indexes=indexesOf(keys).sort((a,b)=>b-a);
     if(!indexes.length)return emit('air6SmsResult',{type:'delete',ok:false,recv:m.recv||[],message:'短信已变化，请刷新后重试'});
     const failed=[];
     for(const index of indexes){
      try{await call('delete_sms',{index:index});}catch(e){failed.push(index);}
     }
     smsCache=null;
     return emit('air6SmsResult',{type:'delete',ok:failed.length===0,recv:m.recv||[],message:failed.length?'部分短信删除失败：'+failed.join(','):'短信已删除'});
    }
    if(m.action==='smsSend'){
     const number=String(m.receiver||m.number||'').trim(),text=String(m.msg||m.text||'');
     const guard='send:'+number+':'+hash(text);
     if(smsInflight.has(guard))return emit('air6SmsResult',{type:'send',ok:false,message:'同一条短信正在提交，请勿重复点击'});
     smsInflight.add(guard);
     try{return await sendSms(number,text);}
     finally{smsInflight.delete(guard);}
    }
    if(m.action==='air6TaskPreview')return emit('air6TaskPreviewData',{ok:false,message:'固件未提供定时任务接口，无法计算下次执行时间'});
    if(m.action==='air6AdvancedRead'){
     const kind=m.kind;
     try{
      if(kind==='cfun'){const mode=await cfunMode();return emit('air6AdvancedData',{ok:mode!==null,kind:kind,data:{mode:mode},message:mode===null?'无法读取 CFUN 模式':'已读取 CFUN 模式'});}
      if(kind==='imei'){const status=await readStatus();return emit('air6AdvancedData',{ok:true,kind:kind,data:{imei:String(status.imei||'')},message:'已读取 IMEI（仅本机显示）'});}
      if(kind==='usb')return emit('air6AdvancedData',{ok:false,kind:kind,data:{supported:false},message:'固件未提供 USB 功能模式接口'});
      return emit('air6AdvancedData',{ok:false,kind:kind,message:'未知的高级项'});
     }catch(e){return emit('air6AdvancedData',{ok:false,kind:kind,message:e.message});}
    }
    if(m.action==='air6AdvancedSave'){
     const kind=m.kind,value=String(m.value===undefined?'':m.value);
     try{
      if(kind==='cfun'){
       if(value==='0')return emit('air6AdvancedData',{ok:false,kind:kind,message:'飞行模式没有设备协调接口，只能在「全功能 / 关闭射频」之间切换'});
       if(!['1','4'].includes(value))return emit('air6AdvancedData',{ok:false,kind:kind,message:'无效的 CFUN 模式'});
       await radio(value==='1');
       const mode=await cfunMode();
       return emit('air6AdvancedData',{ok:true,kind:kind,data:{mode:mode||value},message:value==='1'?'已开启射频':'已关闭射频'});
      }
      if(kind==='imei')return emit('air6AdvancedData',{ok:false,kind:kind,message:'固件不提供 IMEI 写入接口，未修改设备'});
      return emit('air6AdvancedData',{ok:false,kind:kind,message:'固件未提供 USB 功能模式写入'});
     }catch(e){return emit('air6AdvancedData',{ok:false,kind:kind,message:e.message});}
    }
    if(m.action==='air6ExtraRead'){
     const kind=m.kind;
     try{
      if(kind==='smsconfig'){
       const cpms=await atCommand('AT+CPMS?');
       const smsc=await soft('luci.air6modem','get_smsc');
       const storage=Sms.storage(cpms&&cpms.output)||null;
       const number=(String(smsc&&smsc.output||'').match(/\+CSCA:[ \t]*"([^"]+)"/)||[])[1]||'';
       const config={delete_rule:'none',forward_enable:false,serverchan_enable:false,email_enable:false};
       return emit('air6ExtraData',{ok:true,kind:kind,config:config,storageMode:storage?storage.location:'MT',
        storage:storage||{used:null,total:null},
        message:'短信中心号码 '+(number||'未读取')+'；固件未提供转发/推送规则'});
      }
      if(kind==='rf'){
       const status=await readStatus();
       return emit('air6ExtraData',{ok:true,kind:kind,message:'固件不提供发射功率读写；当前射频状态：'+(status.radio||'未知')});
      }
      if(kind==='scheduler')return emit('air6ExtraData',{ok:false,kind:kind,message:'固件未提供定时任务接口，本项未适配'});
      if(kind==='failover')return emit('air6ExtraData',{ok:false,kind:kind,message:'固件未提供自动回退接口，本项未适配'});
      return emit('air6ExtraData',{ok:false,kind:kind,message:'未知的扩展项'});
     }catch(e){return emit('air6ExtraData',{ok:false,kind:kind,message:e.message});}
    }
    if(m.action==='air6ExtraSave')return emit('air6ExtraData',{ok:false,kind:m.kind,message:'固件未提供该项写入接口，未修改设备'});
    if(m.action==='air6Ota')return emit('air6OtaData',{ok:false,message:'安卓版暂不提供固件升级'});
    if(['getUiPrefs','setUiPrefs','getHomeCards','setHomeCards','speedUnit','smsTab'].includes(m.action))return o.platform?.action(m);
    throw error('此功能尚未接入当前设备 RPC','UNSUPPORTED');
   }
  };
 }
 const api={create,detect};root.Air6Rpc=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
