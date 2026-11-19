'use strict';
/* Mapping checks against the real-device samples in
   device/air6-adapter/02_字段映射表.md (2026-11-18, NR5G-SA, n78). */
const assert=require('assert');
const M=require('../FHCpeBoard/assets/air6_map');

const status={
 available:true,cached:true,cache_age:3,source:'qlril-ubus',api_errors:{},
 carriers:[
  {rat:'NR',role:'PCC',band:78,pci:786,arfcn:633984,dl_bandwidth_mhz:100,ul_bandwidth_mhz:100,
   dl_mimo:2,ul_mimo:255,dl_mcs:11,ul_mcs:255,dl_kbytes_per_second:455,ul_kbytes_per_second:182,active:true,ul_configured:true,state:1},
  {rat:'NR',role:'SCC',band:78,pci:135,arfcn:633984,dl_bandwidth_mhz:100,ul_bandwidth_mhz:null,
   dl_mimo:1,ul_mimo:255,dl_mcs:9,ul_mcs:255,dl_kbytes_per_second:300,ul_kbytes_per_second:0,active:false,ul_configured:false,state:1}
 ],
 ca:{valid:true,query_status:'ok',raw_lte_pcc_count:0,raw_nr_pcc_count:1,lte_active:false,nr_active:false,lte_active_scc:0,nr_active_scc:0,lte_configured_scc:0,nr_configured_scc:1},
 imei:'860000000000076',imsi:'460110000000000',iccid:'89860000000000000000',
 sim:'READY',operator:'中国联通',registration:'registered',register_detail:'YES',rat:'NR5G-SA',
 signal:'-83',radio:'ONLINE',temperature:'44.8',band:'78',pci:'786',arfcn:'633984',tac:'7699969',cellid:'31559176213',
 cesq:'RSSI=-71 dBm · RSRP=-83 dBm · RSRQ=-11 dB · SINR=17 dB',
 network:{up:true,uptime:1200,proto:'ql_datacall',l3_device:'rmnet_data0','ipv4-address':[{address:'10.1.2.3',mask:30}]}
};
const cellsPayload={
 stale:false,
 cells:[
  {rat:'NR',role:'serving',band:78,pci:786,arfcn:633984,cellid:'31559176213',tac:'7699969',plmn:'46011',rsrp:-82,rsrq:-12,sinr:13,rssi:-71},
  {rat:'NR',role:'neighbor',band:null,pci:40,arfcn:633984,cellid:null,tac:null,plmn:'',rsrp:-94,rsrq:-13,sinr:5,rssi:null}
 ],
 carriers:status.carriers,ca:status.ca
};
const system={uptime:3725,memory:{total:512000,free:100000,available:204800},load:[0.4,0.3,0.2]};
const store=()=>{const m=new Map();return {get:k=>m.get(k)||'',set:(k,v)=>m.set(k,v)};};

// 1. Carrier aggregation mapping
const carriers=M.mapCarriers(status,cellsPayload.cells,true,M.measurements(status,cellsPayload.cells,true));
assert.equal(carriers.length,2);
assert.deepEqual(carriers.map(c=>c.type),['PCC','SCC']);
assert.deepEqual(carriers.map(c=>c.band),['n78','n78']);
assert.equal(carriers[0].bandwidth,'100MHz');
assert.equal(carriers[1].bandwidth,'100MHz');
assert.equal(carriers[0].ulMimo,null,'255 sentinel must map to null');
assert.equal(carriers[0].ulMcs,null);
assert.equal(carriers[0].rsrp,-82,'PCC gauges come from the serving cell');
assert.equal(carriers[1].rsrp,null,'SCC has no independent measurements');

// 2. caSummary
assert.match(M.caSummary(status,carriers),/^2CC · /);

// 3. Cell list keeps serving flags and blank neighbour fields
const cells=M.mapCells(status,cellsPayload.cells,true);
assert.equal(cells.length,2);
assert.deepEqual(cells.map(c=>c.isCarrier),[true,false]);
assert.equal(cells[1].band,null);
assert.equal(cells[1].rssi,null);
assert.equal(cells[0].earfcn,633984);

// 4. Stale cells fall back to the CESQ string instead of showing last values
const stale=M.measurements(status,cellsPayload.cells,false);
assert.equal(stale.rsrp,-83);
assert.equal(stale.sinr,17);
assert.equal(M.mapCells(status,cellsPayload.cells,false).length,0);

// 5. No carriers -> one synthesised PCC so gauges still render
const solo=M.mapCarriers({...status,carriers:[]},cellsPayload.cells,true,M.measurements(status,cellsPayload.cells,true));
assert.equal(solo.length,1);
assert.equal(solo[0].type,'PCC');
assert.equal(solo[0].rsrp,-82);

// 5b. Live form: status.band arrives already prefixed and CPU as "7%"
assert.equal(M.bandLabel('n78','NR5G-SA'),'n78');
assert.equal(M.bandLabel('B3','LTE'),'B3');
assert.equal(M.bandLabel(78,'NR'),'n78');
assert.equal(M.bandLabel(3,'LTE'),'B3');
assert.equal(M.mapSystem({uptime:60,cpuusage:'7%',memory:{total:1000,available:500}}).cpuUsage,7);

// 6. Bands normalisation (real get_bands payload)
const bands=M.bands({supported:{error:0,LTE:[1,3,5,7,8,20,28,38,40,41,42,43],NR:[1,3,5,7,8,20,28,38,40,41,77,78,79]},
 current:{error:0,LTE:[1,3,5,7,8,20,28,38,40,41,42,43],NR:[1,3,5,7,8,20,28,38,40,41,77,78,79]}});
assert.equal(bands.support_lte_band,'1/3/5/7/8/20/28/38/40/41/42/43');
assert.equal(bands.support_nr_band,'1/3/5/7/8/20/28/38/40/41/77/78/79');
assert.equal(bands.readable,true);
assert.equal(M.bandsLimited(bands),false);
assert.equal(M.bands({supported:{error:5},current:{error:5}}).readable,false);

// 7. Traffic baseline: first read reports 0 today, then the delta, then re-arms
const s1=store();
const t1=M.traffic({rx:500*1048576,tx:100*1048576},s1,new Date('2026-11-18T10:00:00+08:00').getTime());
assert.equal(Math.round(t1.todayRxMB),0);
assert.equal(Math.round(t1.totalRxMB),500);
const t2=M.traffic({rx:540*1048576,tx:110*1048576},s1,new Date('2026-11-18T11:00:00+08:00').getTime());
assert.equal(Math.round(t2.todayRxMB),40);
assert.equal(t2.reset,false);
const t3=M.traffic({rx:5*1048576,tx:1*1048576},s1,new Date('2026-11-18T12:00:00+08:00').getTime());
assert.equal(t3.reset,true,'counter going backwards must re-arm the baseline');
const t4=M.traffic({rx:9*1048576,tx:2*1048576},s1,new Date('2026-11-19T01:00:00+08:00').getTime());
assert.equal(t4.reset,true,'a new day must re-arm the baseline');

// 7b. Interface that came up after midnight: today == cumulative
const s2=store();
const morning=new Date('2026-11-18T09:00:00+08:00').getTime();
const t5=M.traffic({rx:300*1048576,tx:40*1048576},s2,morning,3600); /* up 1h */
assert.equal(Math.round(t5.todayRxMB),300,'interface started today -> all traffic is today');
assert.equal(Math.round(t5.totalRxMB),300);
const t6=M.traffic({rx:320*1048576,tx:45*1048576},s2,new Date('2026-11-18T10:00:00+08:00').getTime(),7200);
assert.equal(Math.round(t6.todayRxMB),320);
// Interface up since yesterday: split unknown, baseline starts now
const s3=store();
const t7=M.traffic({rx:900*1048576,tx:90*1048576},s3,morning,3*86400);
assert.equal(Math.round(t7.todayRxMB),0,'multi-day uptime cannot be split, show 0 until it grows');

// 8. System mapping covers both ubus `system info` and adapter get_system
const ubus=M.mapSystem(system);
assert.equal(ubus.uptimeText,'1 小时 2 分');
assert.equal(Math.round(ubus.ramUsage),60);
assert.equal(ubus.cpuUsage,null,'system info has no CPU percentage');
const adapter=M.mapSystem({uptime:90061,cpu_percent:23.4,mem_total_kb:1000,mem_available_kb:250});
assert.equal(adapter.uptimeText,'1 天 1 小时');
assert.equal(adapter.cpuUsage,23.4);
assert.equal(Math.round(adapter.ramUsage),75);

// 9. Speed from carrier throughput
assert.deepEqual(M.speed(status),{down:755,up:182,source:'carriers'});
assert.equal(M.speed({carriers:[{dl_kbytes_per_second:null}]}),null);
assert.deepEqual(M.speedFromCounters({rx:2048*1024,tx:1024*1024,at:2000},{rx:1024*1024,tx:1024*1024,at:1000}),{down:1024,up:0,source:'counters'});

// 9b. Degraded modem (live 2026-11-19: not registered, SIM unknown, 0 carriers)
const degraded=M.sample({status:{available:true,rat:'NR5G-SA',operator:'',band:'',temperature:'56.7',sim:'unknown',
 registration:'not registered',radio:'ONLINE',cesq:'',carriers:[],network:{up:false,pending:true}},cells:{stale:true,cells:[]},system:{uptime:600},counters:null,store:store(),now:Date.now()});
assert.equal(degraded.deviceOnline,true,'page still renders when the modem has no service');
assert.equal(degraded.operator,null);
assert.equal(degraded.bandTag,null);
assert.deepEqual(degraded.carriers,[]);
assert.equal(degraded.rsrp,null);
assert.equal(degraded.caSummary,null);

// 10. Full sample
const sample=M.sample({status,cells:cellsPayload,system,counters:{rx:1024*1048576,tx:256*1048576},store:store(),now:new Date('2026-11-18T11:00:00+08:00').getTime()});
assert.equal(sample.deviceOnline,true);
assert.equal(sample.operator,'中国联通');
assert.equal(sample.mode,'NR5G-SA');
assert.equal(sample.bandTag,'n78');
assert.equal(sample.rsrp,-82);
assert.equal(sample.sinr,13);
assert.equal(sample.rssi,-71);
assert.equal(sample.wanIp,'10.1.2.3');
assert.equal(sample.modemTemp,'44.8');
assert.equal(sample.carriers.length,2);
assert.equal(sample.allCells.length,2);
assert.equal(sample.dlAmbrMbps,null,'unknown AMBR must stay null, never 0');
assert.equal(sample.qci,null);
assert.equal(sample.uptimeText,'1 小时 2 分');
assert.equal(Math.round(sample.monthRxToday),1024);
assert.equal(Math.round(sample.todayRxToday),1024,'interface up 1200s today -> cumulative counts as today');
console.log('PASS air6 map: CA/gauges/cells/bands/traffic/system/sample');
