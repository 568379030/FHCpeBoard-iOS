'use strict';
/* SMS parsing against a real capture from the device
   (test/fixtures/sms-cmgl.txt, AT+CMGL text mode + UCS2 bodies). */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const S=require('../FHCpeBoard/assets/air6_sms');
const raw=fs.readFileSync(path.join(__dirname,'fixtures','sms-cmgl.txt'),'utf8');
const storageRaw=fs.readFileSync(path.join(__dirname,'fixtures','sms-storage.txt'),'utf8');

const rows=S.parse(raw);
assert.equal(rows.length,25,'25 +CMGL headers');
assert.ok(rows.every(r=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.time)),'timestamps normalised');
assert.equal(rows[0].number,'106860363999875');
assert.ok(rows[0].text.startsWith('【杭州溢六发发广告】'),'UCS2 body decoded');

/* Multipart concatenation */
const groups=S.group(rows);
assert.equal(groups.length,16);
assert.deepEqual(groups[0].indexes,[1,2,3]);
assert.equal(groups[0].parts,3);
assert.ok(groups[0].text.includes('充值金额为3000.00元'),'parts joined across the split');
assert.ok(groups[0].text.length>rows[0].text.length,'merged text longer than a single part');
assert.equal(groups[1].indexes.length,1);

/* Contract payload */
const payload=S.payload(rows);
assert.equal(payload.recv.length,16);
assert.equal(payload.send.length,0);
assert.equal(payload.recv[0].Index,'r1_2_3');
assert.equal(payload.recv[0].Sender,'106860363999875');
assert.equal(payload.recv[0].Isopened,'1');
assert.ok(payload.refs['r1_2_3'].indexes.join(',')==='1,2,3','storage indexes recoverable for delete/read');

/* Unread detection + sent direction on synthesised rows */
const mixed=S.parse([
 '+CMGL: 7,"REC UNREAD","+8613800138000","","2026/11/18 09:00:00+32"',
 '4F60597D',
 '+CMGL: 8,"STO SENT","10690000","","2026/11/18 09:05:00+32"',
 '4F60597D'
].join('\r\n'));
const mixedGroups=S.group(mixed);
assert.equal(mixedGroups[0].unread,true);
assert.equal(mixedGroups[0].text,'你好');
assert.equal(mixedGroups[1].outgoing,true);
const mixedPayload=S.payload(mixed);
assert.equal(mixedPayload.recv[0].Isopened,'0');
assert.equal(mixedPayload.send[0].Receiver,'10690000');

/* Storage + fallback for non-hex bodies */
assert.deepEqual(S.storage(storageRaw),{location:'MT',used:25,total:100});
assert.equal(S.decodeBody('Hello 5G').text,'Hello 5G');
console.log('PASS air6 sms: header/time/UCS2/multipart/unread/sent/storage');
