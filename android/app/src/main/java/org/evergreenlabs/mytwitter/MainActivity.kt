package org.evergreenlabs.mytwitter

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import com.google.firebase.messaging.FirebaseMessaging
import io.sentry.Sentry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val siteUrl: String = BuildConfig.SITE_URL.trimEnd('/')
    private var offlineCacheReloadAttempted = false

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* no-op */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // One-shot debug verification that Sentry receives events (no-op if DSN unset).
        if (BuildConfig.DEBUG &&
            BuildConfig.SENTRY_DSN.isNotBlank() &&
            intent?.getBooleanExtra(EXTRA_SENTRY_TEST, false) == true
        ) {
            Sentry.captureException(RuntimeException("Sentry Android SDK test — MyTwitter"))
        }

        setContentView(R.layout.activity_main)
        val root = findViewById<View>(R.id.root)
        webView = findViewById(R.id.webview)

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, windowInsets ->
            applySafeAreaPadding(view, windowInsets)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)

        // OS notification permission is requested from the SPA soft prompt
        // after the user has favorited authors (see public/app.js).
        ensureFavoritesChannel()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // Prefer cache when offline so cold start can still load the SPA shell.
            cacheMode =
                if (isNetworkAvailable()) {
                    WebSettings.LOAD_DEFAULT
                } else {
                    WebSettings.LOAD_CACHE_ELSE_NETWORK
                }
            userAgentString = "$userAgentString MyTwitterAndroid/1.0"
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                val msg = consoleMessage ?: return super.onConsoleMessage(consoleMessage)
                Log.i(
                    TAG,
                    "console[${msg.messageLevel()}] ${msg.sourceId()}:${msg.lineNumber()} ${msg.message()}",
                )
                return true
            }
        }
        webView.addJavascriptInterface(NativeBridge(), "MyTwitterNativeBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val uri = request.url ?: return false
                return handleNavigation(uri)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return handleNavigation(Uri.parse(url))
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                injectNativeBridge()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (!request.isForMainFrame) return
                if (offlineCacheReloadAttempted) return
                if (!isConnectivityError(error.errorCode)) return
                offlineCacheReloadAttempted = true
                Log.w(
                    TAG,
                    "main frame load failed (${error.errorCode}); retrying with cache",
                )
                view.settings.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
                view.reload()
            }
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else finish()
                }
            },
        )

        if (!handleIncomingIntent(intent)) {
            webView.loadUrl(siteUrl)
        }
        handleTweetExtra(intent)
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun isConnectivityError(errorCode: Int): Boolean {
        return errorCode == WebViewClient.ERROR_HOST_LOOKUP ||
            errorCode == WebViewClient.ERROR_CONNECT ||
            errorCode == WebViewClient.ERROR_TIMEOUT ||
            errorCode == WebViewClient.ERROR_IO ||
            errorCode == WebViewClient.ERROR_UNKNOWN
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
        handleTweetExtra(intent)
    }

    private fun handleTweetExtra(intent: Intent?) {
        val tweetId = intent?.getStringExtra(EXTRA_TWEET_ID)?.filter { it.isDigit() }
        if (!tweetId.isNullOrBlank()) {
            openTweetById(tweetId)
            intent?.removeExtra(EXTRA_TWEET_ID)
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun ensureFavoritesChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel = android.app.NotificationChannel(
            MyFirebaseMessagingService.CHANNEL_ID,
            "Favorites",
            android.app.NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Posts from accounts you favorited"
        }
        nm.createNotificationChannel(channel)
    }

    private fun fetchFcmToken(onResult: (String?) -> Unit) {
        lifecycleScope.launch {
            try {
                maybeRequestNotificationPermission()
                ensureFavoritesChannel()
                val token = FirebaseMessaging.getInstance().token.await()
                Log.i(TAG, "FCM token ready len=${token.length}")
                onResult(token)
            } catch (e: Exception) {
                Log.e(TAG, "FCM token failed", e)
                onResult(null)
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Activity handles orientation itself — re-apply notch padding for portrait.
        ViewCompat.requestApplyInsets(findViewById(R.id.root))
    }

    /**
     * In portrait, keep content clear of the status bar and punch-hole / notch.
     * Landscape only pads for system bars (side cutouts are uncommon for this shell).
     */
    private fun applySafeAreaPadding(view: View, windowInsets: WindowInsetsCompat) {
        val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
        val cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout())
        val portrait =
            resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT

        if (portrait) {
            view.updatePadding(
                left = bars.left,
                top = max(bars.top, cutout.top),
                right = bars.right,
                bottom = bars.bottom,
            )
        } else {
            view.updatePadding(
                left = bars.left,
                top = bars.top,
                right = bars.right,
                bottom = bars.bottom,
            )
        }
    }

    private fun handleNavigation(uri: Uri): Boolean {
        val host = uri.host?.lowercase() ?: return false
        val path = uri.path ?: ""
        val siteHost = Uri.parse(siteUrl).host?.lowercase()

        // Keep first-party Hosting navigations in the WebView, except OAuth start.
        if (host == siteHost) {
            if (path.startsWith("/oauth/start")) {
                openOAuthCustomTab(uri)
                return true
            }
            return false
        }

        // X OAuth authorize pages belong in Custom Tabs (not WebView).
        if (host in X_AUTH_HOSTS && path.contains("oauth", ignoreCase = true)) {
            openCustomTab(uri)
            return true
        }

        if (TweetUrlParser.isXStatusOrTco(uri)) {
            openTweetFromUri(uri)
            return true
        }

        // External http(s): open in Custom Tabs
        if (uri.scheme == "https" || uri.scheme == "http") {
            openCustomTab(uri)
            return true
        }

        return false
    }

    private fun openOAuthCustomTab(startUri: Uri) {
        val builder = startUri.buildUpon()
        if (startUri.getQueryParameter("client").isNullOrBlank()) {
            builder.appendQueryParameter("client", "android")
        }
        val start = builder.build()
        lifecycleScope.launch {
            val authorize = withContext(Dispatchers.IO) { resolveRedirect(start.toString()) }
            val target = authorize?.let { Uri.parse(it) } ?: start
            Log.i(TAG, "Opening OAuth Custom Tab: $target")
            openCustomTab(target)
        }
    }

    private fun openCustomTab(uri: Uri) {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setUrlBarHidingEnabled(false)
            .build()
            .launchUrl(this, uri)
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

    private fun handleIncomingIntent(intent: Intent?): Boolean {
        val uri = intent?.data ?: return false
        when {
            uri.scheme == "mytwitter" && uri.host == "auth" -> {
                val token = uri.getQueryParameter("token")
                val authError = uri.getQueryParameter("authError")
                val target = Uri.parse(siteUrl).buildUpon().apply {
                    if (!token.isNullOrBlank()) appendQueryParameter("token", token)
                    if (!authError.isNullOrBlank()) appendQueryParameter("authError", authError)
                }.build()
                Log.i(TAG, "OAuth return → WebView")
                webView.loadUrl(target.toString())
                return true
            }
            uri.scheme == "mytwitter" && uri.host == "tweet" -> {
                val id = uri.getQueryParameter("id") ?: uri.lastPathSegment
                if (!id.isNullOrBlank()) {
                    openTweetById(id)
                    return true
                }
            }
            uri.scheme == "mytwitter" && uri.host == "url" -> {
                val raw = uri.getQueryParameter("u") ?: uri.getQueryParameter("url")
                if (!raw.isNullOrBlank()) {
                    openTweetFromUri(Uri.parse(raw))
                    return true
                }
            }
            TweetUrlParser.isXStatusOrTco(uri) -> {
                openTweetFromUri(uri)
                return true
            }
        }
        return false
    }

    private fun openTweetFromUri(uri: Uri) {
        val statusId = TweetUrlParser.extractStatusId(uri)
        if (statusId != null) {
            openTweetById(statusId)
            return
        }
        val jsUrl = uri.toString().replace("\\", "\\\\").replace("'", "\\'")
        webView.evaluateJavascript(
            """
            (function(){
              if (typeof window.MyTwitterOpenTweet === 'function') {
                window.MyTwitterOpenTweet('$jsUrl');
              } else {
                window.__mytwitterPendingOpen = '$jsUrl';
              }
            })();
            """.trimIndent(),
            null,
        )
        if (webView.url.isNullOrBlank() || webView.url == "about:blank") {
            webView.loadUrl(siteUrl)
        }
    }

    private fun openTweetById(tweetId: String) {
        val id = tweetId.filter { it.isDigit() }
        if (id.isEmpty()) return
        val target = Uri.parse(siteUrl).buildUpon()
            .appendQueryParameter("tweet", id)
            .build()
            .toString()
        if (webView.url.isNullOrBlank() || webView.url == "about:blank") {
            webView.loadUrl(target)
        } else {
            webView.evaluateJavascript(
                """
                (function(){
                  if (typeof window.MyTwitterOpenTweet === 'function') {
                    window.MyTwitterOpenTweet('$id');
                  } else {
                    window.location.href = '$target';
                  }
                })();
                """.trimIndent(),
                null,
            )
        }
    }

    private fun injectNativeBridge() {
        webView.evaluateJavascript(
            """
            (function(){
              window.MyTwitterNative = {
                platform: 'android',
                versionName: ${BuildConfig.VERSION_NAME.let { "'$it'" }},
                versionCode: ${BuildConfig.VERSION_CODE},
                postMessage: function(msg) {
                  try {
                    MyTwitterNativeBridge.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
                  } catch (e) {}
                },
                requestPushRegistration: function() {
                  return new Promise(function(resolve, reject) {
                    window.__mytwitterPushResolve = resolve;
                    window.__mytwitterPushReject = reject;
                    try {
                      MyTwitterNativeBridge.requestPushToken();
                    } catch (e) {
                      reject(e);
                    }
                  });
                }
              };
              if (window.__mytwitterPendingOpen && typeof window.MyTwitterOpenTweet === 'function') {
                var pending = window.__mytwitterPendingOpen;
                window.__mytwitterPendingOpen = null;
                window.MyTwitterOpenTweet(pending);
              }
              window.dispatchEvent(new CustomEvent('mytwitter:nativeReady', { detail: { platform: 'android' } }));
            })();
            """.trimIndent(),
            null,
        )
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun postMessage(message: String?) {
            // Reserved for future chrome messaging.
        }

        @JavascriptInterface
        fun requestPushToken() {
            fetchFcmToken { token ->
                runOnUiThread {
                    if (token.isNullOrBlank()) {
                        webView.evaluateJavascript(
                            "window.__mytwitterPushResolve && window.__mytwitterPushResolve(null);",
                            null,
                        )
                        return@runOnUiThread
                    }
                    val safe = token
                        .replace("\\", "\\\\")
                        .replace("'", "\\'")
                        .replace("\n", "")
                    webView.evaluateJavascript(
                        """
                        window.__mytwitterPushResolve && window.__mytwitterPushResolve({
                          token: '$safe',
                          platform: 'android'
                        });
                        """.trimIndent(),
                        null,
                    )
                }
            }
        }
    }

    companion object {
        private const val TAG = "MyTwitter"
        const val EXTRA_TWEET_ID = "tweetId"
        const val EXTRA_SENTRY_TEST = "sentryTest"
        private val X_AUTH_HOSTS = setOf(
            "twitter.com",
            "www.twitter.com",
            "api.twitter.com",
            "x.com",
            "www.x.com",
        )
    }
}
