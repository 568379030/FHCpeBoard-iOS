import UIKit
import WebKit

/// 双 WebView 宿主：结构与 Android 版一一对应。
///
///   runtime（不可见）  加载 app://local/core.html —— 桥接垫片 + 协议栈 + 轮询
///        │  boot() 拼好完整 UI HTML，调用 AndroidCore.loadHTML
///        ▼
///   page（可见）       loadHTMLString(拼接后的 fhcpeweb.html)
///        │  AndroidBoard.postMessage → 回到 runtime.__onPageMessage
///        ▼
///   runtime 通过 __nevalJS 把数据推送进 page 的 UI 函数
final class WebHostViewController: UIViewController {
    private var runtime: WKWebView!
    private var page: WKWebView!
    private var runtimeBridge: BridgeHost!
    private var pageBridge: BridgeHost!
    private var pendingLoadID: String?

    private var versionString: String {
        (Bundle.main.object(forInfoDictionaryKey: "FHCpeBoardVersion") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
            ?? "1.4.3"
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildWebViews()
        loadRuntime()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        runtime.frame = view.bounds
        page.frame = view.bounds
    }

    // MARK: - 组装

    private func buildWebViews() {
        runtimeBridge = BridgeHost(role: .runtime)
        pageBridge = BridgeHost(role: .page)

        let runtimeScripts: [String] = [
            "window.__IOS_KV = \(jsLiteral(KeyValueStore.snapshot()));",
            "window.__IOS_ASSETS = \(jsLiteral(loadAssetTexts()));",
            "window.__IOS_VERSION = \(jsLiteral(versionString));",
            "window.__IOS_LS = \(jsLiteral(localStorageSnapshot()));",
            bundleScript(named: "StorageShim"),
            bundleScript(named: "SmsPdu"),
            bundleScript(named: "ShimRuntime")
        ]

        let wifi = wifiCacheSnapshot()
        let pageScripts: [String] = [
            "window.__IOS_WIFI = \(jsLiteral(wifi));",
            "window.__IOS_LS = \(jsLiteral(localStorageSnapshot()));",
            bundleScript(named: "StorageShim"),
            bundleScript(named: "ShimPage")
        ]

        runtime = makeWebView(bridge: runtimeBridge, scripts: runtimeScripts, opaque: false)
        page = makeWebView(bridge: pageBridge, scripts: pageScripts, opaque: true)
        page.navigationDelegate = self

        pageBridge.runtime = runtime
        runtimeBridge.page = page
        runtimeBridge.runtime = runtime

        pageBridge.onLoadHTML = { [weak self] id, html in
            guard let self = self else { return }
            self.pendingLoadID = id
            self.page.loadHTMLString(html, baseURL: AssetSchemeHandler.baseURL)
        }

        // runtime 必须留在视图层级里，否则 WKWebView 会挂起它的定时器；
        // 用 0.01 透明度压在最底层，用户看不到也点不到。
        runtime.alpha = 0.01
        runtime.isUserInteractionEnabled = false
        view.addSubview(runtime)
        view.addSubview(page)
    }

    private func makeWebView(bridge: BridgeHost, scripts: [String], opaque: Bool) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(AssetSchemeHandler(), forURLScheme: AssetSchemeHandler.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(bridge, name: BridgeHost.handlerName)
        for source in scripts where !source.isEmpty {
            controller.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        configuration.userContentController = controller

        let webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        // 页面自带 env(safe-area-inset-*) 处理（viewport-fit=cover），
        // 因此关掉 WebView 层级的自动内缩，避免出现双份留白。
        webView.isOpaque = opaque
        webView.backgroundColor = opaque ? .systemBackground : .clear

        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari 远程调试，真机排查用
        }
        return webView
    }

    private func loadRuntime() {
        runtime.load(URLRequest(url: AssetSchemeHandler.baseURL.appendingPathComponent("core.html")))
    }

    // MARK: - 资源

    private func assetRoot() -> URL? {
        Bundle.main.resourceURL?.appendingPathComponent("assets", isDirectory: true)
    }

    /// 读出 assets 目录下所有文本资源，作为 `AndroidCore.assetRead` 的同步数据源。
    private func loadAssetTexts() -> [String: String] {
        guard let root = assetRoot(),
              let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else {
            return [:]
        }
        var map: [String: String] = [:]
        for name in names where !name.hasPrefix(".") {
            let url = root.appendingPathComponent(name)
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            map[name] = text
        }
        return map
    }

    private func bundleScript(named name: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("[FHCpeBoard] missing script: %@.js", name)
            return ""
        }
        return text
    }

    /// 上次持久化的 Web 存储快照（localStorage / sessionStorage 垫片的数据源）。
    private func localStorageSnapshot() -> [String: Any] {
        guard let raw = KeyValueStore.get("LOCAL_STORAGE_V1"),
              let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            return [:]
        }
        return dictionary
    }

    private func wifiCacheSnapshot() -> [String: String] {        var result: [String: String] = [:]
        let prefix = "WIFI_CACHE_"
        for (key, value) in KeyValueStore.snapshot() where key.hasPrefix(prefix) {
            result[String(key.dropFirst(prefix.count))] = value
        }
        return result
    }

    private func jsLiteral(_ object: Any) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: []),
              let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text
    }
}

// MARK: - 导航回调

extension WebHostViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        resolvePendingLoad(result: "true")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        resolvePendingLoad(result: "null")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        resolvePendingLoad(result: "null")
    }

    private func resolvePendingLoad(result: String) {
        guard let id = pendingLoadID else { return }
        pendingLoadID = nil
        pageBridge.sendNativeDone(id: id, result: result)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // UI 包全部本地资源；主框架只允许 app:// 导航，其余交给系统浏览器。
        let scheme = navigationAction.request.url?.scheme?.lowercased()
        if navigationAction.targetFrame?.isMainFrame == true,
           let scheme = scheme,
           scheme != AssetSchemeHandler.scheme,
           scheme != "about" {
            if let url = navigationAction.request.url, scheme == "http" || scheme == "https" {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
