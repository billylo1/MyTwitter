import Foundation
import FirebaseFunctions
import OSLog

enum FunctionsClientError: LocalizedError {
    case invalidResponse
    case failedPrecondition(String)
    case resourceExhausted(String)
    case other(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Unexpected server response"
        case .failedPrecondition(let m), .resourceExhausted(let m), .other(let m):
            return m
        }
    }
}

final class FunctionsClient {
    static let shared = FunctionsClient()
    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "Functions")
    private let functions = Functions.functions(region: "us-central1")

    private init() {}

    func call<T: Decodable>(_ name: String, data: [String: Any] = [:]) async throws -> T {
        do {
            let result = try await functions.httpsCallable(name).call(data)
            let payload = result.data
            let json = try JSONSerialization.data(withJSONObject: payload, options: [])
            return try JSONDecoder().decode(T.self, from: json)
        } catch let error as NSError {
            throw mapError(error)
        }
    }

    func callVoid(_ name: String, data: [String: Any] = [:]) async throws {
        do {
            _ = try await functions.httpsCallable(name).call(data)
        } catch let error as NSError {
            throw mapError(error)
        }
    }

    private func mapError(_ error: NSError) -> Error {
        let domain = error.domain
        let code = error.code
        let message = error.localizedDescription
        // Firebase Functions error codes: FailedPrecondition = 9, ResourceExhausted = 8
        if domain == FunctionsErrorDomain {
            if code == FunctionsErrorCode.failedPrecondition.rawValue {
                return FunctionsClientError.failedPrecondition(message)
            }
            if code == FunctionsErrorCode.resourceExhausted.rawValue {
                return FunctionsClientError.resourceExhausted(message)
            }
        }
        log.error("callable failed: \(message, privacy: .public)")
        return FunctionsClientError.other(message)
    }
}

// MARK: - Response DTOs

struct HandoffTokenResponse: Decodable {
    let token: String
}

struct RssFeedURLResponse: Decodable {
    let url: String
}

struct GetTweetResponse: Decodable {
    let post: PostDTO
}

struct PostDTO: Decodable {
    var text: String?
    var url: String?
    var authorId: String?
    var authorHandle: String?
    var authorName: String?
    var authorAvatar: String?
    var createdAt: String?
    var isRetweet: Bool?
    var repostedById: String?
    var repostedByHandle: String?
    var repostedByName: String?
    var repostedByAvatar: String?
    var media: [MediaItem]?
    var mediaUrls: [String]?
    var linkPreview: LinkPreview?

    func asPost(id: String) -> Post {
        var post = Post()
        post.id = id
        post.text = text
        post.url = url
        post.authorId = authorId
        post.authorHandle = authorHandle
        post.authorName = authorName
        post.authorAvatar = authorAvatar
        post.createdAt = Self.parseDate(createdAt)
        post.isRetweet = isRetweet
        post.repostedById = repostedById
        post.repostedByHandle = repostedByHandle
        post.repostedByName = repostedByName
        post.repostedByAvatar = repostedByAvatar
        post.media = media
        post.mediaUrls = mediaUrls
        post.linkPreview = linkPreview
        return post
    }

    private static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: raw) { return d }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: raw)
    }
}

struct AuthorCardResponse: Decodable {
    var id: String
    var name: String?
    var handle: String?
    var avatar: String?
    var description: String?
    var verified: Bool?
    var protected: Bool?
    var following: Bool?
    var isSelf: Bool?

    func asAuthorCard(favorited: Bool) -> AuthorCard {
        AuthorCard(
            id: id,
            name: name,
            handle: handle,
            avatar: avatar,
            description: description,
            verified: verified,
            protected: protected,
            following: following ?? true,
            isSelf: isSelf,
            favorited: favorited,
            error: nil
        )
    }
}

struct ResolveTweetURLResponse: Decodable {
    var tweetId: String?
    var resolvedUrl: String?
}

struct SyncMyTimelineResponse: Decodable {
    var ok: Bool?
    var fetched: Int?
    var written: Int?
    var newestId: String?
}

struct CreateInviteResponse: Decodable {
    var code: String?
    var url: String
    var maxUses: Int?
    var expiresAt: String?
}

struct RegisterDeviceResponse: Decodable {
    var ok: Bool?
}
