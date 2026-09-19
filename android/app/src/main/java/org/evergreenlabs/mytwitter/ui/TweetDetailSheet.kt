package org.evergreenlabs.mytwitter.ui

import android.content.Intent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.AppGraph
import org.evergreenlabs.mytwitter.R
import org.evergreenlabs.mytwitter.data.Post
import org.evergreenlabs.mytwitter.services.FunctionsClientError

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TweetDetailSheet(
    tweetId: String,
    onDismiss: () -> Unit,
) {
    val feed = AppGraph.feed
    val router = AppGraph.router
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)

    var post by remember(tweetId) { mutableStateOf<Post?>(null) }
    var errorMessage by remember(tweetId) { mutableStateOf<String?>(null) }
    var isLoading by remember(tweetId) { mutableStateOf(true) }

    LaunchedEffect(tweetId) {
        isLoading = true
        errorMessage = null
        try {
            post = feed.loadTweet(tweetId)
        } catch (e: Exception) {
            errorMessage = e.message ?: "Could not load this post."
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
                text = stringResource(R.string.post),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.align(Alignment.Center),
            )
            post?.let { loaded ->
                IconButton(
                    onClick = {
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, loaded.xUrl)
                        }
                        context.startActivity(
                            Intent.createChooser(
                                shareIntent,
                                context.getString(R.string.share),
                            ),
                        )
                    },
                    modifier = Modifier.align(Alignment.CenterEnd),
                ) {
                    Icon(Icons.Default.Share, contentDescription = stringResource(R.string.share))
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 24.dp),
        ) {
            when {
                isLoading -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(28.dp),
                            strokeWidth = 3.dp,
                        )
                    }
                }
                post != null -> {
                    val loaded = post!!
                    PostCard(
                        post = loaded,
                        isLiked = feed.isLiked(loaded.tweetId),
                        isFavorited = feed.isFavorited(loaded.authorId) ||
                            feed.isFavorited(loaded.repostedById),
                        onAuthor = {
                            router.openAuthor(loaded.authorId, loaded.authorHandle)
                        },
                        onLike = {
                            scope.launch {
                                try {
                                    feed.toggleLike(loaded.tweetId)
                                } catch (e: FunctionsClientError.FailedPrecondition) {
                                    router.showToast(e.message.orEmpty())
                                } catch (e: Exception) {
                                    router.showToast(e.message.orEmpty())
                                }
                            }
                        },
                        onLink = { url ->
                            scope.launch {
                                router.openTweetUrl(
                                    android.net.Uri.parse(url),
                                    feed,
                                )
                            }
                        },
                        modifier = Modifier
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp),
                    )
                }
                else -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        ColumnUnavailable(
                            title = stringResource(R.string.tweet_unavailable),
                            message = errorMessage ?: "Could not load this post.",
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
) {
    androidx.compose.foundation.layout.Column(
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
