import Foundation
import FirebaseFirestore

struct UsageStats: Codable, Hashable {
    var postsRead: Int?
    var postsReadCumulative: Int?
    var cyclePostsRead: Int?
    var priorCyclesPostsRead: Int?
    var todayPostsRead: Int?
    var todayDate: String?
    var projectCap: Int?
    var capResetDay: Int?
    var pricePerPostUsd: Double?
    var estimatedCostUsd: Double?
    var updatedAt: Date?
}

struct PublicConfig: Codable, Hashable {
    var invitesEnabled: Bool?
    var lastRefreshedAt: Date?
    var usage: UsageStats?

    var isInvitesEnabled: Bool { invitesEnabled == true }
}
