package org.evergreenlabs.mytwitter.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.AppGraph
import org.evergreenlabs.mytwitter.R
import org.evergreenlabs.mytwitter.data.AuthorCard
import org.evergreenlabs.mytwitter.services.AuthorRef
import org.evergreenlabs.mytwitter.services.FunctionsClient
import org.evergreenlabs.mytwitter.services.FunctionsClientError
import org.evergreenlabs.mytwitter.ui.theme.ErrorRed
import org.evergreenlabs.mytwitter.ui.theme.VerifiedBlue

private val authorCardCache = mutableMapOf<String, AuthorCard>()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthorCardSheet(
    authorRef: AuthorRef,
    onDismiss: () -> Unit,
) {
    val feed = AppGraph.feed
    val router = AppGraph.router
    val push = AppGraph.push
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var card by remember(authorRef.key) { mutableStateOf<AuthorCard?>(null) }
    var statusMessage by remember(authorRef.key) { mutableStateOf<String?>(null) }
    var isLoading by remember(authorRef.key) { mutableStateOf(true) }
    var isTogglingFollow by remember { mutableStateOf(false) }
    var isTogglingFavorite by remember { mutableStateOf(false) }

    LaunchedEffect(authorRef.key) {
        val key = authorRef.key
        authorCardCache[key]?.let {
            card = it
            isLoading = false
        } ?: run {
            isLoading = true
        }
        try {
            val response = FunctionsClient.shared.getAuthorCard(
                userId = authorRef.userId,
                handle = authorRef.handle,
            )
            val withFavorite = response.copy(favorited = feed.isFavorited(response.id))
            card = withFavorite
            authorCardCache[key] = withFavorite
            authorCardCache[withFavorite.id] = withFavorite
            statusMessage = null
        } catch (e: FunctionsClientError.FailedPrecondition) {
            statusMessage = e.message
        } catch (e: Exception) {
            statusMessage = e.message
        } finally {
            isLoading = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
        ) {
            IconButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.CenterStart),
            ) {
                Icon(Icons.Default.Close, contentDescription = stringResource(R.string.close))
            }
            Text(
                text = "Profile",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        when {
            isLoading && card == null -> {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                }
            }
            card != null -> {
                AuthorCardContent(
                    card = card!!,
                    statusMessage = statusMessage,
                    isTogglingFollow = isTogglingFollow,
                    isTogglingFavorite = isTogglingFavorite,
                    onToggleFollow = {
                        val current = card ?: return@AuthorCardContent
                        isTogglingFollow = true
                        scope.launch {
                            try {
                                val next = current.following != true
                                FunctionsClient.shared.setFollowing(current.id, next)
                                val updated = current.copy(following = next)
                                card = updated
                                authorCardCache[current.id] = updated
                                authorCardCache[authorRef.key] = updated
                                statusMessage = null
                            } catch (e: FunctionsClientError.FailedPrecondition) {
                                statusMessage = e.message
                            } catch (e: Exception) {
                                statusMessage = e.message
                            } finally {
                                isTogglingFollow = false
                            }
                        }
                    },
                    onToggleFavorite = {
                        val current = card ?: return@AuthorCardContent
                        isTogglingFavorite = true
                        scope.launch {
                            try {
                                feed.toggleFavorite(current)
                                val updated = current.copy(favorited = current.favorited != true)
                                card = updated
                                authorCardCache[current.id] = updated
                                authorCardCache[authorRef.key] = updated
                                statusMessage = null
                                if (updated.favorited == true &&
                                    !push.cachedNotificationsAuthorized() &&
                                    !push.isPushPromptDeclined()
                                ) {
                                    router.setPushPromptPresented(true)
                                }
                            } catch (e: Exception) {
                                statusMessage = e.message
                            } finally {
                                isTogglingFavorite = false
                            }
                        }
                    },
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            else -> {
                ColumnUnavailable(
                    title = "Profile unavailable",
                    message = statusMessage ?: "Could not load this profile.",
                    modifier = Modifier.padding(32.dp),
                )
            }
        }
        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun AuthorCardContent(
    card: AuthorCard,
    statusMessage: String?,
    isTogglingFollow: Boolean,
    isTogglingFavorite: Boolean,
    onToggleFollow: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = card.avatar,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape),
            )
            Spacer(modifier = Modifier.width(14.dp))
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = card.displayName,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (card.verified == true) {
                        Spacer(modifier = Modifier.width(4.dp))
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = VerifiedBlue,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
                Text(
                    text = "@${card.displayHandle}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        card.description?.takeIf { it.isNotBlank() }?.let { bio ->
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = bio,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        if (!statusMessage.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = statusMessage,
                style = MaterialTheme.typography.bodySmall,
                color = ErrorRed,
            )
        }

        if (card.isSelf != true) {
            Spacer(modifier = Modifier.height(16.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = onToggleFollow,
                    enabled = !isTogglingFollow,
                    colors = if (card.following == true) {
                        ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.secondary,
                        )
                    } else {
                        ButtonDefaults.buttonColors()
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    if (isTogglingFollow) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Text(
                            stringResource(
                                if (card.following == true) R.string.following else R.string.follow,
                            ),
                        )
                    }
                }
                Spacer(modifier = Modifier.width(12.dp))
                OutlinedButton(
                    onClick = onToggleFavorite,
                    enabled = !isTogglingFavorite,
                    modifier = Modifier.weight(1f),
                ) {
                    if (isTogglingFavorite) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            imageVector = if (card.favorited == true) {
                                Icons.Default.Star
                            } else {
                                Icons.Outlined.StarOutline
                            },
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            stringResource(
                                if (card.favorited == true) R.string.unfavorite else R.string.favorite,
                            ),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnUnavailable(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
