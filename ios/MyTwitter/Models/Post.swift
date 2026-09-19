import Foundation
import FirebaseFirestore

struct MediaItem: Codable, Hashable, Identifiable {
    var id: String {
        "\(type ?? "media")-\(url ?? previewUrl ?? videoUrl ?? "unknown")"
    }
    var type: String?
    var url: String?
    var previewUrl: String?
    var videoUrl: String?
    var width: Int?
    var height: Int?
    var alt: String?

    var isVideo: Bool {
        let t = (type ?? "").lowercased()
        return t == "video" || t == "animated_gif"
    }

    var displayImageURL: URL? {
        URL(string: previewUrl ?? url ?? "")
    }

    var playableVideoURL: URL? {
        guard let videoUrl, !videoUrl.isEmpty else { return nil }
        return URL(string: videoUrl)
    }

    /// Width/height from X when present; otherwise a 16:9 fallback so layouts don't stretch.
    var aspectRatio: CGFloat {
        let w = CGFloat(width ?? 0)
        let h = CGFloat(height ?? 0)
        guard w > 0, h > 0 else { return 16.0 / 9.0 }
        return min(max(w / h, 0.45), 2.4)
    }
}

struct LinkPreview: Codable, Hashable {
    var url: String?
    var tcoUrl: String?
    var expandedUrl: String?
    var displayUrl: String?
    var domain: String?
    var title: String?
    var description: String?
    var imageUrl: String?

    var openURL: URL? {
        URL(string: expandedUrl ?? url ?? tcoUrl ?? "")
    }
}

struct Post: Codable, Identifiable, Hashable {
    @DocumentID var id: String?
    var text: String?
    var url: String?
    var authorId: String?
    var authorHandle: String?
    var authorName: String?
    var authorAvatar: String?
    var createdAt: Date?
    var isRetweet: Bool?
    var repostedById: String?
    var repostedByHandle: String?
    var repostedByName: String?
    var repostedByAvatar: String?
    var media: [MediaItem]?
    var mediaUrls: [String]?
    var linkPreview: LinkPreview?

    var tweetId: String { id ?? "" }

    var displayHandle: String {
        let h = (authorHandle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return h.isEmpty ? "unknown" : h
    }

    var displayName: String {
        let n = (authorName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? "@\(displayHandle)" : n
    }

    var xURL: URL {
        if let url, let parsed = URL(string: url) { return parsed }
        return URL(string: "https://x.com/i/status/\(tweetId)")!
    }

    var resolvedMedia: [MediaItem] {
        if let media, !media.isEmpty { return media }
        return (mediaUrls ?? []).compactMap { u in
            guard !u.isEmpty else { return nil }
            return MediaItem(type: "photo", url: u, previewUrl: u, videoUrl: nil, width: nil, height: nil, alt: nil)
        }
    }

    var showAsRepost: Bool {
        (isRetweet == true) && !(repostedByHandle ?? "").isEmpty
            && (repostedById != authorId)
    }
}
