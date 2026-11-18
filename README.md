# FHCpeBoard iOS 移植版

从 Android APK（`FHCpeBoard-1.4.3-local-52-release.apk`）逆向还原的 iOS 版本。

原应用是「WebView 套壳 + 轻原生」结构：UI 与全部业务逻辑都在 `assets/` 里的 HTML/JS，
原生层只提供 14 个桥接方法和 1 个真正有逻辑的 JNI 函数（SMS PDU 解码）。
因此这里**原样复用全部 Web 资源**，只重写了一层 Swift 外壳。

```
┌──────────────────────────────────────────────┐
│ WebHostViewController                       │
│                                             │
│  runtime（不可见）  app://local/core.html    │
│    StorageShim.js  ← localStorage 持久化垫片 │
│    SmsPdu.js       ← 替代 libfhcpecore.so   │
│    ShimRuntime.js  ← 替代 AndroidCore       │
│         │ loadHTML(拼好的 UI)                │
│         ▼                                   │
│  page（可见）      ShimPage.js ← AndroidBoard│
│         │ postMessage → __onPageMessage      │
│         ▼                                   │
│  BridgeHost ──→ HttpEngine / KeyValueStore   │
└──────────────────────────────────────────────┘
```

---

## 一、在 GitHub 上出包（不需要 Mac）

Windows 上编译不了 iOS 二进制（需要 Apple 工具链），所以用 Actions 的 macOS runner 构建。

**1. 建仓库并推上去**（建议设为 **private**）

```bash
cd FHCpeBoard-iOS
git init
git add .
git commit -m "port FHCpeBoard 1.4.3-local-52 to iOS"
git branch -M main
git remote add origin git@github.com:<你的账号>/FHCpeBoard-iOS.git
git push -u origin main
```

**2. 等 Actions 跑完**

推送后自动触发 `build-unsigned-ipa`（约 5–10 分钟）。
在仓库的 **Actions** 页面 → 选中这次运行 → 底部 **Artifacts** → 下载
`FHCpeBoard-unsigned-ipa`，里面是 `FHCpeBoard-1.4.3-local-52-unsigned.ipa`。

> 私有仓库的 macOS runner 按 10 倍计费，免费额度 2000 分钟/月 ≈ 20 次构建；
> 公开仓库不计费。若代码敏感，请保持 private。

**3. 自己签名安装**

| 平台 | 工具 | 说明 |
|---|---|---|
| Windows | Sideloadly（需先装 iTunes）/ 爱思助手 | 用免费 Apple ID 即可 |
| macOS | Sideloadly / AltStore | 需要 Apple ID |

安装前确认：**设置 → 隐私与安全性 → 开发者模式 → 打开 → 重启**（iOS 16+ 必须）。
免费证书 **7 天**有效，到期重签即可，数据保留。

默认 Bundle ID 是 `com.fhcpeboard.ios`；要改的话编辑 `project.yml` 里的
`PRODUCT_BUNDLE_IDENTIFIER` 后重新推送。

---

## 二、有 Mac 时本地构建

```bash
brew install xcodegen
xcodegen generate
xcodebuild -project FHCpeBoard.xcodeproj -scheme FHCpeBoard \
  -configuration Release -sdk iphoneos -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO
bash scripts/make-ipa.sh
```

有开发者证书的话，把 `project.yml` 里的 `CODE_SIGNING_ALLOWED` 改回 `YES`、
填上 `DEVELOPMENT_TEAM`，Xcode 里 Archive 就能直接出可安装包。

---

## 三、本地测试（Windows 可跑，不需要真机）

```bash
node test/bridge.contract.test.js
```

32 项断言，覆盖桥接回调协议（`__fetchText` / `__nativeDone`）、同步接口语义、
SMS PDU 解码（7-bit / UCS2 / 字母数字发件人）、Web 存储垫片。
改完 JS 先跑这个，比反复装机快得多。

---

## 四、与原版的差异（必读）

1. **SMS PDU 解码改由 JS 实现**（`SmsPdu.js`，3GPP TS 23.038/23.040）。
   原 `libfhcpecore.so` 只有 3 个 JNI 导出，其中唯一有逻辑的就是这个函数，
   其余 87% 是静态链接的 libc++。iOS 端因此完全不需要原生库，
   `nativePing()` 返回 `nativeCore:false`，界面版本号会显示「**兼容模式**」——
   这是 `lan_runtime.js` 里本来就存在的降级分支，不是硬改。
2. **localStorage / sessionStorage 被垫片接管**。`app://` 在 WKWebView 里是
   opaque origin，直接访问会抛 SecurityError 让 UI 启动即崩。垫片把它们接到原生 KV，
   写入做了 250ms 合并。
3. **大响应不落临时文件**。原版 `fileRead` 读临时文件传大响应，这里统一走内存文本
   （`fileRead` 返回空串，设备响应最大也就几百 KB）。
4. **后台不刷新**。iOS 会挂起后台 JS；原逻辑本身就是前台 3/5/8 秒轮询，影响有限。
5. **uiFlavor 固定为 `coui`**，保持 `android_ui.css` 里 23 条 `[data-native-ui=coui]` 选择器生效。

## 五、首次运行

1. 启动后会弹「**允许访问本地网络**」→ 必须允许（否则连不上 CPE，且不会再弹第二次，
   需要去 设置 → 隐私与安全性 → 本地网络 手动打开）。
2. 填设备地址（`192.168.8.1` / `https://air6.example.com` 等）与账号密码。

## 六、排错

- **白屏**：Safari → 开发 → 你的 iPhone → 选中 WebView 看 Console
  （`isInspectable` 已在 16.4+ 打开）。
- **一直转圈 / 登录失败**：`Info.plist` 已开 `NSAllowsArbitraryLoads` 与
  `NSAllowsLocalNetworking`；确认手机和 CPE 在同一网段、没开 VPN。
- **构建失败**：先看 `xcodegen generate` 是否成功，再看 `xcodebuild` 日志里第一个 `error:`。
- **装完闪退**：多半是签名不匹配（Bundle ID 与描述文件不一致），重签时清掉旧描述文件。

## 七、安全说明

- CPE 账号密码存在 `UserDefaults`（与原版 SharedPreferences 同级别，未额外加密）。
  要更强保护，把 `KeyValueStore` 改成 `kSecClassGenericPassword` 的 Keychain 实现。
- 别把带真实设备口令的提交推到公开仓库。
- 移植与分发前请确认你对该应用/资源有处置权（自研或内部应用则无碍）。
