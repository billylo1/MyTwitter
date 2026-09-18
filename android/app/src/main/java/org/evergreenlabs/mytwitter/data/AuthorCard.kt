package org.evergreenlabs.mytwitter.data

import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.Exclude
import com.google.firebase.firestore.IgnoreExtraProperties
import java.util.Date

@IgnoreExtraProperties
data class AuthorCard(
    val id: String = "",
    val name: String? = null,
    val handle: String? = null,
    val avatar: String? = null,
    val description: String? = null,
    val verified: Boolean? = null,
    val protected: Boolean? = null,
    val following: Boolean? = null,
    val isSelf: Boolean? = null,
    val favorited: Boolean? = null,
    val error: String? = null,
) {
    @get:Exclude
    val displayHandle: String
        get() {
            val h = handle?.trim().orEmpty()
            return h.ifEmpty { id }
        }

    @get:Exclude
    val displayName: String
        get() {
            val n = name?.trim().orEmpty()
            return n.ifEmpty { "@$displayHandle" }
        }
}

@IgnoreExtraProperties
data class FavoriteAuthor(
    @DocumentId val id: String? = null,
    val handle: String? = null,
    val name: String? = null,
    val avatar: String? = null,
    val favoritedAt: Date? = null,
)
