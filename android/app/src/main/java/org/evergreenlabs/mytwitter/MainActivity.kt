package org.evergreenlabs.mytwitter

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Surface
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.ui.RootScreen
import org.evergreenlabs.mytwitter.ui.theme.MyTwitterTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            MyTwitterTheme {
                Surface {
                    RootScreen()
                }
            }
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return

        val tweetId = intent.getStringExtra(EXTRA_TWEET_ID)?.filter { it.isDigit() }
        if (!tweetId.isNullOrBlank()) {
            AppGraph.router.openTweet(tweetId)
            intent.removeExtra(EXTRA_TWEET_ID)
        }

        val data = intent.data
        if (data != null) {
            android.util.Log.i(TAG, "handleIntent data=$data")
            lifecycleScope.launch {
                AppGraph.router.handleUri(data, AppGraph.auth, AppGraph.feed)
                intent.data = null
            }
        }
    }

    companion object {
        private const val TAG = "MainActivity"
        const val EXTRA_TWEET_ID = "tweetId"
    }
}
