import SwiftUI

struct TweetDetailView: View {
    let tweetId: String
    @Environment(FeedStore.self) private var feed
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var post: Post?
    @State private var errorMessage: String?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading…")
                } else if let post {
                    ScrollView {
                        PostCardView(
                            post: post,
                            isLiked: feed.isLiked(post.tweetId),
                            isFavorited: feed.isFavorited(post.authorId)
                                || feed.isFavorited(post.repostedById),
                            showHitLink: false,
                            onOpen: {},
                            onAuthor: {
                                router.openAuthor(userId: post.authorId, handle: post.authorHandle)
                            },
                            onLike: {
                                Task {
                                    try? await feed.toggleLike(tweetId: post.tweetId)
                                }
                            },
                            onLink: { url in
                                Task { await router.openTweetURL(url, feed: feed) }
                            }
                        )
                        .padding()
                    }
                } else {
                    ContentUnavailableView(
                        "Tweet unavailable",
                        systemImage: "exclamationmark.bubble",
                        description: Text(errorMessage ?? "Could not load this post.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
            .navigationTitle("Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                if let post {
                    ToolbarItem(placement: .topBarTrailing) {
                        ShareLink(item: post.xURL)
                    }
                }
            }
            .task {
                await load()
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            post = try await feed.loadTweet(id: tweetId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
