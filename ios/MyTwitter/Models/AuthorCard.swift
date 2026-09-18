import Foundation
import FirebaseFirestore

struct AuthorCard: Codable, Hashable, Identifiable {
    var id: String
    var name: String?
    var handle: String?
    var avatar: String?
    var description: String?
    var verified: Bool?
    var protected: Bool?
    var following: Bool?
    var isSelf: Bool?
    var favorited: Bool?
    var error: String?

    var displayHandle: String {
        let h = (handle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return h.isEmpty ? id : h
    }

    var displayName: String {
        let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? "@\(displayHandle)" : n
    }
}

struct FavoriteAuthor: Codable, Hashable, Identifiable {
    @DocumentID var id: String?
    var handle: String?
    var name: String?
    var avatar: String?
    var favoritedAt: Date?
}
