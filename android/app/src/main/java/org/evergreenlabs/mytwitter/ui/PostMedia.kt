package org.evergreenlabs.mytwitter.ui

import android.content.Context
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem as ExoMediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import coil3.compose.SubcomposeAsyncImage
import org.evergreenlabs.mytwitter.data.MediaItem

private val MultiGap = 8.dp
private const val SingleAspectRatio = 4f / 3f

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

    var fullscreenItem by remember { mutableStateOf<MediaItem?>(null) }

    if (gridItems.size == 1) {
        val item = gridItems.first()
        MediaCell(
            item = item,
            onOpen = {
                SharedExoPlayerHolder.pause()
                fullscreenItem = item
            },
            modifier = modifier
                .fillMaxWidth()
                .aspectRatio(SingleAspectRatio)
                .clip(RoundedCornerShape(12.dp)),
        )
    } else {
        // Web: .media.media-multi → 2-column grid, square cells, object-fit cover
        val rows = remember(gridItems) { gridItems.chunked(2) }
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(MultiGap),
        ) {
            rows.forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(MultiGap),
                ) {
                    row.forEach { item ->
                        MediaCell(
                            item = item,
                            onOpen = {
                                SharedExoPlayerHolder.pause()
                                fullscreenItem = item
                            },
                            modifier = Modifier
                                .weight(1f)
                                .aspectRatio(1f)
                                .clip(RoundedCornerShape(12.dp)),
                        )
                    }
                    if (row.size == 1) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }

    fullscreenItem?.let { item ->
        MediaFullscreenDialog(
            item = item,
            onDismiss = { fullscreenItem = null },
        )
    }
}

@Composable
private fun MediaFullscreenDialog(
    item: MediaItem,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
        ) {
            ZoomableBox(modifier = Modifier.fillMaxSize()) {
                val videoUrl = item.playableVideoUrl
                if (item.isVideo && !videoUrl.isNullOrBlank()) {
                    FullscreenVideo(
                        videoUrl = videoUrl,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else if (!item.displayImageUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = item.displayImageUrl,
                        contentDescription = item.alt,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxSize()
                            .align(Alignment.Center),
                    )
                }
            }

            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .statusBarsPadding()
                    .padding(8.dp)
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.2f)),
            ) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Close",
                    tint = Color.White,
                )
            }
        }
    }
}

@Composable
private fun ZoomableBox(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        val next = (scale * zoomChange).coerceIn(1f, 5f)
        scale = next
        if (next > 1.01f) {
            offset += panChange
        } else {
            offset = Offset.Zero
        }
    }

    BoxWithConstraints(modifier = modifier) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = {
                            if (scale > 1.05f) {
                                scale = 1f
                                offset = Offset.Zero
                            } else {
                                scale = 2.5f
                            }
                        },
                    )
                }
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                }
                .transformable(state = transformState),
            content = content,
        )
    }
}

@Composable
private fun FullscreenVideo(
    videoUrl: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val exoPlayer = remember(videoUrl) {
        ExoPlayer.Builder(context.applicationContext).build().apply {
            volume = 1f
            repeatMode = Player.REPEAT_MODE_OFF
            setMediaItem(ExoMediaItem.fromUri(videoUrl))
            prepare()
            playWhenReady = true
        }
    }

    DisposableEffect(exoPlayer) {
        onDispose {
            exoPlayer.release()
        }
    }

    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                player = exoPlayer
                useController = true
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }
        },
        update = { playerView ->
            playerView.player = exoPlayer
        },
        modifier = modifier,
    )
}

@Composable
private fun MediaCell(
    item: MediaItem,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ratio = item.aspectRatio
    Box(
        modifier = modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onOpen,
            ),
    ) {
        if (item.isVideo && !item.playableVideoUrl.isNullOrBlank()) {
            LoopingVideo(
                videoUrl = item.playableVideoUrl!!,
                posterUrl = item.displayImageUrl,
                aspectRatio = ratio,
                modifier = Modifier.fillMaxSize(),
            )
        } else if (!item.displayImageUrl.isNullOrBlank()) {
            SubcomposeAsyncImage(
                model = item.displayImageUrl,
                contentDescription = item.alt,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
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
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
        }
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
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
