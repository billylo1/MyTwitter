package org.evergreenlabs.mytwitter.services

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.net.toUri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.evergreenlabs.mytwitter.AppConfig
import org.evergreenlabs.mytwitter.TweetUrlParser

data class AuthorRef(
    val userId: String? = null,
    val handle: String? = null,
) {
    val key: String get() = userId ?: handle ?: ""
}

class DeepLinkRouter(
    private val appContext: Context,
) {
    private val _pendingTweetId = MutableStateFlow<String?>(null)
    val pendingTweetId: StateFlow<String?> = _pendingTweetId.asStateFlow()

    private val _showAuthorFor = MutableStateFlow<AuthorRef?>(null)
    val showAuthorFor: StateFlow<AuthorRef?> = _showAuthorFor.asStateFlow()

    private val _infoPresented = MutableStateFlow(false)
    val infoPresented: StateFlow<Boolean> = _infoPresented.asStateFlow()

    private val _pushPromptPresented = MutableStateFlow(false)
    val pushPromptPresented: StateFlow<Boolean> = _pushPromptPresented.asStateFlow()

    private val _toastMessage = MutableStateFlow<String?>(null)
    val toastMessage: StateFlow<String?> = _toastMessage.asStateFlow()

    private val _tweetDetailId = MutableStateFlow<String?>(null)
    val tweetDetailId: StateFlow<String?> = _tweetDetailId.asStateFlow()

    fun setInfoPresented(value: Boolean) {
        _infoPresented.value = value
    }

    fun setPushPromptPresented(value: Boolean) {
        _pushPromptPresented.value = value
    }

    fun setShowAuthorFor(ref: AuthorRef?) {
        _showAuthorFor.value = ref
    }

    fun setTweetDetailId(id: String?) {
        _tweetDetailId.value = id
    }

    suspend fun handleUri(uri: Uri, auth: AuthStore, feed: FeedStore) {
        val scheme = uri.scheme?.lowercase().orEmpty()
        val host = uri.host?.lowercase().orEmpty()

        if (scheme == "mytwitter") {
            when (host) {
                "auth" -> auth.handleIncomingUri(uri)
                "tweet" -> {
                    val id = uri.getQueryParameter("id")
                        ?: uri.lastPathSegment
                    openTweet(id)
                }
                "url" -> {
                    val raw = uri.getQueryParameter("u") ?: uri.getQueryParameter("url")
                    if (!raw.isNullOrBlank()) {
                        openTweetUrl(raw.toUri(), feed)
                    }
                }
            }
            return
        }

        if (scheme == "https" || scheme == "http") {
            val siteHost = AppConfig.siteHost
            if (host == siteHost || host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) {
                auth.handleIncomingUri(uri)
                val tweet = uri.getQueryParameter("tweet")
                if (!tweet.isNullOrBlank()) openTweet(tweet)
                return
            }
            if (TweetUrlParser.isXStatusOrTco(uri)) {
                openTweetUrl(uri, feed)
            }
        }
    }

    fun openTweet(rawId: String?) {
        val digits = rawId?.filter { it.isDigit() }.orEmpty()
        if (digits.isEmpty()) return
        _pendingTweetId.value = digits
    }

    suspend fun openTweetUrl(uri: Uri, feed: FeedStore) {
        TweetUrlParser.extractStatusId(uri)?.let {
            openTweet(it)
            return
        }
        try {
            val result = FunctionsClient.shared.resolveTweetUrl(uri.toString())
            val tweetId = result.tweetId
            if (!tweetId.isNullOrBlank()) {
                openTweet(tweetId)
            } else {
                val resolved = result.resolvedUrl
                openExternal(if (!resolved.isNullOrBlank()) resolved.toUri() else uri)
            }
        } catch (e: Exception) {
            Log.e(TAG, "resolveTweetUrl failed", e)
            openExternal(uri)
        }
    }

    fun openAuthor(userId: String?, handle: String?) {
        _showAuthorFor.value = AuthorRef(userId = userId, handle = handle)
    }

    fun consumePendingTweet(): String? {
        val id = _pendingTweetId.value
        _pendingTweetId.value = null
        return id
    }

    fun showToast(message: String) {
        _toastMessage.value = message
    }

    fun clearToast() {
        _toastMessage.value = null
    }

    private fun openExternal(uri: Uri) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            appContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "openExternal failed", e)
        }
    }

    companion object {
        private const val TAG = "DeepLinkRouter"
    }
}
