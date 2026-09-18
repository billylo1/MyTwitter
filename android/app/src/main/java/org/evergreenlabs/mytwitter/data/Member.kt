package org.evergreenlabs.mytwitter.data

import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.Exclude
import com.google.firebase.firestore.IgnoreExtraProperties

@IgnoreExtraProperties
data class Member(
    @DocumentId val id: String? = null,
    val handle: String? = null,
    val name: String? = null,
    val avatar: String? = null,
    val role: String? = null,
    val enabled: Boolean? = null,
    val xUserId: String? = null,
) {
    @get:Exclude
    val isAdmin: Boolean get() = role == "admin"

    /** Absent field counts as enabled. */
    @get:Exclude
    val isEnabled: Boolean get() = enabled != false

    @get:Exclude
    val displayHandle: String
        get() {
            val h = handle?.trim().orEmpty()
            return h.ifEmpty { id.orEmpty() }
        }
}
