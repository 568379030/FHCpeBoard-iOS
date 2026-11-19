/* AIR6 firmware schema -> APP contract mapping.
 *
 * Pure functions only: no DOM, no network, no timers. This keeps the mapping
 * verifiable in node (test/air6.map.test.js) against the real-device samples
 * recorded in device/air6-adapter/02_字段映射表.md.
 *
 * Firmware contract (luci.air6modem v4.2):
 *   get_status -> {available,cached,cache_age,carriers[],ca{},imei,imsi,iccid,
 *                  sim,operator,registration,rat,signal,radio,temperature,
 *                  band,pci,arfcn,tac,cellid,cesq,network}
 *   get_cells  -> {stale,cells[{rat,role,band,pci,arfcn,rsrp,rsrq,sinr,rssi}],
 *                  carriers[],ca{}}
 *
 * APP contract: the updateData() fields documented in fhcpeweb.html.
 * Missing values stay null; 0 is never substituted for "unknown".
 */
(function(root){
 'use strict';
 const MB=1048576;
 function num(value){
  if(value===null||value===undefined||value==='')return null;
  const n=typeof value==='number'?value:Number(String(value).trim());
  return Number.isFinite(n)?n:null;
 }
 function int(value){const n=num(value);return n===null?null:Math.trunc(n);}
 /* The modem reports 255 for "not applicable" on MIMO/MCS fields. */
 function sentinel(value){const n=int(value);return n===null||n===255?null:n;}
 function ratKey(rat){
  const value=String(rat||'').toUpperCase();
  if(/NR|5G/.test(value))return 'nr';
  if(/LTE|4G/.test(value))return 'lte';
  return '';
 }
 /* NR bands are shown as n78, LTE bands as B3. This firmware sends the
    service band already prefixed ("n78", live 2026-11-18) while carriers[]
    send a bare number, so both forms must be accepted. */
 function bandLabel(band,rat){
  if(band===null||band===undefined||band==='')return null;
  const text=String(band).trim();
  if(/^[nN]\d+$/.test(text))return 'n'+text.slice(1);
  if(/^[bB]\d+$/.test(text))return 'B'+text.slice(1);
  const n=int(band);
  if(n===null||n<=0)return null;
  return (ratKey(rat)==='nr'?'n':'B')+n;
 }
 function bandwidthText(carrier){
  const dl=num(carrier&&carrier.dl_bandwidth_mhz),ul=num(carrier&&carrier.ul_bandwidth_mhz);
  if(dl===null&&ul===null)return null;
  if(dl===null)return '↑'+fmt(ul)+'MHz';
  if(ul===null||ul===dl)return fmt(dl)+'MHz';
  return fmt(dl)+'/'+fmt(ul)+'MHz';
 }
 function fmt(n){return Number.isInteger(n)?String(n):String(Math.round(n*10)/10);}
 /* get_status only exposes a human CESQ string, e.g.
    "RSSI=-71 dBm · RSRP=-83 dBm · RSRQ=-11 dB · SINR=17 dB". */
 function parseCesq(text){
  const out={},re=/(RSSI|RSRP|RSRQ|SINR)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  let match;
  while((match=re.exec(String(text||'')))!==null)out[match[1].toLowerCase()]=Number(match[2]);
  return out;
 }
 function formatUptime(seconds){
  const total=num(seconds);
  if(total===null||total<0)return null;
  const days=Math.floor(total/86400),hours=Math.floor(total%86400/3600),minutes=Math.floor(total%3600/60);
  if(days>0)return days+' 天 '+hours+' 小时';
  if(hours>0)return hours+' 小时 '+minutes+' 分';
  return minutes+' 分';
 }
 function servingCell(cells,rat){
  const list=Array.isArray(cells)?cells:[];
  const wanted=rat||'';
  return list.find(c=>String(c&&c.role)==='serving'&&(!wanted||ratKey(c.rat)===wanted))||
    list.find(c=>String(c&&c.role)==='serving')||null;
 }
 /* Serving-cell measurements with the CESQ string as fallback. */
 function measurements(status,cells,trustCells){
  const cesq=parseCesq(status&&status.cesq);
  const serving=trustCells?servingCell(cells):null;
  const pick=key=>{
   if(serving){const value=num(serving[key]);if(value!==null)return value;}
   const value=num(cesq[key]);
   return value===null?null:value;
  };
  return {rsrp:pick('rsrp'),rsrq:pick('rsrq'),sinr:pick('sinr'),rssi:pick('rssi'),cell:serving};
 }
 function mapCarriers(status,cells,trustCells,signal){
  const list=Array.isArray(status&&status.carriers)?status.carriers:[];
  const out=[];
  for(let index=0;index<list.length;index++){
   const carrier=list[index]||{};
   const role=String(carrier.role||'').toUpperCase();
   const primary=role==='PCC'||(!role&&index===0);
   const rat=ratKey(carrier.rat);
   out.push({
    type:primary?'PCC':'SCC',
    rat:rat,
    band:bandLabel(carrier.band,carrier.rat),
    bandwidth:bandwidthText(carrier),
    dlBandwidth:num(carrier.dl_bandwidth_mhz),
    ulBandwidth:num(carrier.ul_bandwidth_mhz),
    pci:int(carrier.pci),
    arfcn:int(carrier.arfcn),
    dlMimo:sentinel(carrier.dl_mimo),
    ulMimo:sentinel(carrier.ul_mimo),
    dlMcs:sentinel(carrier.dl_mcs),
    ulMcs:sentinel(carrier.ul_mcs),
    active:carrier.active===true?true:carrier.active===false?false:null,
    ulConfigured:carrier.ul_configured===true?true:carrier.ul_configured===false?false:null,
    /* Per-carrier gauges only exist for the primary carrier; firmware does not
       report measurements for SCC rows. */
    rsrp:primary?signal.rsrp:null,
    rsrq:primary?signal.rsrq:null,
    sinr:primary?signal.sinr:null,
    rssi:primary?signal.rssi:null,
    dlKbps:num(carrier.dl_kbytes_per_second),
    ulKbps:num(carrier.ul_kbytes_per_second),
    dlPeakMbps:peakMbps(carrier,'dl'),
    ulPeakMbps:peakMbps(carrier,'ul')
   });
  }
  if(!out.length&&signal.cell){
   /* SA/LTE without carrier aggregation still needs one PCC row, otherwise the
      overview gauges and the CA list stay empty. */
   out.push({
    type:'PCC',rat:ratKey(signal.cell.rat),band:bandLabel(signal.cell.band,signal.cell.rat),
    bandwidth:null,dlBandwidth:null,ulBandwidth:null,pci:int(signal.cell.pci),arfcn:int(signal.cell.arfcn),
    dlMimo:null,ulMimo:null,dlMcs:null,ulMcs:null,active:null,ulConfigured:null,
    rsrp:signal.rsrp,rsrq:signal.rsrq,sinr:signal.sinr,rssi:signal.rssi,
    dlKbps:null,ulKbps:null
   });
  }
  return out;
 }
 /* Theoretical peak for one carrier: bandwidth x spectral efficiency x layers.
    Labelled "理论峰值" in the UI; the firmware reports no negotiated AMBR. */
 function peakMbps(carrier,direction){
  const bw=num(carrier&&carrier.dl_bandwidth_mhz);
  if(bw===null||bw<=0)return null;
  const nr=ratKey(carrier&&carrier.rat)==='nr';
  /* 255 is the vendor "not applicable" sentinel and must not become 8 layers. */
  const layers=sentinel(direction==='dl'?carrier.dl_mimo:carrier.ul_mimo);
  const usable=layers===null||layers<=0?1:Math.min(layers,8);
  const perMhz=direction==='dl'?(nr?10:7.5):(nr?4:3);
  return Math.round(bw*perMhz*usable/2);
 }
 function caSummary(status,carriers){
  if(!carriers.length)return null;
  const ca=(status&&status.ca)||{};
  const active=ca.nr_active===true||ca.lte_active===true;
  const configured=num(ca.lte_configured_scc)!==null||num(ca.nr_configured_scc)!==null;
  const state=active?'载波聚合已激活':configured?'载波聚合未激活':'单载波';
  return carriers.length+'CC · '+state;
 }
 function mapCells(status,cells,trustCells){
  const list=trustCells&&Array.isArray(cells)?cells:[];
  return list.map(cell=>({
   rat:ratKey(cell.rat),
   band:bandLabel(cell.band,cell.rat),
   pci:int(cell.pci),
   earfcn:int(cell.arfcn),
   rsrp:num(cell.rsrp),
   rsrq:num(cell.rsrq),
   sinr:num(cell.sinr),
   rssi:num(cell.rssi),
   cellId:cell.cellid===undefined||cell.cellid===''?null:String(cell.cellid),
   plmn:cell.plmn?String(cell.plmn):null,
   isCarrier:String(cell.role)==='serving'
  }));
 }
 /* luci.getCPUUsage answers {"cpuusage":"7%"}; accept the bare number too. */
 function percent(value){
  if(value===null||value===undefined||value==='')return null;
  const n=num(String(value).replace('%',''));
  return n===null?null:Math.max(0,Math.min(100,n));
 }
 function mapSystem(system){
  if(!system)return {uptimeText:null,cpuUsage:null,ramUsage:null,load1:null};
  const memory=system.memory||{};
  const total=num(system.mem_total_kb)!==null?num(system.mem_total_kb):num(memory.total);
  const available=num(system.mem_available_kb)!==null?num(system.mem_available_kb):num(memory.available);
  let ramUsage=null;
  if(total&&available!==null&&total>0)ramUsage=Math.max(0,Math.min(100,(total-available)/total*100));
  const cpu=percent(system.cpu_percent!==undefined?system.cpu_percent:
   system.cpu_usage!==undefined?system.cpu_usage:system.cpuusage);
  const load=Array.isArray(system.load)?num(system.load[0]):num(system.load1);
  return {uptimeText:formatUptime(system.uptime),cpuUsage:cpu,ramUsage:ramUsage,load1:load};
 }
 function countersOf(payload){
  if(!payload)return null;
  const stats=payload.statistics||(payload.network&&payload.network.statistics)||null;
  if(!stats)return null;
  const rx=num(stats.rx_bytes),tx=num(stats.tx_bytes);
  if(rx===null&&tx===null)return null;
  return {rx:rx===null?0:rx,tx:tx===null?0:tx};
 }
 function dayKey(now){
  const date=new Date(now);
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
 }
 /* Device counters are cumulative since the interface came up. Today's usage is
    derived from a persisted per-day baseline; the baseline is re-armed when the
    day changes or the counters move backwards (reboot / reconnect). */
 function traffic(counters,store,now,uptimeSeconds){
  if(!counters)return null;
  const key=dayKey(now);
  let base=null;
  try{base=store&&store.get?JSON.parse(store.get('AIR6_TRAFFIC_BASE')||'null'):null;}catch(_){base=null;}
  const valid=base&&base.date===key&&num(base.rx)!==null&&num(base.tx)!==null&&base.rx<=counters.rx&&base.tx<=counters.tx;
  if(!valid){
   /* When the interface came up after midnight every byte in the counter was
      moved today, so today == cumulative. If it has been up since yesterday the
      split is unknowable and the baseline starts at the current value. */
   const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
   const up=num(uptimeSeconds);
   const upAt=up===null?null:now-up*1000;
   const allToday=upAt!==null&&upAt>=dayStart.getTime();
   base={date:key,rx:allToday?0:counters.rx,tx:allToday?0:counters.tx,armedAt:now,seenAt:now,gap:true};
   try{if(store&&store.set)store.set('AIR6_TRAFFIC_BASE',JSON.stringify(base));}catch(_){}
  }
  /* If the app was not running for a while the difference cannot be recovered;
     the number stays displayable but must be marked as incomplete. */
  const gap=!valid||(num(base.seenAt)!==null&&now-num(base.seenAt)>60000);
  const estimated=!!gap;
  base.seenAt=now;base.gap=estimated;
  try{if(store&&store.set)store.set('AIR6_TRAFFIC_BASE',JSON.stringify(base));}catch(_){}
  return {
   totalRxMB:counters.rx/MB,
   totalTxMB:counters.tx/MB,
   todayRxMB:(counters.rx-base.rx)/MB,
   todayTxMB:(counters.tx-base.tx)/MB,
   reset:!valid,
   estimated:estimated
  };
 }
 /* ---- bands (control page) -------------------------------------------- */
 function bandList(value){
  const list=Array.isArray(value)?value:String(value||'').split(/[\s,/]+/).filter(Boolean);
  const out=[];
  for(const item of list){const n=int(item);if(n!==null&&n>0&&out.indexOf(n)<0)out.push(n);}
  return out.sort((a,b)=>a-b);
 }
 function bands(getBands){
  const supported=(getBands&&getBands.supported)||{},current=(getBands&&getBands.current)||{};
  const ok=(supported.error===undefined||Number(supported.error)===0)&&(current.error===undefined||Number(current.error)===0);
  const lte=bandList(supported.LTE),nr=bandList(supported.NR);
  return {
   support_lte_band:lte.join('/'),
   support_nr_band:nr.join('/'),
   current_lte_band:bandList(current.LTE).join('/'),
   current_nr_band:bandList(current.NR).join('/'),
   readable:ok&&(lte.length>0||nr.length>0),
   error:ok?null:String(supported.error||current.error||'')
  };
 }
 /* get_bands only knows the *allowed* list; it cannot reveal whether the modem
    is currently camping on a subset, so the caller must not claim "已限制". */
 function bandsLimited(mapped){
  return !!(mapped&&mapped.readable&&mapped.current_lte_band&&mapped.support_lte_band&&
   mapped.current_lte_band!==mapped.support_lte_band)||
   !!(mapped&&mapped.readable&&mapped.current_nr_band&&mapped.support_nr_band&&
   mapped.current_nr_band!==mapped.support_nr_band);
 }
 /* ---- whole sample ---------------------------------------------------- */
 function sample(input){
  const options=input||{};
  const status=options.status||{};
  const cellsPayload=options.cells||{};
  const trustCells=!cellsPayload.stale&&Array.isArray(cellsPayload.cells)&&cellsPayload.cells.length>0;
  const signal=measurements(status,cellsPayload.cells,trustCells);
  const carriers=mapCarriers(status,cellsPayload.cells,trustCells,signal);
  const system=mapSystem(options.system);
  const trafficState=traffic(options.counters,options.store,options.now||Date.now(),
   (options.system&&options.system.uptime!==undefined?options.system.uptime:(status.network||{}).uptime));
  const network=status.network||{};
  const ipv4=(network['ipv4-address']||[])[0]||{};
  const wanIp=ipv4.address||null;
  const sim=String(status.sim||'').toUpperCase();
  const data={
   deviceOnline:true,
   deviceName:'SoftBank',
   deviceModel:'Air6',
   operator:status.operator||null,
   mode:status.rat||null,
   simState:status.sim||null,
   registration:status.registration||null,
   radio:status.radio||null,
   swVersion:'QWRT / AIR6',
   imei:status.imei||null,
   imsi:status.imsi||null,
   iccid:status.iccid||null,
   wanIp:wanIp,
   ipv6:(network['ipv6-address']||[]).map(v=>v&&v.address).filter(Boolean),
   uptime:num(network.uptime),
   carriers:carriers,
   caSummary:caSummary(status,carriers),
   peakDlMbps:carriers.reduce((sum,c)=>sum+(c.dlPeakMbps||0),0)||null,
   peakUlMbps:carriers.reduce((sum,c)=>sum+(c.ulPeakMbps||0),0)||null,
   allCells:mapCells(status,cellsPayload.cells,trustCells),
   cellsStale:!!cellsPayload.stale,
   cellCount:(cellsPayload.cells||[]).length,
   bandTag:bandLabel(status.band,status.rat),
   pci:int(status.pci),
   pccArfcn:int(status.arfcn),
   tac:status.tac||null,
   cellId:status.cellid||null,
   modemTemp:status.temperature===''||status.temperature===undefined?null:status.temperature,
   rsrp:signal.rsrp,
   rsrq:signal.rsrq,
   sinr:signal.sinr,
   rssi:signal.rssi,
   signalRaw:status.signal||null,
   cesq:status.cesq||null,
   cpuUsage:system.cpuUsage,
   ramUsage:system.ramUsage,
   uptimeText:system.uptimeText,
   load1:system.load1,
   /* The v4.2 firmware exposes no negotiated AMBR or QCI; keep them null so the
      UI can mark the tiles unsupported instead of printing 0. */
   dlAmbrMbps:null,
   ulAmbrMbps:null,
   qci:null,
   cacheAge:num(status.cache_age),
   updateTime:new Date(options.now||Date.now()).toLocaleString(),
   air6Traffic:null
  };
  if(trafficState){
   /* UI labels for Air6 are 累计下载 / 累计上传, so the cumulative counters are
      reported there and today's usage drives 今日已用. */
   data.monthRxToday=trafficState.totalRxMB;
   data.monthTxToday=trafficState.totalTxMB;
   data.todayRxToday=trafficState.todayRxMB;
   data.todayTxToday=trafficState.todayTxMB;
   data.air6Daily=null;
   data.trafficReset=trafficState.reset;
   /* "累计" here means since the cellular interface came up, never a calendar
      month; today's figure is an estimate whenever collection had gaps. */
   data.trafficScope='since-ifup';
   data.trafficEstimated=trafficState.estimated===true;
  }
  if(sim==='READY'&&!status.operator)data.operator=null;
  return data;
 }
 /* Speed is derived from per-carrier throughput, which the RIL already reports
    in KB/s. Returns null when the firmware gives no number at all. */
 function speed(status){
  const list=Array.isArray(status&&status.carriers)?status.carriers:[];
  let down=0,up=0,seen=false;
  for(const carrier of list){
   const d=num(carrier&&carrier.dl_kbytes_per_second),u=num(carrier&&carrier.ul_kbytes_per_second);
   if(d!==null){seen=true;down+=Math.max(0,d);}
   if(u!==null){seen=true;up+=Math.max(0,u);}
  }
  return seen?{down:down,up:up,source:'carriers'}:null;
 }
 /* Fallback for firmware builds without throughput fields: byte deltas. */
 function speedFromCounters(current,previous){
  if(!current||!previous)return null;
  const seconds=(current.at-previous.at)/1000;
  if(!(seconds>0.2))return null;
  const down=(current.rx-previous.rx)/1024/seconds,up=(current.tx-previous.tx)/1024/seconds;
  if(down<0||up<0)return null;
  return {down:Math.round(down*10)/10,up:Math.round(up*10)/10,source:'counters'};
 }
 const api={num,int,percent,sentinel,ratKey,bandLabel,peakMbps,parseCesq,formatUptime,measurements,
  mapCarriers,caSummary,mapCells,mapSystem,countersOf,traffic,bandList,bands,
  bandsLimited,sample,speed,speedFromCounters};
 root.Air6Map=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
