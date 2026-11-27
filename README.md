# FHCpeBoard AIR6 本地版（Android）

按原 `FHCpeBoard-1.4.3-local-52-release.apk` **全功能复刻**的纯本地 Android App，
针对 AIR6 / QWRT（OpenWrt + LuCI）设备优化。

## 与原版的关系

原 APK 是"WebView 套壳 + 轻原生"：全部 UI 和业务逻辑在 `assets/`（HTML/JS/CSS），
原生层只做短信 PDU 解码。本复刻：

- **UI 与协议栈**：原样复用（`app/src/main/assets/` 下的文件与原 APK 逐字节一致）
- **原生外壳**：用 Kotlin 重写（等价复刻 `AndroidCore` 14 方法 + `AndroidBoard` 4 方法）
- **关键改造**：强制走 AIR6/LuCI 线路（`fhLine:'air6'`），跳过原版的 FiberHome 私有协议探测
- **预置设备**：默认 `192.168.99.1` / `root` / `password`，打开即用

## 功能（40 项，全部保留）

| 类别 | 功能 |
|---|---|
| 概览 | 信号(RSRP/RSRQ/RSSI/SINR)、网络制式(SA/NSA/5G-A)、载波聚合、服务/邻小区、实时速率、流量统计、CPU/温度、WAN 详情、设备信息、WiFi 状态 |
| 控制 | 网络模式、锁频段、单/多小区锁定、射频功率、CFUN、IMEI、USB 模式、WiFi 设置、设备限速、LED、重启、AT 指令台 |
| 短信 | 列表/会话/收发、删除/已读、转发配置(Server酱/SMTP)、自动清理、存储位置、本地缓存 |
| 自动化 | 定时任务(cron)、任务预览、锁频/小区自动回退 |
| 系统 | OTA 升级、登录配置管理、自动登录/断线重连、探针看板、主题壁纸、缓存管理 |

## 工程结构

```
app/src/main/
├── java/com/fhcpeboard/air6local/
│   ├── MainActivity.kt          双 WebView 宿主 + 预置配置
│   ├── Bridge.kt                AndroidCore / AndroidBoard 桥接
│   ├── HttpEngine.kt            OkHttp + 明文 HTTP 放行
│   ├── PersistentCookieJar.kt   LuCI sysauth 会话持久化
│   ├── SmsPdu.kt                PDU 解码器（Kotlin 移植，已交叉验证）
│   └── Store.kt                 SharedPreferences KV
├── assets/                      原 APK 资源，原样复用
└── res/                         图标/主题/网络安全配置
```

## 构建

本机无 JDK/Android SDK，走 GitHub Actions 云端构建：

```bash
git init && git remote add origin <你的仓库地址>
git add . && git commit -m "AIR6 local port"
git push -u origin main
```

Actions 跑完在 Artifacts 下载 `FHCpeBoard-AIR6-local-APK`（已签名，可直接安装）。

本地构建（需 JDK 17 + Android SDK 34）：

```bash
gradle assembleRelease
```

## 验证状态

- ✅ 全部 12 个 JS 资源 `node --check` 通过
- ✅ 启动链路本地模拟：`boot() → loadHTML` 成功产出 673KB 页面，无 JS 报错
- ✅ PDU 解码器 Kotlin 移植与 JS 版交叉验证一致（经典样本 "How are you?" / UCS2 / 字母数字）
- ⏳ Swift/Kotlin 真机联调：设备当前不在线，待接回局域网后验证

## 注意

- 首次启动有 1~2 秒白屏属正常（在加载 673KB 内嵌页面）
- 默认账号 `root/password` 可在 App 内"我的→登录配置"修改
- 登录态持久化在 SharedPreferences，重启不用重新输密码
- 复刻自用请确认对原应用有处置权
