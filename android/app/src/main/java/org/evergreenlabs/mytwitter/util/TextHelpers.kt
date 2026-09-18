package org.evergreenlabs.mytwitter.util

import org.evergreenlabs.mytwitter.data.LinkPreview
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

object TextHelpers {
    private val urlPattern: Pattern =
        Pattern.compile(
            "(https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+)",
            Pattern.CASE_INSENSITIVE,
        )

    fun relativeTime(date: Date?): String {
        if (date == null) return ""
        val seconds = TimeUnit.MILLISECONDS.toSeconds(System.currentTimeMillis() - date.time).toInt()
        if (seconds < 60) return "${seconds.coerceAtLeast(0)}s"
        val minutes = seconds / 60
        if (minutes < 60) return "${minutes}m"
        val hours = minutes / 60
        if (hours < 24) return "${hours}h"
        val days = hours / 24
        if (days < 7) return "${days}d"
        return SimpleDateFormat("MMM d", Locale.getDefault()).format(date)
    }

    fun stripPreviewUrls(text: String, preview: LinkPreview?): String {
        if (preview == null) return text
        var result = text
        for (candidate in listOf(preview.tcoUrl, preview.url, preview.expandedUrl, preview.displayUrl)) {
            if (!candidate.isNullOrBlank()) {
                result = result.replace(candidate, "")
            }
        }
        return result.replace(Regex("\\s+"), " ").trim()
    }

    data class LinkSpan(val start: Int, val end: Int, val url: String)

    fun findLinks(text: String): List<LinkSpan> {
        val matcher = urlPattern.matcher(text)
        val spans = mutableListOf<LinkSpan>()
        while (matcher.find()) {
            spans.add(LinkSpan(matcher.start(), matcher.end(), matcher.group()))
        }
        return spans
    }
}
