package org.evergreenlabs.mytwitter.services

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.evergreenlabs.mytwitter.AppConfig
import org.evergreenlabs.mytwitter.data.Member
import java.net.HttpURLConnection
import java.net.URL

class AuthStore(
    private val appContext: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()

    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _user = MutableStateFlow<FirebaseUser?>(null)
    val user: StateFlow<FirebaseUser?> = _user.asStateFlow()

    private val _member = MutableStateFlow<Member?>(null)
    val member: StateFlow<Member?> = _member.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    private val _isBusy = MutableStateFlow(false)
    val isBusy: StateFlow<Boolean> = _isBusy.asStateFlow()

    private val _isReady = MutableStateFlow(false)
    val isReady: StateFlow<Boolean> = _isReady.asStateFlow()

    private val _pendingInvite = MutableStateFlow(prefs.getString(KEY_PENDING_INVITE, null))
    val pendingInvite: StateFlow<String?> = _pendingInvite.asStateFlow()

    val isSignedIn: Boolean get() = _user.value != null

    private var memberListener: ListenerRegistration? = null
    private var lastAuthReturnKey: String? = null
    private var lastAuthReturnAt: Long = 0L

    init {
        auth.addAuthStateListener { firebaseAuth ->
            handleAuthState(firebaseAuth.currentUser)
        }
        _user.value = auth.currentUser
        auth.currentUser?.let { startMemberListener(it.uid) }
        _isReady.value = true
    }

    fun setPendingInvite(invite: String?) {
        if (!invite.isNullOrBlank()) {
            prefs.edit().putString(KEY_PENDING_INVITE, invite).apply()
            _pendingInvite.value = invite
        } else {
            prefs.edit().remove(KEY_PENDING_INVITE).apply()
            _pendingInvite.value = null
        }
    }

    fun signIn(activityContext: Context) {
        _authError.value = null
        _isBusy.value = true
        val builder = Uri.parse("${AppConfig.siteUrl}/oauth/start").buildUpon()
            .appendQueryParameter("client", "android")
        val invite = _pendingInvite.value
        if (!invite.isNullOrBlank()) {
            builder.appendQueryParameter("invite", invite)
        }
        val start = builder.build()
        scope.launch {
            val authorize = withContext(Dispatchers.IO) { resolveRedirect(start.toString()) }
            val target = authorize?.let { Uri.parse(it) } ?: start
            Log.i(TAG, "Opening OAuth Custom Tab: $target")
            try {
                CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setUrlBarHidingEnabled(false)
                    .build()
                    .launchUrl(activityContext, target)
            } catch (e: Exception) {
                Log.e(TAG, "Could not start Custom Tab", e)
                _authError.value = "Could not start sign-in"
                _isBusy.value = false
            }
        }
    }

    suspend fun handleIncomingUri(uri: Uri) {
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme == "mytwitter" && uri.host?.lowercase() == "auth") {
            handleAuthCallback(uri)
            return
        }
        if (scheme == "https" || scheme == "http") {
            val host = uri.host?.lowercase() ?: return
            val siteHost = AppConfig.siteHost
            if (host == siteHost || host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) {
                // Chrome may App-Link /oauth/callback out of Custom Tabs before the
                // server can 302 to mytwitter://auth — complete that hop ourselves.
                val path = uri.path.orEmpty()
                if (path.startsWith("/oauth/callback") || path.startsWith("/oauth/start")) {
                    Log.i(TAG, "First-party OAuth URL intercepted: $uri")
                    val authUri = withContext(Dispatchers.IO) { followToAuthCallback(uri.toString()) }
                    if (authUri != null) {
                        handleAuthCallback(authUri)
                    } else {
                        _authError.value = "X sign-in failed. Please try again."
                        _isBusy.value = false
                    }
                    return
                }
                val invite = uri.getQueryParameter("invite")
                if (!invite.isNullOrBlank()) {
                    setPendingInvite(invite)
                }
            }
        }
    }

    fun signOut() {
        try {
            auth.signOut()
        } catch (e: Exception) {
            Log.e(TAG, "signOut failed", e)
        }
        memberListener?.remove()
        memberListener = null
        _member.value = null
        _user.value = null
    }

    private fun handleAuthState(user: FirebaseUser?) {
        _user.value = user
        if (user != null) {
            startMemberListener(user.uid)
        } else {
            memberListener?.remove()
            memberListener = null
            _member.value = null
        }
    }

    private suspend fun handleAuthCallback(uri: Uri) {
        val handoff = uri.getQueryParameter("handoff")
        val token = uri.getQueryParameter("token")
        val errorCode = uri.getQueryParameter("authError")
        val invite = uri.getQueryParameter("invite")

        if (!invite.isNullOrBlank()) {
            setPendingInvite(invite)
        }

        val dedupeKey = listOf(handoff, token, errorCode, uri.toString())
            .firstOrNull { !it.isNullOrBlank() }
            ?: uri.toString()
        val now = System.currentTimeMillis()
        if (dedupeKey == lastAuthReturnKey && now - lastAuthReturnAt < 8_000) {
            Log.i(TAG, "Ignoring duplicate OAuth return")
            return
        }
        lastAuthReturnKey = dedupeKey
        lastAuthReturnAt = now

        if (!errorCode.isNullOrBlank()) {
            _authError.value = messageFor(errorCode)
            _isBusy.value = false
            return
        }

        try {
            val customToken = when {
                !handoff.isNullOrBlank() -> FunctionsClient.shared.exchangeAuthHandoff(handoff)
                !token.isNullOrBlank() -> token
                else -> {
                    _authError.value = "X sign-in was cancelled or incomplete."
                    _isBusy.value = false
                    return
                }
            }
            auth.signInWithCustomToken(customToken).await()
            setPendingInvite(null)
            _authError.value = null
        } catch (e: Exception) {
            if (auth.currentUser != null) {
                Log.w(TAG, "handoff exchange failed after sign-in; ignoring")
            } else {
                Log.e(TAG, "auth callback failed", e)
                _authError.value = "X sign-in failed. Please try again."
            }
        }
        _isBusy.value = false
    }

    private fun startMemberListener(uid: String) {
        memberListener?.remove()
        memberListener = db.collection("members").document(uid)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snap, error ->
                if (error != null) {
                    Log.e(TAG, "member listener: ${error.message}")
                    return@addSnapshotListener
                }
                if (snap == null) return@addSnapshotListener
                val fromCache = snap.metadata.isFromCache
                val enabled = snap.getBoolean("enabled")
                if (!snap.exists() || enabled == false) {
                    if (!fromCache) {
                        signOut()
                        _authError.value =
                            "You're signed in to X but not a member of this feed yet."
                    }
                    return@addSnapshotListener
                }
                try {
                    _member.value = snap.toObject(Member::class.java)
                    setPendingInvite(null)
                } catch (e: Exception) {
                    Log.e(TAG, "member decode", e)
                }
            }
    }

    /**
     * Follow a single Hosting redirect to the X authorize URL so Custom Tabs
     * lands on x.com instead of bouncing through our origin.
     */
    private fun resolveRedirect(url: String): String? {
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 15_000
                requestMethod = "GET"
                setRequestProperty("Accept", "text/html")
            }
            val code = conn.responseCode
            val location = conn.getHeaderField("Location")
            conn.disconnect()
            if (code in 300..399 && !location.isNullOrBlank()) location else null
        } catch (e: Exception) {
            Log.w(TAG, "resolveRedirect failed", e)
            null
        }
    }

    /**
     * Hit `/oauth/callback` (or follow further Hosting redirects) until we get
     * `mytwitter://auth?…`. Used when App Links steal the callback out of Custom Tabs.
     */
    private fun followToAuthCallback(startUrl: String): Uri? {
        var current = startUrl
        repeat(10) {
            try {
                if (current.startsWith("mytwitter://", ignoreCase = true)) {
                    return Uri.parse(current)
                }
                val conn = (URL(current).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 20_000
                    readTimeout = 20_000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "text/html")
                }
                val code = conn.responseCode
                val location = conn.getHeaderField("Location")
                // Drain/close so the connection can be reused/released.
                runCatching { conn.inputStream?.close() }
                runCatching { conn.errorStream?.close() }
                conn.disconnect()

                if (location.isNullOrBlank()) {
                    Log.w(TAG, "OAuth follow: no Location (HTTP $code) from $current")
                    return null
                }
                val next = when {
                    location.startsWith("mytwitter:", ignoreCase = true) -> location
                    location.startsWith("http://", ignoreCase = true) ||
                        location.startsWith("https://", ignoreCase = true) -> location
                    else -> URL(URL(current), location).toString()
                }
                Log.i(TAG, "OAuth follow $code → $next")
                if (next.startsWith("mytwitter://", ignoreCase = true)) {
                    return Uri.parse(next)
                }
                if (code !in 300..399) {
                    return null
                }
                current = next
            } catch (e: Exception) {
                Log.e(TAG, "followToAuthCallback failed at $current", e)
                return null
            }
        }
        Log.w(TAG, "followToAuthCallback: too many redirects")
        return null
    }

    companion object {
        private const val TAG = "AuthStore"
        private const val PREFS = "mytwitter_auth"
        private const val KEY_PENDING_INVITE = "pendingInvite"

        fun messageFor(code: String): String = when (code) {
            "not_invited" ->
                "You're not on the family list yet. Ask for an invite link, then try again."
            "expired_or_invalid_session", "expired_session" ->
                "Sign-in timed out. Please try again."
            "oauth_failed" ->
                "X sign-in failed. Please try again."
            "missing_oauth_params" ->
                "X sign-in was cancelled or incomplete."
            else -> if (code.isEmpty()) "" else "Sign-in error: $code"
        }
    }
}
