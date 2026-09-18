import SwiftUI

struct FeedView: View {
    @Environment(AuthService.self) private var auth
    @Environment(FeedStore.self) private var feed
    @Environment(DeepLinkRouter.self) private var router
    @State private var detailTweetId: String?
    @State private var scrollTarget: String?

    private let cardSpacing: CGFloat = 14

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: cardSpacing) {
                        feedHeader
                            .padding(.horizontal, 16)
                            .padding(.top, 4)
                            .padding(.bottom, 2)

                        if feed.posts.isEmpty {
                            ContentUnavailableView(
                                "No posts yet",
                                systemImage: "bubble.left.and.bubble.right",
                                description: Text("Pull to sync your following timeline.")
                            )
                            .frame(maxWidth: .infinity)
                            .padding(.top, 48)
                        } else {
                            ForEach(feed.posts) { post in
                                PostCardView(
                                    post: post,
                                    isLiked: feed.isLiked(post.tweetId),
                                    isFavorited: feed.isFavorited(post.authorId)
                                        || feed.isFavorited(post.repostedById),
                                    isHighlighted: feed.highlightTweetId == post.tweetId,
                                    onOpen: { detailTweetId = post.tweetId },
                                    onAuthor: {
                                        router.openAuthor(
                                            userId: post.authorId,
                                            handle: post.authorHandle
                                        )
                                    },
                                    onLike: {
                                        Task {
                                            do {
                                                try await feed.toggleLike(tweetId: post.tweetId)
                                            } catch let error as FunctionsClientError {
                                                if case .failedPrecondition(let msg) = error {
                                                    router.showToast(msg)
                                                } else {
                                                    router.showToast(error.localizedDescription)
                                                }
                                            } catch {
                                                router.showToast(error.localizedDescription)
                                            }
                                        }
                                    },
                                    onLink: { url in
                                        Task { await router.openTweetURL(url, feed: feed) }
                                    }
                                )
                                .padding(.horizontal, 12)
                                .id(post.tweetId)
                            }
                        }
                    }
                    .padding(.bottom, 24)
                }
                .refreshable {
                    await feed.syncMyTimeline()
                    if let msg = feed.syncMessage {
                        router.showToast(msg)
                    }
                }
                .onChange(of: scrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation {
                        proxy.scrollTo(target, anchor: .center)
                    }
                    feed.highlightTweetId = target
                    scrollTarget = nil
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        if feed.highlightTweetId == target {
                            feed.highlightTweetId = nil
                        }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(item: Binding(
                get: { detailTweetId.map { TweetSheetItem(id: $0) } },
                set: { detailTweetId = $0?.id }
            )) { item in
                TweetDetailView(tweetId: item.id)
                    .presentationBackground(.background)
            }
            .sheet(item: Binding(
                get: { router.showAuthorFor },
                set: { router.showAuthorFor = $0 }
            )) { author in
                AuthorCardView(userId: author.userId, handle: author.handle)
                    .presentationDetents([.medium, .large])
                    .presentationBackground(.background)
            }
            .sheet(isPresented: Binding(
                get: { router.infoPresented },
                set: { router.infoPresented = $0 }
            )) {
                InfoSheet()
                    .presentationBackground(.background)
            }
            .task(id: router.pendingTweetId) {
                guard let id = router.consumePendingTweet() else { return }
                if feed.post(id: id) != nil {
                    scrollTarget = id
                } else {
                    detailTweetId = id
                }
            }
        }
    }

    private var feedHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("MyTwitter")
                .font(.title2.weight(.bold))
            Spacer(minLength: 8)
            if let label = feed.syncedAtLabel {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Button {
                router.infoPresented = true
            } label: {
                Image(systemName: "info.circle")
                    .font(.title3)
            }
            .accessibilityLabel("Info")
        }
    }
}

private struct TweetSheetItem: Identifiable {
    let id: String
}
