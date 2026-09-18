package org.evergreenlabs.mytwitter.data

import com.google.firebase.firestore.Exclude
import com.google.firebase.firestore.IgnoreExtraProperties
import java.util.Date

@IgnoreExtraProperties
data class UsageStats(
    val postsRead: Int? = null,
    val postsReadCumulative: Int? = null,
    val cyclePostsRead: Int? = null,
    val priorCyclesPostsRead: Int? = null,
    val todayPostsRead: Int? = null,
    val todayDate: String? = null,
    val projectCap: Int? = null,
    val capResetDay: Int? = null,
    val pricePerPostUsd: Double? = null,
    val estimatedCostUsd: Double? = null,
    val updatedAt: Date? = null,
)

@IgnoreExtraProperties
data class PublicConfig(
    val invitesEnabled: Boolean? = null,
    val lastRefreshedAt: Date? = null,
    val usage: UsageStats? = null,
) {
    // Must Exclude — Firestore treats Boolean `invitesEnabled` + `isInvitesEnabled` as conflicts.
    @get:Exclude
    val isInvitesEnabled: Boolean get() = invitesEnabled == true
}
