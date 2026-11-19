# 交给 AI 的任务说明（复制整段给它）

你要做的是：把这个 iOS 工程推到 GitHub，用 Actions 编出未签名 IPA，并把下载链接给我。

## 仓库与分支

- 仓库：`https://github.com/568379030/FHCpeBoard-iOS`（已存在，默认分支 `main`）
- 目标分支：**新建** `ios-air6-sample59`（**不要**直接推 main，也不要动 `android-air6-sample`、`air6-v4.2-sample`）
- 工作目录：本包根目录（有 `project.yml`、`FHCpeBoard/`、`scripts/`、`test/`、`.github/`）

## 步骤

```bash
git init -b ios-air6-sample59
git add -A
git commit -m "iOS: Air6 mapping/SMS layer + CI release build (sample59)"
git remote add origin https://github.com/568379030/FHCpeBoard-iOS.git
git push -u origin ios-air6-sample59
```

推送后会自动触发 `.github/workflows/build-ipa.yml`（`on.push.branches` 已包含该分支）。

## 需要你确认/回报的

1. **workflow 是否跑成功**：`https://github.com/568379030/FHCpeBoard-iOS/actions`
   - 失败时把失败的 step 名和错误行贴出来。常见失败点：
     - `xcodegen generate` 找不到 `project.yml`（说明没在包根目录推）
     - `xcodebuild` 报 Swift 编译错（贴出 `error:` 行）
     - `scripts/make-ipa.sh` 找不到 `.app`（检查 `build/Build/Products/Release-iphoneos/`）
2. **成功后给我两个东西**：
   - Actions 运行页 URL
   - Release 里 IPA 的下载 URL（workflow 会用 `softprops/action-gh-release` 建一个 `ios-air6-<run号>` 的 Release）

## 硬性约束（不要做）

- 不要把任何**设备口令/密码**写进仓库、workflow、代码或 README。
- 不要改 `project.yml` 里的 `CODE_SIGNING_ALLOWED: NO`（CI 只产未签名包；签名由用户侧完成）。
- 不要为了让编译通过而删除 `FHCpeBoard/assets/` 下的文件——那是运行时资源（含 393 KB 的 `fhcpeweb.html`）。
- 不要声称"iOS 白屏已修复"。这是已知未解决问题；若运行白屏，按下面方式取日志。

## 如果编出来装上白屏

App 内**三指长按 2 秒**会弹出屏幕诊断面板。请用户截图，重点看：

- `assets loaded: N files`（N 是否 >20，说明资源进包了）
- `MISSING SCRIPT: xxx.js`
- `runtime didFinish` 有没有出现
- `BOOT TIMEOUT: runtime 未在 8s 内产出页面`
- 任何 `[FHCpeBoard]` 开头的错误

拿到这些日志后，再改 `FHCpeBoard/App/WebHostViewController.swift`：
重点排查 (a) `__IOS_ASSETS` 注入体积过大导致 documentStart 脚本超时、(b) `loadHTMLString(baseURL: app://local/)`
的自定义 scheme 子资源加载、(c) `BridgeHost` 的 `loadHTML` 回调是否真的到达 runtime。

## 不需要额外做的事情

- UI 增强（`air6_ui.js`）与轮询逻辑（`lan_runtime.js`）已经随 `FHCpeBoard/assets/` 一起进包，
  由 `lan_runtime.boot()` 在运行时注入可见页，**不用**再改 `core.html`。
- 真机调试：iOS 16.4+ 已开 `isInspectable`，Mac Safari → 开发 → 设备 → 选 `runtime`/`page`。
