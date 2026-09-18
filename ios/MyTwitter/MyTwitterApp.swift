import SwiftUI
import FirebaseAuth

@main
struct MyTwitterApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var auth = AuthService()
    @State private var feed = FeedStore()
    @State private var router = DeepLinkRouter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(feed)
                .environment(router)
                .onAppear {
                    PushService.shared.tweetOpener = { [router] tweetId in
                        router.openTweet(tweetId)
                    }
                }
                .onOpenURL { url in
                    Task { await router.handleURL(url, auth: auth, feed: feed) }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    Task { await router.handleURL(url, auth: auth, feed: feed) }
                }
        }
    }
}
