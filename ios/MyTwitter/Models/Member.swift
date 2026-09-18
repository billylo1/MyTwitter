import Foundation
import FirebaseFirestore

struct Member: Codable, Identifiable, Hashable {
    @DocumentID var id: String?
    var handle: String?
    var name: String?
    var avatar: String?
    var role: String?
    var enabled: Bool?
    var xUserId: String?

    var isAdmin: Bool { role == "admin" }
    var isEnabled: Bool { enabled != false }

    var displayHandle: String {
        let h = (handle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return h.isEmpty ? (id ?? "") : h
    }
}
