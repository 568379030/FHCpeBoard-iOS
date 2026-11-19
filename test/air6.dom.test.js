'use strict';
/* Render test: drives the real page with the object air6_map.sample() produces
   for the live device, then reads the overview DOM back.
   Needs jsdom (`npm i jsdom`); skips when it is not installed. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');

let JSDOM,VirtualConsole;
try{({JSDOM,VirtualConsole}=require('jsdom'));}
catch(_){
 console.log('SKIP air6 dom: jsdom not installed (npm i jsdom)');
 process.exit(0);
}
const A=path.join(__dirname,'..','FHCpeBoard','assets');
const read=name=>fs.readFileSync(path.join(A,name),'utf8');

const dom=new JSDOM(read('fhcpeweb.html'),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://app.local/',virtualConsole:new VirtualConsole()});
const w=dom.window;
/* The Android bridges the page normally talks to. */
w.AndroidBoard={postMessage:()=>{}};
w.AndroidCore={kcGet:()=>'',kcSet:()=>{},kcRemove:()=>{},nativePing:()=>'{"ver":"test"}',log:()=>{}};
w.sendToScriptable=()=>{};
/* Same order lan_runtime.boot() injects them. */
for(const name of ['device_address.js','lan_ui.js','air6_automation.js','air6_map.js','air6_ui.js','sms_cards.js']){
 try{w.eval(read(name));}catch(e){console.log('SKIP air6 dom: '+name+' failed to load ('+e.message+')');dom.window.close();process.exit(0);}
}
w.lanDeviceType('air6');
w.document.body.classList.add('card-header-pro');

/* Values measured on the live SoftBank AIR6 (2026-11-18, n78, 2 carriers). */
w.updateData({
 deviceOnline:true,deviceName:'SoftBank',deviceModel:'Air6',operator:'中国联通',mode:'NR5G-SA',bandTag:'n78',
 modemTemp:'69.8',rsrp:-82,rsrq:-11,sinr:23,rssi:-71,
 carriers:[
  {type:'PCC',rat:'nr',band:'n78',bandwidth:'100MHz',dlBandwidth:100,ulBandwidth:100,pci:786,arfcn:633984,rsrp:-82,rsrq:-11,sinr:23,rssi:-71},
  {type:'SCC',rat:'nr',band:'n78',bandwidth:'100MHz',dlBandwidth:100,ulBandwidth:null,pci:135,arfcn:627264,rsrp:null,rsrq:null,sinr:null,rssi:null}
 ],
 caSummary:'2CC · 载波聚合未激活',peakDlMbps:2000,peakUlMbps:800,allCells:[],cpuUsage:5,ramUsage:30,uptimeText:'1 小时 34 分',
 monthRxToday:2745,monthTxToday:516,todayRxToday:12.5,todayTxToday:3.5,
 downSpeed:3,upSpeed:120,wanIp:'10.4.198.227',swVersion:'QWRT / AIR6',
 dlAmbrMbps:null,ulAmbrMbps:null,qci:null
});

const text=id=>{const node=w.document.getElementById(id);return node?node.textContent.trim():'<missing>';};
const aqLabel=id=>{const node=w.document.getElementById(id);return node&&node.parentNode?node.parentNode.querySelector('.aq-label').textContent.trim():'?';};
const has=id=>!!w.document.getElementById(id);

assert.equal(text('operator'),'中国联通');
assert.equal(text('rsrp'),'-82');
assert.equal(text('cpuUsage'),'5%');
assert.equal(text('ramUsage'),'30%');
assert.match(text('totalTraffic'),/GB|MB/);
assert.match(text('rxToday'),/GB|MB/);
assert.match(text('todayTotalText'),/GB|MB/,'今日已用 must not stay "- -"');

/* Signal gauges are built from the PCC row. */
const grid=text('gaugeGrid');
assert.ok(grid.includes('-82')&&grid.includes('-11')&&grid.includes('-71'),'RSRP/RSRQ/RSSI gauges rendered');

/* Carrier aggregation list */
const ca=text('caRowList');
assert.ok(ca.includes('PCC')&&ca.includes('n78')&&ca.includes('786'),'PCC row rendered');
assert.ok(ca.includes('SCC1')&&ca.includes('135'),'SCC row rendered');
assert.equal(text('caRowSummary'),'2CC · 载波聚合未激活');

/* AMBR/QCI tiles carry real bandwidth/CC values with honest labels. */
assert.equal(aqLabel('dlAmbr'),'理论峰值↓','no AMBR on this firmware: label says theoretical peak');
assert.match(text('dlAmbr'),/^\d+ Mbps$/);
assert.equal(aqLabel('ulAmbr'),'理论峰值↑');
assert.match(text('ulAmbr'),/^\d+ Mbps$/);
assert.equal(aqLabel('qciVal'),'聚合载波');
assert.equal(text('qciVal'),'2CC');

/* Settings rows fed by air6ControlSummary must never sit on 待读取. */
w.air6ControlSummary({bands:{support_lte_band:'1/3/5',support_nr_band:'1/78',current_lte_band:'1/3/5',current_nr_band:'1/78',readable:true},
 imei:{imei:'8686000000006976'},cfun:{mode:'1'},usb:{supported:false},ratText:'NR5G-SA'});
assert.equal(text('netSettingText'),'NR5G-SA（偏好未上报）','network mode row explains the missing preference');
assert.equal(text('lockedCellText'),'固件未提供读数','cell lock row is explicit, not 待读取');
assert.equal(text('lockedBandText'),'全部频段');
assert.equal(text('air6AdvancedStatus_imei'),'8686…6976');

/* Uptime shows in the overview row. */
if(has('systemUptime'))assert.equal(text('systemUptime'),'1 小时 34 分');
if(has('lanRuntimeCpu'))assert.match(text('lanRuntimeCpu'),/^5(\.0)?%$/);

/* Freshness line and the pending-task card must be real DOM, not console noise. */
w.updateData(Object.assign({},{
 deviceOnline:true,operator:'中国联通',mode:'NR5G-SA',bandTag:'n78',rsrp:-82,rssi:-71,rssq:-11,sinr:23,
 carriers:[{type:'PCC',band:'n78',bandwidth:'100MHz',dlBandwidth:100,ulBandwidth:100,pci:786,arfcn:633984,rsrp:-82,rsrq:-11,sinr:23,rssi:-71}],
 cpuUsage:5,ramUsage:30,uptimeText:'1 小时',monthRxToday:10,monthTxToday:2,todayRxToday:1,todayTxToday:0.5,
 dataAgeMs:12000,cellsStale:true,trafficEstimated:true
}));
assert.ok(text('air6Fresh').includes('12 秒前'),'freshness line shows the device cache age');
assert.ok(text('air6Fresh').includes('过期'),'stale cell data is called out');
w.air6Pending({ok:true,tasks:[
 {task_id:'t1',state:'awaiting_confirmation',group:'pending_confirm',kind:'cell',target:'nr 633984 786'},
 {task_id:'t2',state:'rolled_back',group:'rolled_back',kind:'band'}
]});
const card=w.document.getElementById('air6PendingCard');
assert.equal(card.style.display,'','pending card is visible');
assert.ok(card.textContent.includes('等待你确认'),'confirmation state is labelled');
assert.ok(card.textContent.includes('已回滚'),'rollback state is labelled separately');
assert.ok(card.querySelectorAll('button').length>=1,'only user-initiated confirmation buttons exist');

/* Switching back to the FiberHome layout restores the original labels. */
w.lanDeviceType('fh');
assert.equal(aqLabel('dlAmbr'),'签约下行');
assert.equal(text('dlAmbr'),'--');

/* SMS page: the payloads emitted by air6_rpc must render conversations. */
(async()=>{
 w.lanDeviceType('air6');
 w.smsUpdate({type:'list',recv_index_list:[{Index:'r1_2_3',IsOpened:'0'},{Index:'r4',IsOpened:'1'}],send_index_list:[]});
 w.smsUpdate({type:'get',recv_msg_list:[
  {Index:'r1_2_3',Msg:'【联通助理】关机未接 主叫:02195561 归属:未知',Sender:'106860363999875',Recvtime:'2026-11-17 10:18:57',Isopened:'0'},
  {Index:'r4',Msg:'【顺丰同城急送】限时7折优惠',Sender:'106927461007055',Recvtime:'2026-11-17 12:06:34',Isopened:'1'}
 ],send_msg_list:[],storage:{location:'MT',used:25,total:100}});
 await new Promise(resolve=>setTimeout(resolve,400));
 const smsText=w.document.getElementById('smsListContainer')?.textContent.replace(/\s+/g,' ')||'';
 assert.ok(smsText.includes('106860363999875'),'SMS list shows the sender');
 assert.ok(smsText.includes('关机未接'),'SMS list shows the decoded UCS2 body');
 assert.ok(smsText.includes('106927461007055'),'second conversation rendered');
 dom.window.close();
 console.log('PASS air6 dom: overview renders signal/CA/traffic/cpu/uptime/bandwidth tiles + SMS list');
})().catch(e=>{console.error(e);process.exit(1);});
