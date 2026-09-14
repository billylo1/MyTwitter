package org.evergreenlabs.mytwitter

import android.net.Uri

object TweetUrlParser {
    private val statusIdRegex =
        Regex("""/(?:i/)?(?:web/)?status(?:es)?/(\d+)""", RegexOption.IGNORE_CASE)

    fun isXStatusOrTco(uri: Uri): Boolean {
        val host = uri.host?.lowercase() ?: return false
        if (host == "t.co") return true
        if (host !in X_HOSTS) return false
        return statusIdRegex.containsMatchIn(uri.path ?: "")
    }

    fun extractStatusId(uri: Uri): String? {
        val host = uri.host?.lowercase() ?: return null
        if (host == "t.co") return null
        if (host !in X_HOSTS) return null
        return statusIdRegex.find(uri.path ?: "")?.groupValues?.getOrNull(1)
    }

    private val X_HOSTS = setOf(
        "x.com",
        "www.x.com",
        "mobile.x.com",
        "twitter.com",
        "www.twitter.com",
        "mobile.twitter.com",
    )
}
