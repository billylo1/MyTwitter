package org.evergreenlabs.mytwitter

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.services.FunctionsClient
import org.evergreenlabs.mytwitter.services.PushService

class MyFirebaseMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM token refreshed len=${token.length}")
        if (FirebaseAuth.getInstance().currentUser == null) return
        scope.launch {
            try {
                FunctionsClient.shared.registerDevice(token, "android")
            } catch (e: Exception) {
                Log.e(TAG, "re-registerDevice failed", e)
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val tweetId = message.data["tweetId"]
            ?: message.data["tweet_id"]
            ?: ""
        val title = message.notification?.title
            ?: message.data["title"]
            ?: getString(R.string.notification_default_title)
        val body = message.notification?.body
            ?: message.data["body"]
            ?: getString(R.string.notification_default_body)

        if (AppGraph.isInitialized) {
            AppGraph.push.ensureFavoritesChannel()
        }

        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (tweetId.isNotBlank()) {
                putExtra(MainActivity.EXTRA_TWEET_ID, tweetId)
            }
        }
        val pending = PendingIntent.getActivity(
            this,
            tweetId.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, PushService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mytwitter)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        NotificationManagerCompat.from(this)
            .notify((tweetId.ifBlank { System.currentTimeMillis().toString() }).hashCode(), notification)
    }

    companion object {
        private const val TAG = "MyTwitterFCM"
    }
}
