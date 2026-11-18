/*
 * 桥接契约测试（Node 运行，不需要真机）
 *
 * 验证 iOS 垫片与 core.html 既有的 pending/回调协议能对上：
 *   AndroidCore.fetch(id,url,opts)  →  native  →  window.__fetchText(id,status,text)
 *   AndroidCore.evalJS(id,code)     →  native  →  window.__nativeDone({id,result})
 * 以及同步接口（kcGet / assetRead / nativePing / decodeSmsPdu）的行为。
 *
 * 运行: node test/bridge.contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

// ---- 伪造 WebView 环境 -------------------------------------------------------
global.window = global;
global.window.webkit = { messageHandlers: { fhcpe: { postMessage: (p) => posted.push(p) } } };
const posted = [];

const inline = /<script>([\s\S]*?)<\/script>/.exec(read('FHCpeBoard', 'assets', 'core.html'))[1];
eval(inline);

const shim = read('FHCpeBoard', 'Web', 'ShimRuntime.js');
global.__SmsPdu = require(path.join(root, 'FHCpeBoard', 'Web', 'SmsPdu.js'));
global.__IOS_KV = { LAN_WALLPAPER: 'abc' };
global.__IOS_ASSETS = { 'changelog.json': '{"logs":[]}' };
global.__IOS_VERSION = '1.4.3-local-52';
global.__IOS_LS = { theme: 'dark' };
eval(read('FHCpeBoard', 'Web', 'StorageShim.js'));
eval(shim);

// ---- Web 存储垫片 -----------------------------------------------------------
console.log('\n[Web 存储垫片]');
check('读到预置 localStorage', localStorage.getItem('theme') === 'dark');
check('length 反映条目数', localStorage.length === 1);
localStorage.setItem('wallpaper', 'abc');
check('setItem / getItem 立即可读', localStorage.getItem('wallpaper') === 'abc');
localStorage.theme = 'light';
check('属性式写入生效', localStorage.getItem('theme') === 'light');
check('属性式读取生效', localStorage.theme === 'light');
check('键遍历可见', Object.keys(localStorage).includes('wallpaper'));
localStorage.removeItem('wallpaper');
check('removeItem 生效', localStorage.getItem('wallpaper') === null);
check('sessionStorage 同样可用', typeof sessionStorage.setItem === 'function');
localStorage.clear();
check('clear 清空', localStorage.length === 0);

// ---- 同步接口 ---------------------------------------------------------------
console.log('\n[同步接口]');
check('assetRead 命中', AndroidCore.assetRead('changelog.json') === '{"logs":[]}');
check('assetRead 未命中返回空串', AndroidCore.assetRead('nope.js') === '');
check('kcGet 读到预置值', AndroidCore.kcGet('LAN_WALLPAPER') === 'abc');
check('kcGet 未知键返回空串', AndroidCore.kcGet('missing') === '');
AndroidCore.kcSet('LAN_PROFILES_V1', '{"activeId":"x"}');
check('kcSet 后本页立即可读', AndroidCore.kcGet('LAN_PROFILES_V1') === '{"activeId":"x"}');
check('kcSet 已上报 native', posted.some((p) => p.kind === 'kcset' && p.key === 'LAN_PROFILES_V1'));
AndroidCore.kcRemove('LAN_PROFILES_V1');
check('kcRemove 生效', AndroidCore.kcGet('LAN_PROFILES_V1') === '');

const ping = JSON.parse(AndroidCore.nativePing());
check('nativePing 版本号可被 replace 成正显示', '1.4.3-local-52'.replace(/^.*-local-/, 'LOCAL-') === 'LOCAL-52');
check('nativePing 标记 nativeCore:false（走兼容模式）', ping.nativeCore === false);

const sms = JSON.parse(AndroidCore.decodeSmsPdu('07911326040000F0040B911346610089F60000208062917314080CC8F71D14969741F977FD07'));
check('decodeSmsPdu 解出正文', sms.ok === true && sms.text === 'How are you?', JSON.stringify(sms));
check('decodeSmsPdu 方向判定', sms.outgoing === false);
check('decodeSmsPdu 坏输入返回 null 字符串', AndroidCore.decodeSmsPdu('QQ') === 'null');

// ---- 异步回调协议 -----------------------------------------------------------
console.log('\n[异步回调协议]');

(async () => {
  // fetch: 垫片只负责把请求交给 native，回执由 __fetchText 完成
  posted.length = 0;
  const fetchPromise = window.__nfetch('http://192.168.8.1/cgi-bin/luci', { method: 'GET', timeoutMs: 4000 });
  const fetchMsg = posted.find((p) => p.kind === 'fetch');
  check('fetch 请求已上报 native', !!fetchMsg, JSON.stringify(posted));
  check('fetch 带上 id / url / options', !!fetchMsg && !!fetchMsg.id && fetchMsg.url.endsWith('/cgi-bin/luci'));

  window.__fetchText(fetchMsg.id, 200, '{"ok":1}');
  const response = await fetchPromise;
  check('fetch 回执解析出 status', response.status === 200);
  check('fetch 回执 ok 判定', response.ok === true);
  check('fetch 回执正文可读', (await response.text()) === '{"ok":1}');

  // 传输层失败：status 0 + 原因键，core.html 应转成中文提示
  posted.length = 0;
  const failPromise = window.__nfetch('http://192.168.8.1/', {});
  const failMsg = posted.find((p) => p.kind === 'fetch');
  window.__fetchText(failMsg.id, 0, 'TLS_CERT_FAILED');
  let failError = null;
  try { await failPromise; } catch (e) { failError = e; }
  check('传输失败抛 NETWORK', failError && failError.code === 'NETWORK');
  check('传输失败转中文提示', failError && /证书无效/.test(failError.message), failError && failError.message);

  // evalJS: 结果按 JSON 文本回传，__nevalJS 负责解析
  posted.length = 0;
  const evalPromise = window.__nevalJS('return 1+1');
  const evalMsg = posted.find((p) => p.kind === 'evaljs');
  check('evalJS 请求已上报 native', !!evalMsg && /return 1\+1/.test(evalMsg.code || ''), evalMsg && evalMsg.code);
  window.__nativeDone(JSON.stringify({ id: evalMsg.id, result: '2' }));
  check('evalJS 结果被 JSON.parse', (await evalPromise) === 2);

  // 超时保护：不回执时按 core.html 的默认 60s 走，这里用显式 timeout 快速验证
  posted.length = 0;
  const timeoutPromise = window.__nfetch('http://192.168.8.1/', { timeoutMs: 1 });
  let timeoutError = null;
  try { await timeoutPromise; } catch (e) { timeoutError = e; }
  check('无回执时按 timeoutMs 超时', !!timeoutError && /超时/.test(timeoutError.message));

  // localStorage 写入合并后应落盘到 native
  posted.length = 0;
  localStorage.setItem('late', '1');
  await new Promise((resolve) => setTimeout(resolve, 350));
  check('Web 存储合并写入已落盘', posted.some((p) => p.kind === 'lssave' && /"late":"1"/.test(p.json || '')));

  console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项失败\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
