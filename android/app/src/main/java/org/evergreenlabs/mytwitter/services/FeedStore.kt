package org.evergreenlabs.mytwitter.services

import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import org.evergreenlabs.mytwitter.data.AuthorCard
import org.evergreenlabs.mytwitter.data.FavoriteAuthor
import org.evergreenlabs.mytwitter.data.Post
import org.evergreenlabs.mytwitter.data.PublicConfig
import java.text.SimpleDateFormat
import java.util.Locale

class FeedStore {
    private val db = FirebaseFirestore.getInstance()

    private val _posts = MutableStateFlow<List<Post>>(emptyList())
    val posts: StateFlow<List<Post>> = _posts.asStateFlow()

    private val _likedIds = MutableStateFlow<Set<String>>(emptySet())
    val likedIds: StateFlow<Set<String>> = _likedIds.asStateFlow()

    private val _favorites = MutableStateFlow<Map<String, FavoriteAuthor>>(emptyMap())
    val favorites: StateFlow<Map<String, FavoriteAuthor>> = _favorites.asStateFlow()

    private val _publicConfig = MutableStateFlow<PublicConfig?>(null)
    val publicConfig: StateFlow<PublicConfig?> = _publicConfig.asStateFlow()

    private val _statusText = MutableStateFlow("Connecting…")
    val statusText: StateFlow<String> = _statusText.asStateFlow()

    private val _syncMessage = MutableStateFlow<String?>(null)
    val syncMessage: StateFlow<String?> = _syncMessage.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _highlightTweetId = MutableStateFlow<String?>(null)
    val highlightTweetId: StateFlow<String?> = _highlightTweetId.asStateFlow()

    private var postsListener: ListenerRegistration? = null
    private var likesListener: ListenerRegistration? = null
    private var favoritesListener: ListenerRegistration? = null
    private var configListener: ListenerRegistration? = null
    private var uid: String? = null

    val favoritedIds: Set<String> get() = _favorites.value.keys

    val syncedAtLabel: String?
        get() {
            val date = _publicConfig.value?.lastRefreshedAt ?: return null
            val f = SimpleDateFormat("HH:mm", Locale.getDefault())
            return "Synced at ${f.format(date)}"
        }

    fun start(uid: String) {
        if (this.uid == uid) return
        stop()
        this.uid = uid

        postsListener = db.collection("users").document(uid).collection("posts")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(100)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snap, error ->
                if (error != null) {
                    Log.e(TAG, "posts listener: ${error.message}")
                    _statusText.value = "Feed error"
                    return@addSnapshotListener
                }
                if (snap == null) return@addSnapshotListener
                try {
                    _posts.value = snap.documents.mapNotNull { it.toObject(Post::class.java) }
                    val live = !snap.metadata.isFromCache
                    val count = _posts.value.size
                    _statusText.value = if (live) {
                        "$count recent posts · live"
                    } else {
                        "$count recent posts · offline"
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "posts decode", e)
                }
            }

        likesListener = db.collection("users").document(uid).collection("likes")
            .addSnapshotListener { snap, error ->
                if (error != null) {
                    Log.e(TAG, "likes listener: ${error.message}")
                    return@addSnapshotListener
                }
                _likedIds.value = snap?.documents?.map { it.id }?.toSet() ?: emptySet()
            }

        favoritesListener = db.collection("users").document(uid).collection("favorites")
            .addSnapshotListener { snap, error ->
                if (error != null) {
                    Log.e(TAG, "favorites listener: ${error.message}")
                    return@addSnapshotListener
                }
                val map = mutableMapOf<String, FavoriteAuthor>()
                for (doc in snap?.documents.orEmpty()) {
                    try {
                        val fav = doc.toObject(FavoriteAuthor::class.java)
                        if (fav != null) map[doc.id] = fav
                    } catch (_: Exception) {
                    }
                }
                _favorites.value = map
            }

        configListener = db.collection("config").document("public")
            .addSnapshotListener { snap, error ->
                if (error != null) {
                    Log.e(TAG, "config listener: ${error.message}")
                    return@addSnapshotListener
                }
                if (snap == null || !snap.exists()) return@addSnapshotListener
                try {
                    _publicConfig.value = snap.toObject(PublicConfig::class.java)
                } catch (e: Exception) {
                    Log.e(TAG, "config decode", e)
                }
            }
    }

    fun stop() {
        postsListener?.remove()
        likesListener?.remove()
        favoritesListener?.remove()
        configListener?.remove()
        postsListener = null
        likesListener = null
        favoritesListener = null
        configListener = null
        uid = null
        _posts.value = emptyList()
        _likedIds.value = emptySet()
        _favorites.value = emptyMap()
        _publicConfig.value = null
        _statusText.value = "Connecting…"
        _syncMessage.value = null
        _highlightTweetId.value = null
    }

    fun isFavorited(authorId: String?): Boolean {
        if (authorId.isNullOrBlank()) return false
        return _favorites.value.containsKey(authorId)
    }

    fun isLiked(tweetId: String): Boolean = _likedIds.value.contains(tweetId)

    fun setHighlightTweetId(id: String?) {
        _highlightTweetId.value = id
    }

    suspend fun syncMyTimeline() {
        if (_isSyncing.value) return
        _isSyncing.value = true
        _syncMessage.value = "Syncing…"
        try {
            val result = FunctionsClient.shared.syncMyTimeline()
            val written = result.written ?: 0
            _syncMessage.value = if (written > 0) {
                "Synced · $written new"
            } else {
                "Synced · up to date"
            }
        } catch (e: FunctionsClientError.ResourceExhausted) {
            val msg = e.message.orEmpty()
            _syncMessage.value = if (msg.contains("Wait")) msg else "Wait a moment before syncing again"
        } catch (e: FunctionsClientError.FailedPrecondition) {
            _syncMessage.value = e.message
        } catch (e: Exception) {
            _syncMessage.value = e.message ?: "Sync failed"
        } finally {
            _isSyncing.value = false
        }
    }

    suspend fun toggleLike(tweetId: String) {
        val like = !_likedIds.value.contains(tweetId)
        _likedIds.value = if (like) {
            _likedIds.value + tweetId
        } else {
            _likedIds.value - tweetId
        }
        try {
            FunctionsClient.shared.setLiked(tweetId, like)
        } catch (e: Exception) {
            _likedIds.value = if (like) {
                _likedIds.value - tweetId
            } else {
                _likedIds.value + tweetId
            }
            throw e
        }
    }

    suspend fun toggleFavorite(author: AuthorCard) {
        val currentUid = uid ?: return
        val authorId = author.id
        val ref = db.collection("users").document(currentUid)
            .collection("favorites").document(authorId)
        if (_favorites.value.containsKey(authorId)) {
            ref.delete().await()
        } else {
            ref.set(
                mapOf(
                    "handle" to (author.handle ?: ""),
                    "name" to (author.name ?: author.handle ?: ""),
                    "avatar" to author.avatar,
                    "favoritedAt" to FieldValue.serverTimestamp(),
                ),
            ).await()
        }
    }

    fun post(id: String): Post? = _posts.value.firstOrNull { it.tweetId == id }

    suspend fun loadTweet(id: String): Post {
        post(id)?.let { return it }
        val currentUid = uid ?: throw FunctionsClientError.Other("Not signed in")
        val snap = db.collection("users").document(currentUid)
            .collection("posts").document(id)
            .get()
            .await()
        if (snap.exists()) {
            snap.toObject(Post::class.java)?.let { return it }
        }
        return FunctionsClient.shared.getTweet(id)
    }

    companion object {
        private const val TAG = "FeedStore"
    }
}
