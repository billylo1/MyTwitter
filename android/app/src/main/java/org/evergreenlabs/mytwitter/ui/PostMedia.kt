package org.evergreenlabs.mytwitter.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem as ExoMediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import coil3.compose.SubcomposeAsyncImage
import org.evergreenlabs.mytwitter.data.MediaItem

private object SharedExoPlayerHolder {
    private var player: ExoPlayer? = null
    private var activeUrl: String? = null

    fun player(context: Context): ExoPlayer {
        return player ?: ExoPlayer.Builder(context.applicationContext).build().apply {
            volume = 0f
            repeatMode = Player.REPEAT_MODE_ONE
            playWhenReady = false
        }.also { player = it }
    }

    fun play(context: Context, url: String) {
        val exo = player(context)
        if (activeUrl != url) {
            activeUrl = url
            exo.setMediaItem(ExoMediaItem.fromUri(url))
            exo.prepare()
        }
        exo.playWhenReady = true
        exo.play()
    }

    fun pause() {
        player?.playWhenReady = false
        player?.pause()
    }
}

@Composable
fun PostMedia(
    items: List<MediaItem>,
    modifier: Modifier = Modifier,
) {
    val gridItems = remember(items) { items.take(4) }
    if (gridItems.isEmpty()) return

    if (gridItems.size == 1) {
        val item = gridItems.first()
        MediaCell(
            item = item,
            single = true,
            modifier = modifier
                .fillMaxWidth()
                .heightIn(max = 320.dp)
                .clip(RoundedCornerShape(12.dp)),
        )
    } else {
        val rows = (gridItems.size + 1) / 2
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = modifier
                .fillMaxWidth()
                .height((rows * 160).dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            userScrollEnabled = false,
        ) {
            itemsIndexed(gridItems, key = { index, item ->
                "${index}_${item.displayImageUrl}_${item.playableVideoUrl}"
            }) { _, item ->
                MediaCell(
                    item = item,
                    single = false,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(8.dp)),
                )
            }
        }
    }
}

@Composable
private fun MediaCell(
    item: MediaItem,
    single: Boolean,
    modifier: Modifier = Modifier,
) {
    val ratio = item.aspectRatio
    if (item.isVideo && !item.playableVideoUrl.isNullOrBlank()) {
        LoopingVideo(
            videoUrl = item.playableVideoUrl!!,
            posterUrl = item.displayImageUrl,
            aspectRatio = ratio,
            modifier = if (single) {
                modifier.aspectRatio(ratio)
            } else {
                modifier
            },
        )
    } else if (!item.displayImageUrl.isNullOrBlank()) {
        SubcomposeAsyncImage(
            model = item.displayImageUrl,
            contentDescription = item.alt,
            contentScale = if (single) ContentScale.Fit else ContentScale.Crop,
            modifier = if (single) {
                modifier.aspectRatio(ratio)
            } else {
                modifier.fillMaxSize()
            },
            loading = {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            },
            error = {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            },
        )
    } else {
        Box(
            modifier = modifier
                .then(if (single) Modifier.aspectRatio(ratio) else Modifier.fillMaxSize())
                .background(MaterialTheme.colorScheme.surfaceVariant),
        )
    }
}

@Composable
fun LoopingVideo(
    videoUrl: String,
    posterUrl: String?,
    aspectRatio: Float,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val view = LocalView.current
    var isVisible by remember { mutableStateOf(false) }
    val exoPlayer = remember { SharedExoPlayerHolder.player(context) }

    LaunchedEffect(isVisible, videoUrl) {
        if (isVisible) {
            SharedExoPlayerHolder.play(context, videoUrl)
        } else {
            SharedExoPlayerHolder.pause()
        }
    }

    DisposableEffect(videoUrl) {
        onDispose {
            if (isVisible) {
                SharedExoPlayerHolder.pause()
            }
        }
    }

    Box(
        modifier = modifier
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .onGloballyPositioned { coordinates ->
                val pos = coordinates.positionInWindow()
                val size = coordinates.size
                val windowHeight = view.height.toFloat()
                val windowWidth = view.width.toFloat()
                val visible = pos.y + size.height > 0 &&
                    pos.y < windowHeight &&
                    pos.x + size.width > 0 &&
                    pos.x < windowWidth &&
                    size.height > 0
                isVisible = visible
            },
        contentAlignment = Alignment.Center,
    ) {
        if (isVisible) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        player = exoPlayer
                        useController = false
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    }
                },
                update = { playerView ->
                    playerView.player = exoPlayer
                    playerView.useController = false
                    playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else if (!posterUrl.isNullOrBlank()) {
            AsyncImage(
                model = posterUrl,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
