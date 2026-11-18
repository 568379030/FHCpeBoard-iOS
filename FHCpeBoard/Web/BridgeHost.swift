import Foundation
import WebKit

/// JS ↔ native 的调度中心。
///
/// 两个 WebView 各挂一个实例：
///   - `.runtime`：隐藏的 `core.html`，拥有完整桥接能力（对应 Android 的 AndroidCore）
///   - `.page`   ：可见页面，只需要把 UI 动作回传给 runtime（对应 AndroidBoard.postMessage）
///
/// 所有“同步返回”的接口（kcGet / assetRead / decodeSmsPdu / nativePing）都在注入的
/// JS 垫片里就地实现，不走这里 —— WKWebView 没有同步 JS→native 通道，这是唯一的
/// 干净做法。
final class BridgeHost: NSObject, WKScriptMessageHandler {
    enum Role { case runtime, page }

    static let handlerName = "fhcpe"

    let role: Role
    weak var runtime: WKWebView?
    weak var page: WKWebView?

    /// loadHTML 需要等导航真正完成再回执，交给持有 delegate 的控制器处理。
    var onLoadHTML: ((_ id: String, _ html: String) -> Void)?

    init(role: Role) {
        self.role = role
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        let id = BridgeHost.string(body["id"])

        switch kind {
        case "fetch":
            guard let url = body["url"] as? String else { return }
            HttpEngine.shared.fetch(urlString: url, optionsJSON: body["options"] as? String) { [weak self] result in
                self?.callRuntime("window.__fetchText", args: [id, result.status, result.text])
            }

        case "evaljs":
            evaluate(js: body["code"] as? String ?? "", id: id)

        case "loadhtml":
            onLoadHTML?(id, body["html"] as? String ?? "")

        case "kcset":
            KeyValueStore.set(BridgeHost.string(body["key"]), BridgeHost.string(body["value"]))

        case "kcremove":
            KeyValueStore.remove(BridgeHost.string(body["key"]))

        case "post":
            let json = body["json"] as? String ?? "{}"
            runtime?.evaluateJavaScript("window.__onPageMessage && window.__onPageMessage(\(json));") { _, _ in }

        case "wificacheset":
            let scope = BridgeHost.string(body["scope"])
            KeyValueStore.set("WIFI_CACHE_" + scope, BridgeHost.string(body["json"]))

        case "lssave":
            // localStorage / sessionStorage 垫片的整体落盘（写入已在 JS 侧合并）
            KeyValueStore.set("LOCAL_STORAGE_V1", BridgeHost.string(body["json"]))

        case "clearcaches":
            URLCache.shared.removeAllCachedResponses()
            HTTPCookieStorage.shared.removeCookies(since: .distantPast)
            let tmp = FileManager.default.temporaryDirectory
            if let items = try? FileManager.default.contentsOfDirectory(atPath: tmp.path) {
                for item in items { try? FileManager.default.removeItem(at: tmp.appendingPathComponent(item)) }
            }

        case "clearhttp":
            HttpEngine.shared.clearSession(host: BridgeHost.string(body["host"]))

        case "log":
            NSLog("[FHCpeBoard] %@", BridgeHost.string(body["text"]))

        default:
            break
        }
    }

    // MARK: - 回执

    /// 在 runtime 里执行 `JSON.stringify` 包裹的表达式，把结果按 Android 的约定
    /// （JSON 文本字符串）回传给 `__nativeDone`。
    private func evaluate(js: String, id: String) {
        guard let page = page else {
            sendNativeDone(id: id, result: "null")
            return
        }
        let wrapped = "JSON.stringify((function(){\(js)})())"
        page.evaluateJavaScript(wrapped) { [weak self] result, _ in
            let payload = (result as? String) ?? "null"
            self?.sendNativeDone(id: id, result: payload)
        }
    }

    func sendNativeDone(id: String, result: String) {
        let payload: [String: Any] = ["id": id, "result": result]
        guard let json = BridgeHost.json(payload) else { return }
        callRuntime("window.__nativeDone", args: [json])
    }

    /// 用 `apply(null, [...])` 传参，避免手写 JS 字符串拼接带来的转义风险。
    private func callRuntime(_ function: String, args: [Any]) {
        guard let runtime = runtime, let json = BridgeHost.json(args) else { return }
        runtime.evaluateJavaScript("\(function).apply(null, \(json));") { _, _ in }
    }

    private static func json(_ object: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func string(_ value: Any?) -> String {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }
}
