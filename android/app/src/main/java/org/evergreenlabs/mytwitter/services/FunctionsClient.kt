package org.evergreenlabs.mytwitter.services

import android.util.Log
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.tasks.await
import org.evergreenlabs.mytwitter.data.AuthorCard
import org.evergreenlabs.mytwitter.data.LinkPreview
import org.evergreenlabs.mytwitter.data.MediaItem
import org.evergreenlabs.mytwitter.data.Post
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

sealed class FunctionsClientError(message: String) : Exception(message) {
    class FailedPrecondition(message: String) : FunctionsClientError(message)
    class ResourceExhausted(message: String) : FunctionsClientError(message)
    class Other(message: String) : FunctionsClientError(message)
    class InvalidResponse : FunctionsClientError("Unexpected server response")
}

class FunctionsClient private constructor() {
    private val functions = FirebaseFunctions.getInstance("us-central1")

    @Suppress("UNCHECKED_CAST")
    suspend fun call(name: String, data: Map<String, Any?> = emptyMap()): Map<String, Any?> {
        return try {
            val result = functions.getHttpsCallable(name).call(data).await()
            (result.getData() as? Map<*, *>)?.mapKeys { it.key.toString() }
                ?.mapValues { it.value } as? Map<String, Any?>
                ?: emptyMap()
        } catch (e: Exception) {
            throw mapError(e)
        }
    }

    suspend fun callVoid(name: String, data: Map<String, Any?> = emptyMap()) {
        call(name, data)
    }

    suspend fun exchangeAuthHandoff(handoff: String): String {
        val result = call("exchangeAuthHandoff", mapOf("handoff" to handoff))
        return result["token"] as? String
            ?: throw FunctionsClientError.InvalidResponse()
    }

    suspend fun syncMyTimeline(): SyncMyTimelineResponse {
        val result = call("syncMyTimeline")
        return SyncMyTimelineResponse(
            ok = result["ok"] as? Boolean,
            fetched = (result["fetched"] as? Number)?.toInt(),
            written = (result["written"] as? Number)?.toInt(),
            newestId = result["newestId"] as? String,
        )
    }

    suspend fun setLiked(tweetId: String, like: Boolean) {
        callVoid("setLiked", mapOf("tweetId" to tweetId, "like" to like))
    }

    suspend fun getTweet(tweetId: String): Post {
        val result = call("getTweet", mapOf("tweetId" to tweetId))
        @Suppress("UNCHECKED_CAST")
        val postMap = result["post"] as? Map<String, Any?>
            ?: throw FunctionsClientError.InvalidResponse()
        return postFromMap(tweetId, postMap)
    }

    suspend fun getAuthorCard(userId: String?, handle: String?): AuthorCard {
        val data = buildMap<String, Any?> {
            if (!userId.isNullOrBlank()) put("userId", userId)
            if (!handle.isNullOrBlank()) put("handle", handle)
        }
        val result = call("getAuthorCard", data)
        return AuthorCard(
            id = result["id"] as? String ?: "",
            name = result["name"] as? String,
            handle = result["handle"] as? String,
            avatar = result["avatar"] as? String,
            description = result["description"] as? String,
            verified = result["verified"] as? Boolean,
            protected = result["protected"] as? Boolean,
            following = (result["following"] as? Boolean) ?: true,
            isSelf = result["isSelf"] as? Boolean,
        )
    }

    suspend fun setFollowing(userId: String, follow: Boolean) {
        callVoid("setFollowing", mapOf("userId" to userId, "follow" to follow))
    }

    suspend fun resolveTweetUrl(url: String): ResolveTweetUrlResponse {
        val result = call("resolveTweetUrl", mapOf("url" to url))
        return ResolveTweetUrlResponse(
            tweetId = result["tweetId"] as? String,
            resolvedUrl = result["resolvedUrl"] as? String,
        )
    }

    suspend fun registerDevice(token: String, platform: String = "android") {
        callVoid("registerDevice", mapOf("token" to token, "platform" to platform))
    }

    suspend fun getRssFeedUrl(): String {
        val result = call("getRssFeedUrl")
        return result["url"] as? String
            ?: throw FunctionsClientError.InvalidResponse()
    }

    suspend fun createInvite(maxUses: Int = 5, days: Int = 14): CreateInviteResponse {
        val result = call("createInvite", mapOf("maxUses" to maxUses, "days" to days))
        return CreateInviteResponse(
            code = result["code"] as? String,
            url = result["url"] as? String
                ?: throw FunctionsClientError.InvalidResponse(),
            maxUses = (result["maxUses"] as? Number)?.toInt(),
            expiresAt = result["expiresAt"] as? String,
        )
    }

    private fun mapError(error: Exception): Exception {
        if (error is FirebaseFunctionsException) {
            val message = error.message ?: error.localizedMessage ?: "Unknown error"
            return when (error.code) {
                FirebaseFunctionsException.Code.FAILED_PRECONDITION ->
                    FunctionsClientError.FailedPrecondition(message)
                FirebaseFunctionsException.Code.RESOURCE_EXHAUSTED ->
                    FunctionsClientError.ResourceExhausted(message)
                else -> {
                    Log.e(TAG, "callable failed: $message")
                    FunctionsClientError.Other(message)
                }
            }
        }
        val message = error.message ?: "Unknown error"
        Log.e(TAG, "callable failed: $message", error)
        return FunctionsClientError.Other(message)
    }

    companion object {
        private const val TAG = "FunctionsClient"
        val shared = FunctionsClient()

        @Suppress("UNCHECKED_CAST")
        fun postFromMap(id: String, map: Map<String, Any?>): Post {
            val mediaList = (map["media"] as? List<*>)?.mapNotNull { item ->
                val m = item as? Map<*, *> ?: return@mapNotNull null
                MediaItem(
                    type = m["type"] as? String,
                    url = m["url"] as? String,
                    previewUrl = m["previewUrl"] as? String,
                    videoUrl = m["videoUrl"] as? String,
                    width = (m["width"] as? Number)?.toInt(),
                    height = (m["height"] as? Number)?.toInt(),
                    alt = m["alt"] as? String,
                )
            }
            val mediaUrls = (map["mediaUrls"] as? List<*>)?.mapNotNull { it as? String }
            val previewMap = map["linkPreview"] as? Map<*, *>
            val linkPreview = previewMap?.let {
                LinkPreview(
                    url = it["url"] as? String,
                    tcoUrl = it["tcoUrl"] as? String,
                    expandedUrl = it["expandedUrl"] as? String,
                    displayUrl = it["displayUrl"] as? String,
                    domain = it["domain"] as? String,
                    title = it["title"] as? String,
                    description = it["description"] as? String,
                    imageUrl = it["imageUrl"] as? String,
                )
            }
            return Post(
                id = id,
                text = map["text"] as? String,
                url = map["url"] as? String,
                authorId = map["authorId"] as? String,
                authorHandle = map["authorHandle"] as? String,
                authorName = map["authorName"] as? String,
                authorAvatar = map["authorAvatar"] as? String,
                createdAt = parseDate(map["createdAt"]),
                isRetweet = map["isRetweet"] as? Boolean,
                repostedById = map["repostedById"] as? String,
                repostedByHandle = map["repostedByHandle"] as? String,
                repostedByName = map["repostedByName"] as? String,
                repostedByAvatar = map["repostedByAvatar"] as? String,
                media = mediaList,
                mediaUrls = mediaUrls,
                linkPreview = linkPreview,
            )
        }

        private fun parseDate(raw: Any?): Date? {
            when (raw) {
                is Date -> return raw
                is com.google.firebase.Timestamp -> return raw.toDate()
                is String -> {
                    if (raw.isBlank()) return null
                    val formats = listOf(
                        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                        "yyyy-MM-dd'T'HH:mm:ss'Z'",
                    )
                    for (pattern in formats) {
                        try {
                            val sdf = SimpleDateFormat(pattern, Locale.US).apply {
                                timeZone = TimeZone.getTimeZone("UTC")
                            }
                            return sdf.parse(raw)
                        } catch (_: Exception) {
                        }
                    }
                }
            }
            return null
        }
    }
}

data class SyncMyTimelineResponse(
    val ok: Boolean?,
    val fetched: Int?,
    val written: Int?,
    val newestId: String?,
)

data class ResolveTweetUrlResponse(
    val tweetId: String?,
    val resolvedUrl: String?,
)

data class CreateInviteResponse(
    val code: String?,
    val url: String,
    val maxUses: Int?,
    val expiresAt: String?,
)
