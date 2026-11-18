import Foundation
import WebKit

/// Serves the bundled `assets/` directory over a private `app://local/` origin.
///
/// 原 Android 版用 `file:///android_asset/core.html`，而 WKWebView 在 `file://`
/// 下限制 localStorage / fetch，因此这里改用自定义 scheme，拿到一个正常的、
/// 稳定的 origin。
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    static let host = "local"

    static var baseURL: URL {
        URL(string: "\(scheme)://\(host)/")!
    }

    private let root: URL?
    private var stopped = Set<ObjectIdentifier>()

    override init() {
        root = Bundle.main.resourceURL?.appendingPathComponent("assets", isDirectory: true)
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask)

        guard let url = urlSchemeTask.request.url else {
            missing(urlSchemeTask, taskID)
            return
        }

        var relative = url.path
        if relative.isEmpty || relative == "/" { relative = "/core.html" }
        while relative.hasPrefix("/") { relative.removeFirst() }

        // 只允许扁平读取 assets 目录内的文件，拒绝任何路径穿越。
        guard let root = root,
              !relative.isEmpty,
              !relative.contains(".."),
              !relative.hasPrefix(".") else {
            missing(urlSchemeTask, taskID)
            return
        }

        let fileURL = root.appendingPathComponent(relative)
        guard let data = try? Data(contentsOf: fileURL) else {
            missing(urlSchemeTask, taskID)
            return
        }

        guard !stopped.contains(taskID) else { return }

        urlSchemeTask.didReceive(
            URLResponse(
                url: url,
                mimeType: AssetSchemeHandler.mimeType(for: fileURL.pathExtension),
                expectedContentLength: data.count,
                textEncodingName: "utf-8"
            )
        )
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(urlSchemeTask))
    }

    /// 资源不存在：返回空正文，页面侧会表现为资源加载失败而不是崩溃。
    private func missing(_ task: WKURLSchemeTask, _ taskID: ObjectIdentifier) {
        guard !stopped.contains(taskID), let url = task.request.url else { return }
        task.didReceive(
            URLResponse(
                url: url,
                mimeType: "text/plain; charset=utf-8",
                expectedContentLength: 0,
                textEncodingName: "utf-8"
            )
        )
        task.didReceive(Data())
        task.didFinish()
    }

    static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "woff", "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
