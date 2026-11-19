'use strict';
/* Contract test for the Air6 RPC engine against a stubbed ubus endpoint.
   Proves which firmware methods are called, that a missing method is probed
   only once, and that emitted UI payloads match fhcpeweb/air6_ui expectations. */
const assert=require('assert');
const Rpc=require('../FHCpeBoard/assets/air6_rpc');

function mockDevice(){
 const state={
  status:{available:true,cached:true,cache_age:3,
   carriers:[{rat:'NR',role:'PCC',band:78,pci:786,arfcn:633984,dl_bandwidth_mhz:100,ul_bandwidth_mhz:100,dl_mimo:2,ul_mimo:255,dl_mcs:11,ul_mcs:255,dl_kbytes_per_second:455,ul_kbytes_per_second:182,active:true}],
   ca:{valid:true,raw_nr_pcc_count:1,nr_active:false,nr_configured_scc:1,lte_active:false,lte_configured_scc:0},
   imei:'860000000000076',sim:'READY',operator:'中国联通',registration:'registered',rat:'NR5G-SA',
   temperature:'44.8',band:'78',pci:'786',arfcn:'633984',cesq:'RSSI=-71 dBm · RSRP=-83 dBm · RSRQ=-11 dB · SINR=17 dB',
   network:{up:true,uptime:1200,l3_device:'rmnet_data0','ipv4-address':[{address:'10.1.2.3',mask:30}]}}
 };
 const calls=[];let rx=0,tx=0,schedule=null,tasks=[];const flaky={denyLeases:0,expireStatus:false};
 let currentId=1;
 const reply=result=>({ok:true,status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:currentId,result:result})});
 const ok=data=>reply([0,data]),missing=()=>reply([3]);
 const deny=()=>({ok:true,status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:currentId,error:{code:-32002,message:'Access denied'}})});
 const invoke=(object,method,args)=>{
  calls.push(object+'.'+method);
  if(object==='session'&&method==='login')return args.password==='good'?ok({ubus_rpc_session:'a'.repeat(32)}):reply([6]);
  if(object==='luci.air6modem'&&method==='get_status')return flaky.expireStatus?reply([6]):ok(state.status);
  if(object==='luci.air6modem'&&method==='get_cells')return ok({stale:false,cells:[
   {rat:'NR',role:'serving',band:78,pci:786,arfcn:633984,rsrp:-82,rsrq:-12,sinr:13,rssi:-71},
   {rat:'NR',role:'neighbor',band:null,pci:40,arfcn:633984,rsrp:-94,rsrq:-13,sinr:5,rssi:null}]});
  if(object==='luci.air6modem'&&method==='get_bands')return ok({supported:{error:0,LTE:[1,3,7],NR:[1,78]},current:{error:0,LTE:[1,3,7],NR:[1,78]}});
  if(object==='luci.air6modem'&&method==='list_sms')return ok({success:true,storage:'+CPMS: "MT", 25, 100, "MT", 25, 100\r\n\r\nOK',
   output:['+CMGL: 1,"REC UNREAD","106860363999875","","2026/11/17 10:18:57+32"','4F60597D',
           '+CMGL: 2,"REC READ","10690000","","2026/11/17 11:00:00+32"','4E16754C'].join('\r\n')});
  if(object==='luci.air6modem'&&method==='send_sms'){const bad=!/^[ -~]+$/.test(args.text||'');return bad?ok({code:22,error:'Use 1-160 printable GSM/ASCII characters'}):ok({code:0,success:true,output:'qlril accepted'});}
  if(object==='luci.air6modem'&&method==='delete_sms')return ok({code:0,output:'OK'});
  if(object==='luci.air6modem'&&method==='run_at'){
   if(args.command==='AT+CFUN?')return ok({output:'+CFUN: 1\r\n\r\nOK',code:0});
   if(args.command==='AT+CPMS?')return ok({output:'+CPMS: "MT", 25, 100, "MT", 25, 100\r\n\r\nOK',code:0});
   if(/^AT\+CMGR=\d+$/.test(args.command))return ok({output:'OK',code:0});
   return ok({output:'OK',code:0});
  }
  if(object==='luci.air6modem'&&method==='get_smsc')return ok({output:'+CSCA: "8613010200500", 145\r\n\r\nOK',code:0});
  if(object==='luci.air6modem'&&method==='set_radio')return ok({task_id:'radio-1',state:'running'});
  if(object==='luci.air6modem'&&method==='get_task')return ok({task_id:'radio-1',state:'succeeded'});
  if(object==='luci.air6modem'&&method==='list_tasks')return ok({tasks:tasks});
  if(object==='luci.air6modem'&&method==='get_schedule')return ok(Object.assign({enabled:false,week:'*',hour:'2',minute:'0',month:'*',day:'*',cron_expr:'0 2 * * *',timezone:'Asia/Shanghai',now:1},schedule));
  if(object==='luci.air6modem'&&method==='set_schedule'){
   schedule={enabled:args.enabled===true,week:String(args.week),hour:String(args.hour),minute:String(args.minute)};
   return ok({ok:true});
  }
  if(object==='luci.air6modem'&&method==='reboot_async')return ok({task_id:'reboot-1'});
  if(object==='uci'&&method==='get')return ok({values:{
   MT7990_1_1:{'.type':'wifi-device','.name':'MT7990_1_1',band:'2g'},MT7990_1_2:{'.type':'wifi-device','.name':'MT7990_1_2',band:'5g'},
   wifinet0:{'.type':'wifi-iface','.name':'wifinet0',device:'MT7990_1_1',mode:'ap',ssid:'AIR6_2.4G',encryption:'sae-mixed',disabled:'0',hidden:'0',key:'12345678'},
   wifinet1:{'.type':'wifi-iface','.name':'wifinet1',device:'MT7990_1_2',mode:'ap',ssid:'AIR6_5G',encryption:'sae-mixed',disabled:'0',hidden:'0',key:'12345678'}}});
  if(object==='uci'&&(method==='set'||method==='commit'))return ok({});
  if(object==='file'&&method==='exec')return ok({code:0});
  if(object==='luci.air6modem'&&method==='get_network')return ok({status:JSON.stringify({up:true,proto:'ql_datacall',uptime:1200,'ipv4-address':[{address:'10.1.2.3',mask:30}],'dns-server':['210.2.4.8']}),rat:'NR5G-SA'});
  if(object==='system'&&method==='info')return ok({uptime:3725,memory:{total:512000,available:204800},load:[0.4,0.3,0.2]});
  if(object==='luci'&&method==='getCPUUsage')return ok({cpuusage:'7%'});
  if(flaky.denyLeases>0){flaky.denyLeases--;return deny();}
  if(object==='luci-rpc'&&method==='getDHCPLeases')return ok({dhcp_leases:[
   {expires:42952,hostname:'Redmi-Note-12-Turbo',macaddr:'92:2F:C8:1F:9B:96',ipaddr:'192.168.99.200'},
   {expires:42944,macaddr:'1E:C3:C2:B5:89:5E',ipaddr:'192.168.99.170'}],
   dhcp6_leases:[{expires:4108,macaddr:'92:2F:C8:1F:9B:96',ip6addr:'2408:8459:880:95c::626',ip6addrs:['2408:8459:880:95c::626/128','fd2a:d4a3:34e4::626/128']}]});
  if(object==='network.device'&&method==='status'){rx+=5*1048576;tx+=1048576;return ok({statistics:{rx_bytes:rx,tx_bytes:tx}});}
  return missing();
 };
 const fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  currentId=body.id;
  return invoke(body.params[1],body.params[2],body.params[3]||{});
 };
 return {state,calls,fetch,flaky,setSchedule:value=>{schedule=value;},setTasks:value=>{tasks=value;}};
}

function harness(){
 const device=mockDevice(),events=[];
 const engine=Rpc.create({
  host:'http://192.168.99.1',fetch:device.fetch,
  evalJS:async js=>{
   const name=(js.match(/^window\.(\w+)/)||[])[1]||'?';
   const open=js.indexOf('('),close=js.lastIndexOf(')');
   let payload=null;try{payload=JSON.parse(js.slice(open+1,close));}catch(_){payload={raw:js};}
   events.push({name,payload});
   return 'null';
  }
 });
 return {device,events,engine};
}
const count=(calls,name)=>calls.filter(v=>v===name).length;

(async()=>{
 // 1. Wrong password is rejected before any modem call
 {
  const h=harness();
  await assert.rejects(()=>h.engine.connect('root','bad'),e=>e.code==='AUTH_REJECTED');
  assert.equal(count(h.device.calls,'luci.air6modem.get_status'),0);
 }
 // 2. connect + sample mapping
 const h=harness();
 const login=await h.engine.connect('root','good');
 assert.equal(login.line.mode,'air6');
 assert.equal(count(h.device.calls,'luci.air6modem.get_status'),1,'connect probes the modem once');
 const data=await h.engine.sample();
 assert.equal(data.deviceOnline,true);
 assert.equal(data.operator,'中国联通');
 assert.equal(data.mode,'NR5G-SA');
 assert.equal(data.bandTag,'n78');
 assert.equal(data.rsrp,-82,'serving cell wins over the CESQ string');
 assert.equal(data.sinr,13);
 assert.equal(data.rssi,-71);
 assert.equal(data.carriers.length,1);
 assert.equal(data.carriers[0].type,'PCC');
 assert.equal(data.carriers[0].band,'n78');
 assert.match(data.caSummary,/^1CC/);
 assert.equal(data.allCells.length,2);
 assert.equal(data.modemTemp,'44.8');
 assert.equal(data.wanIp,'10.1.2.3');
 assert.equal(data.dlAmbrMbps,null);
 assert.equal(data.uptimeText,'1 小时 2 分');
 assert.equal(Math.round(data.ramUsage),60);
 assert.equal(data.downSpeed,455);
 assert.equal(data.upSpeed,182);
 assert.equal(Math.round(data.monthRxToday),5);
 assert.equal(Math.round(data.todayRxToday),5,'interface up 20 min today -> cumulative is today');
 assert.equal(count(h.device.calls,'luci.air6modem.get_cells'),1);
 assert.equal(count(h.device.calls,'system.info'),1,'reads procd system info');
 assert.equal(data.cpuUsage,7,'luci.getCPUUsage percent parsed');
 assert.equal(count(h.device.calls,'luci.getCPUUsage'),1);
 // 3. Missing firmware methods are not retried on every refresh
 const callsAfterFirst=h.device.calls.length;
 await h.engine.sample();
 assert.equal(count(h.device.calls,'luci.air6modem.get_system'),0,'no get_system probe on this firmware');
 assert.equal(count(h.device.calls,'luci.air6modem.get_status'),3);
 assert.equal(h.device.calls.length-callsAfterFirst,5,'second sample: status+cells+system+cpu+counters, no dead probes');

 // 4. speed()
 const first=await h.engine.speed();
 assert.equal(first.down,455,'first tick falls back to carrier throughput');
 assert.equal(first.up,182);
 assert.equal(first.coarse,true);

 // 5. Control page read path
 h.events.length=0;
 await h.engine.action({action:'air6ReadControls',section:'band',requestId:'r1'});
 const control=h.events.find(e=>e.name==='air6ControlData');
 assert.ok(control,'air6ControlData emitted');
 assert.equal(control.payload.section,'band');
 assert.equal(control.payload.bands.support_nr_band,'1/78');
 assert.equal(control.payload.bands.current_lte_band,'1/3/7');
 assert.equal(control.payload.ratText,'NR5G-SA');
 assert.equal(control.payload.requestId,'r1');

 // 6. WAN info
 h.events.length=0;
 await h.engine.action({action:'wanInfo'});
 const wan=h.events.find(e=>e.name==='air6WanData');
 assert.ok(wan,'air6WanData emitted');
 assert.equal(wan.payload.ok,true);
 assert.equal(wan.payload.items[0]['ipv4-address'][0].address,'10.1.2.3');
 assert.deepEqual(wan.payload.items[0]['dns-server'],['210.2.4.8']);

 // 7. DHCP leases merge IPv4 and IPv6 for the same MAC
 h.events.length=0;
 await h.engine.action({action:'air6Clients'});
 const clients=h.events.find(e=>e.name==='air6ClientsData');
 assert.equal(clients.payload.ok,true);
 assert.equal(clients.payload.rows.length,2);
 const named=clients.payload.rows.find(r=>r.mac==='92:2F:C8:1F:9B:96');
 assert.equal(named.name,'Redmi-Note-12-Turbo');
 assert.deepEqual(named.ipv4,['192.168.99.200']);
 assert.deepEqual(named.ipv6,['2408:8459:880:95c::626','fd2a:d4a3:34e4::626']);

 // 8. A genuinely unknown action still fails loudly
 await assert.rejects(()=>h.engine.action({action:'air6NoSuchThing'}),/尚未接入/);

 // 9. Collecting state is a retryable network condition, not an empty page
 {
  const g=harness();
  await g.engine.connect('root','good');
  g.device.state.status={available:true,initializing:true,error:'Waiting for the modem status collector'};
  await assert.rejects(()=>g.engine.sample(),e=>e.code==='NETWORK'&&/采集/.test(e.message));
 }

 // 10. SMS: list -> get -> badge, then read/delete/send write paths
 h.events.length=0;
 await h.engine.action({action:'smsList'});
 const list=h.events.find(e=>e.name==='smsUpdate');
 assert.equal(list.payload.type,'list');
 assert.equal(list.payload.recv_index_list.length,2,'two conversations');
 assert.equal(list.payload.recv_index_list[0].Index,'r1');
 assert.equal(list.payload.recv_index_list[0].Isopened,'0','unread flag carried to the list');
 assert.equal(list.payload.recv_index_list[1].Isopened,'1');
 const keys=list.payload.recv_index_list.map(v=>v.Index);
 h.events.length=0;
 await h.engine.action({action:'smsGet',recv:keys.map(Index=>({Index})),send:[]});
 const get=h.events.find(e=>e.name==='smsUpdate');
 assert.equal(get.payload.type,'get');
 assert.equal(get.payload.recv_msg_list.length,2);
 assert.equal(get.payload.recv_msg_list[0].Msg,'你好');
 assert.equal(get.payload.recv_msg_list[1].Sender,'10690000');
 assert.equal(get.payload.storage.used,25);
 h.events.length=0;
 await h.engine.action({action:'smsBadgeProbe'});
 await new Promise(resolve=>setTimeout(resolve,20)); /* badge is fire-and-forget */
 assert.equal(h.events.find(e=>e.name==='smsUpdate').payload.count,1,'one unread');

 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'smsRead',recv:[{Index:'r1'}],send:[]});
 assert.ok(h.device.calls.includes('luci.air6modem.run_at'),'read uses AT+CMGR');
 assert.equal(h.events.find(e=>e.name==='air6SmsResult').payload.ok,true);

 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'smsDelete',recv:[{Index:'r1'},{Index:'r2'}],send:[]});
 assert.equal(count(h.device.calls,'luci.air6modem.delete_sms'),2);
 assert.equal(h.events.find(e=>e.name==='air6SmsResult').payload.ok,true);

 h.events.length=0;
 await h.engine.action({action:'smsSend',receiver:'+819012345678',msg:'hello 5g'});
 assert.equal(h.events.find(e=>e.name==='air6SmsResult').payload.ok,true);
 h.events.length=0;
 await h.engine.action({action:'smsSend',receiver:'+819012345678',msg:'中文短信'});
 const refused=h.events.find(e=>e.name==='air6SmsResult');
 assert.equal(refused.payload.ok,false);
 assert.match(refused.payload.message,/英文\/数字/,'non-ASCII is refused, not silently dropped');

 // 11. Control panel: CFUN read + radio switch through the task path
 h.events.length=0;
 await h.engine.action({action:'air6AdvancedRead',kind:'cfun'});
 assert.equal(h.events.find(e=>e.name==='air6AdvancedData').payload.data.mode,'1');
 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'air6AdvancedSave',kind:'cfun',value:'4'});
 assert.ok(h.device.calls.includes('luci.air6modem.set_radio'));
 assert.equal(h.events.find(e=>e.name==='air6AdvancedData').payload.ok,true);
 h.events.length=0;
 await h.engine.action({action:'air6AdvancedSave',kind:'cfun',value:'0'});
 assert.equal(h.events.find(e=>e.name==='air6AdvancedData').payload.ok,false,'airplane mode is refused');
 h.events.length=0;
 await h.engine.action({action:'air6AdvancedRead',kind:'imei'});
 assert.equal(h.events.find(e=>e.name==='air6AdvancedData').payload.data.imei,'860000000000076');

 // 12. SMS settings + unsupported sections report instead of throwing
 h.events.length=0;
 await h.engine.action({action:'air6ExtraRead',kind:'smsconfig'});
 const cfg=h.events.find(e=>e.name==='air6ExtraData').payload;
 assert.equal(cfg.ok,true);
 assert.equal(cfg.storageMode,'MT');
 assert.equal(cfg.storage.total,100);
 assert.match(cfg.message,/8613010200500/);
 h.events.length=0;
 await h.engine.action({action:'air6ExtraRead',kind:'scheduler'});
 assert.equal(h.events.find(e=>e.name==='air6ExtraData').payload.ok,false);

 // 13. Reboot / AT console / scheduled reboot / Wi-Fi
 h.events.length=0;
 await h.engine.action({action:'sendAtCommand',cmd:'AT+CSQ'});
 let at=h.events.find(e=>e.name==='atResult');
 assert.equal(at.payload.ok,true);
 assert.equal(at.payload.output,'OK','device output passed through');
 h.events.length=0;
 await h.engine.action({action:'sendAtCommand',cmd:'AT+CFUN=0'});
 at=h.events.find(e=>e.name==='atResult');
 assert.equal(at.payload.ok,false);
 assert.ok(at.payload.output.includes('查询指令'),'write commands are refused');

 h.device.setSchedule({enabled:true,week:'*',hour:'3',minute:'30'});
 h.events.length=0;
 await h.engine.action({action:'getRebootInfo'});
 const popup=h.events.find(e=>e.name==='populateRebootModal');
 assert.ok(popup,'modal prefilled');
 assert.equal(popup.payload.GatewayRebootEnable,'1');
 assert.equal(popup.payload.DaysOfWeek,'0,1,2,3,4,5,6');
 assert.equal(popup.payload.Hour,'03');
 const summaryData=h.events.filter(e=>e.name==='updateData').pop();
 assert.equal(summaryData.payload.rebootEnabled,'1');
 assert.match(summaryData.payload.rebootText,/每天 03:30/);

 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'setRebootInfo',enable:false,daysOfWeek:'1,3',time:'04:15'});
 const sent=h.device.calls.filter(c=>c==='luci.air6modem.set_schedule');
 assert.equal(sent.length,1,'schedule written through the device API');
 assert.equal(h.events.find(e=>e.name==='rebootSaveResult').payload,true);

 h.events.length=0;
 await h.engine.action({action:'air6WifiLoad'});
 const wifi=h.events.find(e=>e.name==='air6WifiData').payload;
 assert.equal(wifi.ok,true);
 assert.equal(wifi.networks.length,2);
 assert.deepEqual(wifi.networks.map(n=>n.band),['2.4G','5G']);
 assert.equal(wifi.networks[0].ssid,'AIR6_2.4G');
 assert.equal(wifi.networks[0].canSetPassword,true);

 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'air6WifiSave',section:'wifinet0',patch:{ssid:'AIR6_HOME',password:'12345678'}});
 const wifiSaved=h.events.find(e=>e.name==='air6WifiResult').payload;
 assert.equal(wifiSaved.ok,false,'wireless writes are refused: no coordinated path');
 assert.match(wifiSaved.message,/协调器/);
 assert.equal(h.device.calls.filter(c=>c.startsWith('uci.set')).length,0,'no uci write happens');

 // 14. Pending task scan keeps state groups apart
 h.device.setTasks([
  {task_id:'t1',state:'awaiting_confirmation',kind:'cell',params:{rat:'nr',arfcn:633984,pci:786}},
  {task_id:'t2',state:'rolled_back',kind:'band'},
  {task_id:'t3',state:'failed',kind:'rat'}
 ]);
 h.events.length=0;
 await h.engine.action({action:'air6PendingTasks'});
 const pending=h.events.find(e=>e.name==='air6Pending').payload;
 assert.equal(pending.ok,true);
 assert.deepEqual(pending.tasks.map(t=>t.group),['pending_confirm','rolled_back','failed']);
 assert.equal(pending.tasks[0].target,'nr 633984 786');
 h.events.length=0;
 await h.engine.action({action:'rebootDevice'});
 assert.equal(h.events.find(e=>e.name==='air6RebootResult').payload.ok,true);
 /* A reboot drops the session token on purpose; the runtime re-logs in. */
 await h.engine.connect('root','good');

 // 15. AT console: literal whitelist, no concatenation, no control chars
 const atCases=[
  ['AT+CFUN?',true],['ATI',true],['AT+CESQ',true],
  ['AT+CFUN=0',false],['AT;AT+CFUN=0',false],['AT+CFUN?\nAT+CFUN=0',false],['AT+CMGR=12',false],['AT+CPMS=1',false],['AT+CMGR=x',false]
 ];
 for(const [cmd,allowed] of atCases){
  h.events.length=0;h.device.calls.length=0;
  await h.engine.action({action:'sendAtCommand',cmd:cmd});
  const result=h.events.find(e=>e.name==='atResult').payload;
  assert.equal(result.ok,allowed,'AT command '+JSON.stringify(cmd));
  if(!allowed)assert.equal(h.device.calls.length,0,'refused command never reaches the device');
 }

 // 16. Transient permission denial must not blacklist a method
 h.device.flaky.denyLeases=1;
 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'air6Clients'});
 assert.equal(h.events.find(e=>e.name==='air6ClientsData').payload.ok,false,'first call denied');
 h.events.length=0;h.device.calls.length=0;
 await h.engine.action({action:'air6Clients'});
 assert.equal(count(h.device.calls,'luci-rpc.getDHCPLeases'),1,'denied method is retried, not cached');
 assert.equal(h.events.find(e=>e.name==='air6ClientsData').payload.ok,true);

 // 17. Session expiry surfaces as SESSION_EXPIRED (relogin), not "unsupported"
 h.device.flaky.expireStatus=true;
 await assert.rejects(()=>h.engine.sample(),e=>e.code==='SESSION_EXPIRED');
 h.device.flaky.expireStatus=false;
 console.log('PASS air6 rpc: sample/sms/controls/reboot/at-literal/errors/schedule/wifi-read-only');
})().catch(e=>{console.error(e);process.exit(1);});
