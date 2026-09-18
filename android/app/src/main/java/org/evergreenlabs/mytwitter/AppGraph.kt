package org.evergreenlabs.mytwitter

import android.content.Context
import org.evergreenlabs.mytwitter.services.AuthStore
import org.evergreenlabs.mytwitter.services.DeepLinkRouter
import org.evergreenlabs.mytwitter.services.FeedStore
import org.evergreenlabs.mytwitter.services.PushService

/**
 * Manual DI container mirroring iOS's three @State singletons.
 * Reachable from [MyFirebaseMessagingService] without Hilt.
 */
object AppGraph {
    lateinit var auth: AuthStore
        private set
    lateinit var feed: FeedStore
        private set
    lateinit var router: DeepLinkRouter
        private set
    lateinit var push: PushService
        private set

    val isInitialized: Boolean get() = ::auth.isInitialized

    fun init(context: Context) {
        if (isInitialized) return
        val app = context.applicationContext
        auth = AuthStore(app)
        feed = FeedStore()
        router = DeepLinkRouter(app)
        push = PushService(app)
        push.tweetOpener = { tweetId -> router.openTweet(tweetId) }
        push.ensureFavoritesChannel()
        push.refreshAuthorized()
    }
}
