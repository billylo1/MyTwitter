package org.evergreenlabs.mytwitter.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.AppGraph
import org.evergreenlabs.mytwitter.R
import org.evergreenlabs.mytwitter.services.FunctionsClientError

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    modifier: Modifier = Modifier,
) {
    val feed = AppGraph.feed
    val router = AppGraph.router
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    val posts by feed.posts.collectAsStateWithLifecycle()
    val likedIds by feed.likedIds.collectAsStateWithLifecycle()
    val highlightTweetId by feed.highlightTweetId.collectAsStateWithLifecycle()
    val isSyncing by feed.isSyncing.collectAsStateWithLifecycle()
    val publicConfig by feed.publicConfig.collectAsStateWithLifecycle()
    val pendingTweetId by router.pendingTweetId.collectAsStateWithLifecycle()
    val tweetDetailId by router.tweetDetailId.collectAsStateWithLifecycle()
    val showAuthorFor by router.showAuthorFor.collectAsStateWithLifecycle()
    val infoPresented by router.infoPresented.collectAsStateWithLifecycle()

    val syncedAtLabel = remember(publicConfig?.lastRefreshedAt) {
        val date = publicConfig?.lastRefreshedAt ?: return@remember null
        val f = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        "Synced at ${f.format(date)}"
    }

    var localDetailId by remember { mutableStateOf<String?>(null) }
    val activeDetailId = tweetDetailId ?: localDetailId

    LaunchedEffect(pendingTweetId) {
        val id = router.consumePendingTweet() ?: return@LaunchedEffect
        val inFeed = feed.post(id) != null
        if (inFeed) {
            val index = posts.indexOfFirst { it.tweetId == id }
            if (index >= 0) {
                listState.animateScrollToItem(index + 1)
            }
            feed.setHighlightTweetId(id)
            delay(1500)
            if (feed.highlightTweetId.value == id) {
                feed.setHighlightTweetId(null)
            }
        } else {
            router.setTweetDetailId(id)
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = isSyncing,
            onRefresh = {
                scope.launch {
                    feed.syncMyTimeline()
                    feed.syncMessage.value?.let { router.showToast(it) }
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(bottom = 24.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item(key = "header") {
                    FeedHeader(
                        syncedAtLabel = syncedAtLabel,
                        onInfoClick = { router.setInfoPresented(true) },
                        modifier = Modifier.padding(start = 16.dp, end = 8.dp, top = 2.dp, bottom = 2.dp),
                    )
                }

                if (posts.isEmpty()) {
                    item(key = "empty") {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp)
                                .padding(top = 48.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = stringResource(R.string.no_posts_yet),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(modifier = Modifier.padding(top = 8.dp))
                            Text(
                                text = stringResource(R.string.no_posts_hint),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                } else {
                    items(posts, key = { it.tweetId }) { post ->
                        PostCard(
                            post = post,
                            isLiked = likedIds.contains(post.tweetId),
                            isFavorited = feed.isFavorited(post.authorId) ||
                                feed.isFavorited(post.repostedById),
                            isHighlighted = highlightTweetId == post.tweetId,
                            onOpen = { localDetailId = post.tweetId },
                            onAuthor = {
                                router.openAuthor(post.authorId, post.authorHandle)
                            },
                            onLike = {
                                scope.launch {
                                    try {
                                        feed.toggleLike(post.tweetId)
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
                                .padding(horizontal = 12.dp)
                                .padding(bottom = 14.dp),
                        )
                    }
                }
            }
        }
    }

    activeDetailId?.let { id ->
        TweetDetailSheet(
            tweetId = id,
            onDismiss = {
                localDetailId = null
                router.setTweetDetailId(null)
            },
        )
    }

    showAuthorFor?.let { ref ->
        AuthorCardSheet(
            authorRef = ref,
            onDismiss = { router.setShowAuthorFor(null) },
        )
    }

    if (infoPresented) {
        InfoSheet(onDismiss = { router.setInfoPresented(false) })
    }
}

@Composable
private fun FeedHeader(
    syncedAtLabel: String?,
    onInfoClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(modifier = Modifier.weight(1f))
        syncedAtLabel?.let { label ->
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        IconButton(
            onClick = onInfoClick,
            modifier = Modifier
                .size(40.dp)
                .semantics {
                    contentDescription = "Info"
                },
        ) {
            Icon(
                imageVector = Icons.Outlined.Info,
                contentDescription = stringResource(R.string.info),
            )
        }
    }
}
