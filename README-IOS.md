# AIR6 iOS 客户端源码（sample59）

这是把安卓侧这一轮的全部 Air6 能力接到 iOS 壳上的源码包。**本机没有 macOS/Xcode，无法在本地编译**，
所以交付方式是"推 GitHub → Actions 出 IPA"。

## 1. 为什么我没直接帮你推

我用 GitHub 连接器试过创建分支：

```
POST /repos/568379030/FHCpeBoard-iOS/git/refs  →  403 Resource not accessible by integration
```

当前连接器对该仓库只有读权限，所以推送必须由你（或另一个有写权限的 AI/账号）执行。下面的命令可以直接复制。

## 2. 推送命令（任选一种）

**A. 用 git（推荐，最稳）**

```bash
cd <解压后的 AIR6-ios-src-sample59>
git init -b ios-air6-sample59
git add -A
git commit -m "iOS: Air6 mapping/SMS layer + CI release build (sample59)"
git remote add origin https://github.com/568379030/FHCpeBoard-iOS.git
git push -u origin ios-air6-sample59
```

推送后 `.github/workflows/build-ipa.yml` 会因为 `branches: [..., ios-air6-sample59]` 自动触发。

**B. 直接把文件拖进 GitHub 网页**（新建同名分支后逐个上传也可以，但注意 `FHCpeBoard/assets/` 有 20+ 个文件）。

## 3. CI 会做什么

`.github/workflows/build-ipa.yml`：

1. `node test/adapter.tasks.test.js` + 断言 `air6_map.js` / `air6_sms.js` 能被 require（防止 JS 语法退化）；
2. `brew install xcodegen` → `xcodegen generate`（工程由 `project.yml` 生成，不提交 .xcodeproj）；
3. `xcodebuild -sdk iphoneos CODE_SIGNING_ALLOWED=NO`（未签名）；
4. `bash scripts/make-ipa.sh` 打 `dist/*.ipa`；
5. 上传 artifact **并自动创建一个 Release**（标签 `ios-air6-<run号>`），Release 里的 IPA 可以直接下载，不需要登录也能拿链接（私有仓库仍需登录）。

## 4. 装到 iPhone 上

CI 产出的是**未签名 IPA**，不能直接双击安装，需要侧载工具之一：

- **Sideloadly**（Windows/macOS，需 Apple ID 免费签名，7 天有效）
- **AltStore / SideStore**
- **TrollStore**（仅特定 iOS 版本，可永久）
- 有开发者证书时，用 Xcode 打开工程填 `DEVELOPMENT_TEAM` 改成 `CODE_SIGNING_ALLOWED: YES` 直接真机跑

## 5. 这版 iOS 里有什么 / 没有什么

**已接入**（与安卓 sample59 共用同一套 JS）：

- `air6_map.js`：信号/载波聚合/小区/流量/CPU/内存/uptime 全字段映射，`null` 不填 0
- `air6_rpc.js`：`/ubus/` + `session.login` 引擎，错误分类、缺失方法只探测一次、写任务、短信、控制面板
- `air6_sms.js`：AT+CMGL / UCS2 / UDH 分片解析
- `adapter_tasks.js`：`air6-task` 提交 → 轮询 → `confirm_cell` 原 task_id，含确认超时回读
- `core.html`：加载顺序已包含上面两个新脚本

**同样已包含**（都是 `lan_runtime.boot()` 运行时注入到可见页的，iOS/安卓共用同一份资源）：

- `air6_ui.js`：AMBR 瓦片改"理论峰值↓/↑"、数据新鲜度与过期提示、待确认任务卡片（含设备名/操作/剩余时间）
- `lan_runtime.js`：登录与回前台时的待办任务扫描、轮询单飞与旧会话丢弃
- `air6_ui.css` 之外的样式仍在 `fhcpeweb.html` 内联，无需额外资源

**iOS 与安卓的差异只在原生壳**：安卓用 `MainActivity`（`@JavascriptInterface`），iOS 用
`WebHostViewController` + `BridgeHost` + `AssetSchemeHandler`（`WKScriptMessageHandler` + 自定义 scheme）。

**已知未解决问题：iOS 启动白屏（BOOT_TIMEOUT）**。
这个包没有改变原有启动链路（双 WebView + `app://local` scheme handler + 注入 `__IOS_ASSETS`），
所以**白屏可能仍然存在**——我无法在本地验证，也不宣称已修好。如果装上后是白屏：

1. 在 App 内**三指长按 2 秒**，会弹出屏幕日志面板（`WebHostViewController.installDiagnostics`）；
2. 把面板里的日志（尤其 `runtime didFinish` / `BOOT TIMEOUT` / `MISSING SCRIPT` / `assets loaded: N files`）
   截图或复制出来，下一轮据此定位；
3. 也可以在 Mac 上用 Safari → 开发 → 你的 iPhone → 检查 `runtime` 与 `page` 两个 WebView（iOS 16.4+ 已开 `isInspectable`）。

## 6. 结构

```
project.yml                 XcodeGen 工程描述（sources / resources / 签名开关）
FHCpeBoard/
  App/                      AppDelegate、WebHostViewController（双 WebView + 诊断面板）
  Core/                     HttpEngine（URLSession）、KeyValueStore
  Web/                      AssetSchemeHandler、BridgeHost、Shim{Runtime,Page}.js、SmsPdu.js、DiagHook.js、StorageShim.js
  assets/                   ★ 与安卓共用：air6_rpc / air6_map / air6_sms / adapter_tasks / lan_* / fhcpeweb.html …
  Info.plist
scripts/make-ipa.sh         把 .app 打成未签名 IPA
test/adapter.tasks.test.js  CI 里跑的契约测试
.github/workflows/build-ipa.yml
```

## 7. 版本

`MARKETING_VERSION 1.4.8` / `CURRENT_PROJECT_VERSION 59` / `FHCpeBoardVersion 1.4.8-local-59-ios`。
