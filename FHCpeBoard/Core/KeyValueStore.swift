import Foundation

/// 替代 Android 的 `AndroidCore.kcGet / kcSet / kcRemove`。
///
/// Android 侧用的是 SharedPreferences + Keychain 风格缓存；这里落在 UserDefaults
/// 的独立前缀下。会话配置（含 CPE 密码）与壁纸都存于此，与桌面端 CPE 口令同级别
/// 保护，未做额外加密 —— 与原实现保持一致，详见 README 的安全说明。
enum KeyValueStore {
    private static let prefix = "fhcpeboard."

    static func get(_ key: String) -> String? {
        UserDefaults.standard.string(forKey: prefix + key)
    }

    static func set(_ key: String, _ value: String) {
        UserDefaults.standard.set(value, forKey: prefix + key)
    }

    static func remove(_ key: String) {
        UserDefaults.standard.removeObject(forKey: prefix + key)
    }

    static func snapshot() -> [String: String] {
        var result: [String: String] = [:]
        for (key, value) in UserDefaults.standard.dictionaryRepresentation() where key.hasPrefix(prefix) {
            guard let text = value as? String else { continue }
            result[String(key.dropFirst(prefix.count))] = text
        }
        return result
    }

    static func clearAll() -> Int {
        let keys = snapshot().keys
        for key in keys { remove(key) }
        return keys.count
    }
}
