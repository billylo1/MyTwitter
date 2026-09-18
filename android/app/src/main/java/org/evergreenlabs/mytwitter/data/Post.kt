package org.evergreenlabs.mytwitter.data

import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.Exclude
import com.google.firebase.firestore.IgnoreExtraProperties
import java.util.Date

@IgnoreExtraProperties
data class MediaItem(
    val type: String? = null,
    val url: String? = null,
    val previewUrl: String? = null,
    val videoUrl: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val alt: String? = null,
) {
    @get:Exclude
    val isVideo: Boolean
        get() {
            val t = (type ?: "").lowercase()
            return t == "video" || t == "animated_gif"
        }

    @get:Exclude
    val displayImageUrl: String?
        get() = previewUrl?.takeIf { it.isNotBlank() } ?: url?.takeIf { it.isNotBlank() }

    @get:Exclude
    val playableVideoUrl: String?
        get() = videoUrl?.takeIf { it.isNotBlank() }

    /** Width/height from X when present; otherwise a 16:9 fallback so layouts don't stretch. */
    @get:Exclude
    val aspectRatio: Float
        get() {
            val w = (width ?: 0).toFloat()
            val h = (height ?: 0).toFloat()
            if (w <= 0f || h <= 0f) return 16f / 9f
            return (w / h).coerceIn(0.45f, 2.4f)
        }
}

@IgnoreExtraProperties
data class LinkPreview(
    val url: String? = null,
    val tcoUrl: String? = null,
    val expandedUrl: String? = null,
    val displayUrl: String? = null,
    val domain: String? = null,
    val title: String? = null,
    val description: String? = null,
    val imageUrl: String? = null,
) {
    @get:Exclude
    val openUrl: String?
        get() = expandedUrl?.takeIf { it.isNotBlank() }
            ?: url?.takeIf { it.isNotBlank() }
            ?: tcoUrl?.takeIf { it.isNotBlank() }
}

@IgnoreExtraProperties
data class Post(
    @DocumentId val id: String? = null,
    val text: String? = null,
    val url: String? = null,
    val authorId: String? = null,
    val authorHandle: String? = null,
    val authorName: String? = null,
    val authorAvatar: String? = null,
    val createdAt: Date? = null,
    val isRetweet: Boolean? = null,
    val repostedById: String? = null,
    val repostedByHandle: String? = null,
    val repostedByName: String? = null,
    val repostedByAvatar: String? = null,
    val media: List<MediaItem>? = null,
    val mediaUrls: List<String>? = null,
    val linkPreview: LinkPreview? = null,
) {
    @get:Exclude
    val tweetId: String get() = id.orEmpty()

    @get:Exclude
    val displayHandle: String
        get() {
            val h = authorHandle?.trim().orEmpty()
            return h.ifEmpty { "unknown" }
        }

    @get:Exclude
    val displayName: String
        get() {
            val n = authorName?.trim().orEmpty()
            return n.ifEmpty { "@$displayHandle" }
        }

    @get:Exclude
    val xUrl: String
        get() = url?.takeIf { it.isNotBlank() } ?: "https://x.com/i/status/$tweetId"

    @get:Exclude
    val resolvedMedia: List<MediaItem>
        get() {
            if (!media.isNullOrEmpty()) return media
            return (mediaUrls ?: emptyList()).mapNotNull { u ->
                if (u.isBlank()) null
                else MediaItem(type = "photo", url = u, previewUrl = u)
            }
        }

    @get:Exclude
    val showAsRepost: Boolean
        get() = isRetweet == true &&
            !repostedByHandle.isNullOrBlank() &&
            repostedById != authorId
}
