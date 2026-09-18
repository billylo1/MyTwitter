package org.evergreenlabs.mytwitter.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import org.evergreenlabs.mytwitter.R

class PushService(
    private val appContext: Context,
) {
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _notificationsAuthorized = MutableStateFlow(hasNotificationPermission())
    val notificationsAuthorized: StateFlow<Boolean> = _notificationsAuthorized.asStateFlow()

    var tweetOpener: ((String) -> Unit)? = null

    fun ensureFavoritesChannel() {
        val nm = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            appContext.getString(R.string.channel_favorites_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = appContext.getString(R.string.channel_favorites_desc)
        }
        nm.createNotificationChannel(channel)
    }

    fun hasNotificationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun refreshAuthorized() {
        val ok = hasNotificationPermission()
        prefs.edit { putBoolean(KEY_AUTHORIZED, ok) }
        _notificationsAuthorized.value = ok
    }

    fun cachedNotificationsAuthorized(): Boolean {
        return prefs.getBoolean(KEY_AUTHORIZED, false) || hasNotificationPermission()
    }

    fun isPushPromptDeclined(): Boolean = prefs.getBoolean(KEY_DECLINED, false)

    fun isPushOptIn(): Boolean = prefs.getBoolean(KEY_OPT_IN, false)

    fun setPushPromptDeclined(value: Boolean) {
        prefs.edit { putBoolean(KEY_DECLINED, value) }
    }

    fun setPushOptIn(value: Boolean) {
        prefs.edit { putBoolean(KEY_OPT_IN, value) }
    }

    fun onPermissionResult(granted: Boolean) {
        prefs.edit { putBoolean(KEY_AUTHORIZED, granted) }
        _notificationsAuthorized.value = granted
    }

    suspend fun fetchFcmToken(): String? {
        return try {
            ensureFavoritesChannel()
            val token = FirebaseMessaging.getInstance().token.await()
            Log.i(TAG, "FCM token ready len=${token.length}")
            token
        } catch (e: Exception) {
            Log.e(TAG, "FCM token failed", e)
            null
        }
    }

    suspend fun registerDeviceIfPossible() {
        if (!hasNotificationPermission()) return
        val token = fetchFcmToken() ?: return
        if (token.isBlank()) return
        try {
            FunctionsClient.shared.registerDevice(token, "android")
        } catch (e: Exception) {
            Log.e(TAG, "registerDevice failed", e)
        }
    }

    fun handleTweetId(raw: String?) {
        val digits = raw?.filter { it.isDigit() }.orEmpty()
        if (digits.isEmpty()) return
        tweetOpener?.invoke(digits)
    }

    companion object {
        private const val TAG = "PushService"
        private const val PREFS = "mytwitter_push"
        private const val KEY_AUTHORIZED = "notificationsAuthorized"
        private const val KEY_DECLINED = "pushPromptDeclined"
        private const val KEY_OPT_IN = "pushOptIn"
        const val CHANNEL_ID = "favorites"
    }
}
