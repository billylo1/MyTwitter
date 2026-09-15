import Foundation

enum AppConfig {
    static var siteURL: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "SITE_URL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let cleaned = raw.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if cleaned.isEmpty || cleaned.contains("YOUR_PROJECT_ID") {
            return "https://YOUR_PROJECT_ID.web.app"
        }
        return cleaned
    }

    /// Empty / placeholder / unresolved xcconfig ⇒ Sentry stays off (safe for forks).
    static var sentryDSN: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "SENTRY_DSN") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.isEmpty { return "" }
        if raw.contains("$(") { return "" }
        if raw.localizedCaseInsensitiveContains("YOUR_") { return "" }
        if !(raw.hasPrefix("http://") || raw.hasPrefix("https://")) { return "" }
        return raw
    }

    static var versionName: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    }

    static var versionCode: Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1") ?? 1
    }

    static var siteHost: String? {
        URL(string: siteURL)?.host?.lowercased()
    }
}
