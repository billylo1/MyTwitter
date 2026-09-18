package org.evergreenlabs.mytwitter

import android.net.Uri

object AppConfig {
    val siteUrl: String
        get() {
            val raw = BuildConfig.SITE_URL.trim().trimEnd('/')
            if (raw.isEmpty() || raw.contains("YOUR_PROJECT_ID")) {
                return "https://YOUR_PROJECT_ID.web.app"
            }
            return raw
        }

    val sentryDsn: String
        get() {
            val raw = BuildConfig.SENTRY_DSN.trim()
            if (raw.isEmpty()) return ""
            if (raw.contains("YOUR_", ignoreCase = true)) return ""
            if (!raw.startsWith("http://") && !raw.startsWith("https://")) return ""
            return raw
        }

    val versionName: String
        get() = BuildConfig.VERSION_NAME

    val versionCode: Int
        get() = BuildConfig.VERSION_CODE

    val siteHost: String?
        get() = Uri.parse(siteUrl).host?.lowercase()
}
