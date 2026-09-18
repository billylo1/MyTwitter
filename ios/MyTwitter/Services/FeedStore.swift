import Foundation
import FirebaseAuth
import FirebaseFirestore
import OSLog

@Observable
@MainActor
final class FeedStore {
    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "Feed")

    var posts: [Post] = []
    var likedIds: Set<String> = []
    var favorites: [String: FavoriteAuthor] = [:]
    var publicConfig: PublicConfig?
    var statusText = "Connecting…"
    var syncMessage: String?
    var isSyncing = false
    var highlightTweetId: String?

    private var postsListener: ListenerRegistration?
    private var likesListener: ListenerRegistration?
    private var favoritesListener: ListenerRegistration?
    private var configListener: ListenerRegistration?
    private var uid: String?

    var favoritedIds: Set<String> { Set(favorites.keys) }

    var syncedAtLabel: String? {
        guard let date = publicConfig?.lastRefreshedAt else { return nil }
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return "Synced at \(f.string(from: date))"
    }

    func start(uid: String) {
        guard self.uid != uid else { return }
        stop()
        self.uid = uid
        let db = Firestore.firestore()

        postsListener = db.collection("users").document(uid).collection("posts")
            .order(by: "createdAt", descending: true)
            .limit(to: 100)
            .addSnapshotListener { [weak self] snap, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        self.log.error("posts listener: \(error.localizedDescription, privacy: .public)")
                        self.statusText = "Feed error"
                        return
                    }
                    guard let snap else { return }
                    do {
                        self.posts = try snap.documents.compactMap { try $0.data(as: Post.self) }
                        let live = !snap.metadata.isFromCache
                        let count = self.posts.count
                        self.statusText = live
                            ? "\(count) recent posts · live"
                            : "\(count) recent posts · offline"
                    } catch {
                        self.log.error("posts decode: \(error.localizedDescription, privacy: .public)")
                    }
                }
            }

        likesListener = db.collection("users").document(uid).collection("likes")
            .addSnapshotListener { [weak self] snap, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        self.log.error("likes listener: \(error.localizedDescription, privacy: .public)")
                        return
                    }
                    self.likedIds = Set(snap?.documents.map(\.documentID) ?? [])
                }
            }

        favoritesListener = db.collection("users").document(uid).collection("favorites")
            .addSnapshotListener { [weak self] snap, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        self.log.error("favorites listener: \(error.localizedDescription, privacy: .public)")
                        return
                    }
                    var map: [String: FavoriteAuthor] = [:]
                    for doc in snap?.documents ?? [] {
                        if let fav = try? doc.data(as: FavoriteAuthor.self) {
                            map[doc.documentID] = fav
                        }
                    }
                    self.favorites = map
                }
            }

        configListener = db.collection("config").document("public")
            .addSnapshotListener { [weak self] snap, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        self.log.error("config listener: \(error.localizedDescription, privacy: .public)")
                        return
                    }
                    guard let snap, snap.exists else { return }
                    self.publicConfig = try? snap.data(as: PublicConfig.self)
                }
            }
    }

    func stop() {
        postsListener?.remove()
        likesListener?.remove()
        favoritesListener?.remove()
        configListener?.remove()
        postsListener = nil
        likesListener = nil
        favoritesListener = nil
        configListener = nil
        uid = nil
        posts = []
        likedIds = []
        favorites = [:]
        publicConfig = nil
        statusText = "Connecting…"
        syncMessage = nil
    }

    func isFavorited(_ authorId: String?) -> Bool {
        guard let authorId, !authorId.isEmpty else { return false }
        return favorites[authorId] != nil
    }

    func isLiked(_ tweetId: String) -> Bool {
        likedIds.contains(tweetId)
    }

    func syncMyTimeline() async {
        guard !isSyncing else { return }
        isSyncing = true
        syncMessage = "Syncing…"
        defer { isSyncing = false }
        do {
            let result: SyncMyTimelineResponse = try await FunctionsClient.shared.call("syncMyTimeline")
            let written = result.written ?? 0
            syncMessage = written > 0 ? "Synced · \(written) new" : "Synced · up to date"
        } catch let error as FunctionsClientError {
            switch error {
            case .resourceExhausted(let msg):
                syncMessage = msg.contains("Wait") ? msg : "Wait a moment before syncing again"
            case .failedPrecondition(let msg):
                syncMessage = msg
            default:
                syncMessage = error.localizedDescription
            }
        } catch {
            syncMessage = error.localizedDescription
        }
    }

    func toggleLike(tweetId: String) async throws {
        let like = !likedIds.contains(tweetId)
        if like {
            likedIds.insert(tweetId)
        } else {
            likedIds.remove(tweetId)
        }
        do {
            try await FunctionsClient.shared.callVoid(
                "setLiked",
                data: ["tweetId": tweetId, "like": like]
            )
        } catch {
            if like {
                likedIds.remove(tweetId)
            } else {
                likedIds.insert(tweetId)
            }
            throw error
        }
    }

    func toggleFavorite(author: AuthorCard) async throws {
        guard let uid else { return }
        let authorId = author.id
        let ref = Firestore.firestore()
            .collection("users").document(uid)
            .collection("favorites").document(authorId)
        if favorites[authorId] != nil {
            try await ref.delete()
        } else {
            try await ref.setData([
                "handle": author.handle ?? "",
                "name": author.name ?? author.handle ?? "",
                "avatar": author.avatar as Any,
                "favoritedAt": FieldValue.serverTimestamp(),
            ])
        }
    }

    func post(id: String) -> Post? {
        posts.first { $0.tweetId == id }
    }

    func loadTweet(id: String) async throws -> Post {
        if let existing = post(id: id) { return existing }
        guard let uid else { throw FunctionsClientError.other("Not signed in") }
        let ref = Firestore.firestore()
            .collection("users").document(uid)
            .collection("posts").document(id)
        let snap = try await ref.getDocument()
        if snap.exists, let post = try? snap.data(as: Post.self) {
            return post
        }
        let response: GetTweetResponse = try await FunctionsClient.shared.call(
            "getTweet",
            data: ["tweetId": id]
        )
        return response.post.asPost(id: id)
    }
}
