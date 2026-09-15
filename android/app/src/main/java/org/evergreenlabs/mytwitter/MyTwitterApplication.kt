package org.evergreenlabs.mytwitter

import android.app.Application
import android.util.Log
import io.sentry.android.core.SentryAndroid

class MyTwitterApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val dsn = BuildConfig.SENTRY_DSN.trim()
        if (dsn.isEmpty()) {
            Log.i(TAG, "Sentry disabled (optional; set sentry.dsn or SENTRY_DSN to enable)")
            return
        }

        SentryAndroid.init(this) { options ->
            options.dsn = dsn
            options.environment = BuildConfig.BUILD_TYPE
            options.release =
                "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
            // 100% in debug; trim for production traffic later
            options.tracesSampleRate = if (BuildConfig.DEBUG) 1.0 else 0.2
            options.isAnrEnabled = true
            options.isDebug = BuildConfig.DEBUG
        }
    }

    companion object {
        private const val TAG = "MyTwitter"
    }
}
