import Foundation
import OSLog
import UIKit

@Observable
@MainActor
final class DeepLinkRouter {
    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "DeepLink")

    var pendingTweetId: String?
    var showAuthorFor: AuthorRef?
    var infoPresented = false
    var pushPromptPresented = false
    var toastMessage: String?

    struct AuthorRef: Identifiable, Hashable {
        var id: String { userId ?? handle ?? UUID().uuidString }
        var userId: String?
        var handle: String?
    }

    func handleURL(_ url: URL, auth: AuthService, feed: FeedStore) async {
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()

        if scheme == "mytwitter" {
            switch host {
            case "auth":
                await auth.handleIncomingURL(url)
            case "tweet":
                let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?
                    .first(where: { $0.name == "id" })?
                    .value
                    ?? url.lastPathComponent
                openTweet(id)
            case "url":
                let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?
                    .first(where: { $0.name == "u" || $0.name == "url" })?
                    .value
                if let raw, let target = URL(string: raw) {
                    await openTweetURL(target, feed: feed)
                }
            default:
                break
            }
            return
        }

        if scheme == "https" || scheme == "http" {
            if let siteHost = AppConfig.siteHost,
               host == siteHost || host.hasSuffix(".web.app") || host.hasSuffix(".firebaseapp.com")
            {
                await auth.handleIncomingURL(url)
                let tweet = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?
                    .first(where: { $0.name == "tweet" })?
                    .value
                if let tweet { openTweet(tweet) }
                return
            }
            if TweetUrlParser.isXStatusOrTco(url) {
                await openTweetURL(url, feed: feed)
            }
        }
    }

    func openTweet(_ rawId: String?) {
        let digits = (rawId ?? "").filter(\.isNumber)
        guard !digits.isEmpty else { return }
        pendingTweetId = digits
    }

    func openTweetURL(_ url: URL, feed: FeedStore) async {
        if let statusId = TweetUrlParser.extractStatusId(url) {
            openTweet(statusId)
            return
        }
        do {
            let result: ResolveTweetURLResponse = try await FunctionsClient.shared.call(
                "resolveTweetUrl",
                data: ["url": url.absoluteString]
            )
            if let tweetId = result.tweetId, !tweetId.isEmpty {
                openTweet(tweetId)
            } else if let resolved = result.resolvedUrl, let open = URL(string: resolved) {
                await UIApplication.shared.open(open)
            } else {
                await UIApplication.shared.open(url)
            }
        } catch {
            log.error("resolveTweetUrl failed: \(error.localizedDescription, privacy: .public)")
            await UIApplication.shared.open(url)
        }
    }

    func openAuthor(userId: String?, handle: String?) {
        showAuthorFor = AuthorRef(userId: userId, handle: handle)
    }

    func consumePendingTweet() -> String? {
        let id = pendingTweetId
        pendingTweetId = nil
        return id
    }

    func showToast(_ message: String) {
        toastMessage = message
    }
}
