package org.evergreenlabs.mytwitter

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MyFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM token refreshed")
        // SPA re-registers after sign-in via requestPushRegistration.
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val tweetId = message.data["tweetId"]
            ?: message.data["tweet_id"]
            ?: ""
        val title = message.notification?.title
            ?: message.data["title"]
            ?: "MyTwitter"
        val body = message.notification?.body
            ?: message.data["body"]
            ?: "New post from a favorited account"

        ensureChannel()
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

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify((tweetId.ifBlank { System.currentTimeMillis().toString() }).hashCode(), notification)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Favorites",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Posts from accounts you favorited"
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "MyTwitterFCM"
        const val CHANNEL_ID = "favorites"
    }
}
