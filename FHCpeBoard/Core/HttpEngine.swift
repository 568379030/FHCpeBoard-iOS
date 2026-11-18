import CoreFoundation
import Foundation

struct HttpResult {
    let status: Int
    let text: String
}

/// 替代 Android 侧的 OkHttp `HttpEngine`。
///
/// 契约来自 `assets/core.html` 的 `__nfetch`：
///   - 成功时返回真实 HTTP 状态码 + 响应正文
///   - 传输层失败返回 `status = 0`，正文是 `transportFailures` 里的键名
///     （`DNS_FAILED` / `TLS_CERT_FAILED` / `TLS_FAILED` / `DEVICE_ADDRESS_REJECTED`），
///     这样 JS 侧能继续使用原有的中文错误提示。
final class HttpEngine {
    static let shared = HttpEngine()

    private let session: URLSession
    private let maxBodyBytes = 16 * 1024 * 1024

    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        session = URLSession(configuration: configuration, delegate: nil, delegateQueue: nil)
    }

    func fetch(urlString: String, optionsJSON: String?, completion: @escaping (HttpResult) -> Void) {
        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host,
              !host.isEmpty,
              url.user == nil,
              url.password == nil else {
            completion(HttpResult(status: 0, text: "DEVICE_ADDRESS_REJECTED"))
            return
        }

        let options = HttpEngine.parseOptions(optionsJSON)

        var request = URLRequest(url: url)
        request.httpMethod = (options["method"] as? String)?.uppercased() ?? "GET"

        if let headers = options["headers"] as? [String: Any] {
            for (name, value) in headers {
                request.setValue(String(describing: value), forHTTPHeaderField: name)
            }
        }
        if let body = options["body"] as? String {
            request.httpBody = body.data(using: .utf8)
        }

        // 设备侧的超时是 2.5s ~ 45s，这里留出连接建立余量。
        let timeoutMs = (options["timeoutMs"] as? NSNumber)?.doubleValue ?? 60000
        request.timeoutInterval = max(3, min(300, timeoutMs / 1000 + 5))

        session.dataTask(with: request) { data, response, error in
            let result: HttpResult
            if let error = error {
                result = HttpResult(status: 0, text: HttpEngine.failureCode(for: error))
            } else if let http = response as? HTTPURLResponse {
                result = HttpResult(status: http.statusCode, text: HttpEngine.decode(data))
            } else {
                result = HttpResult(status: 0, text: "TLS_FAILED")
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    /// 丢弃某个设备的会话缓存（对应 `AndroidCore.clearHttpSession`）。
    func clearSession(host: String) {
        let cookies = HTTPCookieStorage.shared.cookies ?? []
        for cookie in cookies where host.isEmpty || cookie.domain.contains(host) || host.contains(cookie.domain) {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        URLCache.shared.removeAllCachedResponses()
        session.configuration.httpCookieStorage?.removeCookies(since: .distantPast)
    }

    private static func parseOptions(_ json: String?) -> [String: Any] {
        guard let json = json, !json.isEmpty,
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            return [:]
        }
        return dictionary
    }

    private static func decode(_ data: Data?) -> String {
        guard let data = data, !data.isEmpty else { return "" }
        if let text = String(data: data, encoding: .utf8) { return text }
        // 部分 LuCI 页面仍是 GBK 系编码。
        let gb18030 = CFStringConvertEncodingToNSStringEncoding(
            CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)
        )
        if let text = String(data: data, encoding: String.Encoding(rawValue: gb18030)) { return text }
        return String(data: data, encoding: .isoLatin1) ?? ""
    }

    private static func failureCode(for error: Error) -> String {
        let code = (error as NSError).code
        switch code {
        case NSURLErrorCannotFindHost, -1004, -1005:
            return "DNS_FAILED"
        case -1200, -1201, -1202, -1203, -1204, -1205, -1206:
            return "TLS_CERT_FAILED"
        case NSURLErrorCancelled:
            return "NETWORK_ERROR"
        default:
            return "NETWORK_ERROR"
        }
    }
}
