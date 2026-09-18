package org.evergreenlabs.mytwitter.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import org.evergreenlabs.mytwitter.R
import org.evergreenlabs.mytwitter.data.Post
import org.evergreenlabs.mytwitter.ui.theme.BrandBlue
import org.evergreenlabs.mytwitter.ui.theme.FavoriteYellow
import org.evergreenlabs.mytwitter.ui.theme.LikedPink
import org.evergreenlabs.mytwitter.util.TextHelpers

@Composable
fun PostCard(
    post: Post,
    isLiked: Boolean,
    isFavorited: Boolean,
    isHighlighted: Boolean = false,
    showHitLink: Boolean = true,
    onOpen: () -> Unit,
    onAuthor: () -> Unit,
    onLike: () -> Unit,
    onLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val bodyText = remember(post.text, post.linkPreview) {
        TextHelpers.stripPreviewUrls(post.text.orEmpty(), post.linkPreview)
    }
    val cardShape = RoundedCornerShape(14.dp)
    val backgroundColor = if (isHighlighted) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .then(
                if (showHitLink) {
                    Modifier.clickable(onClick = onOpen)
                } else {
                    Modifier
                },
            ),
    ) {
        if (isFavorited) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .padding(vertical = 10.dp)
                    .width(3.dp)
                    .align(Alignment.CenterStart)
                    .clip(RoundedCornerShape(2.dp))
                    .background(FavoriteYellow.copy(alpha = 0.85f)),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = if (isFavorited) 4.dp else 0.dp)
                .clip(cardShape)
                .background(backgroundColor)
                .padding(12.dp),
        ) {
            if (post.showAsRepost) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Repeat,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = stringResource(
                            R.string.reposted_by,
                            post.repostedByHandle.orEmpty(),
                        ),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
            }

            Row(verticalAlignment = Alignment.Top) {
                AsyncImage(
                    model = post.authorAvatar,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onAuthor,
                        ),
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(
                    modifier = Modifier.weight(1f),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = onAuthor,
                                ),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = post.displayName,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "@${post.displayHandle}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                        Text(
                            text = TextHelpers.relativeTime(post.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (isFavorited) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Default.Star,
                                contentDescription = null,
                                modifier = Modifier.size(12.dp),
                                tint = FavoriteYellow,
                            )
                        }
                    }

                    if (bodyText.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = buildBodyAnnotatedString(bodyText, onLink),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }

                    post.linkPreview?.let { preview ->
                        Spacer(modifier = Modifier.height(10.dp))
                        LinkPreviewCard(
                            preview = preview,
                            onClick = {
                                preview.openUrl?.let(onLink)
                            },
                        )
                    }

                    val media = post.resolvedMedia
                    if (media.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(10.dp))
                        PostMedia(items = media)
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(
                            onClick = onLike,
                            modifier = Modifier.size(40.dp),
                        ) {
                            Icon(
                                imageVector = if (isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                                contentDescription = stringResource(
                                    if (isLiked) R.string.unlike else R.string.like,
                                ),
                                tint = if (isLiked) LikedPink else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = {
                                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, post.xUrl)
                                }
                                context.startActivity(
                                    Intent.createChooser(
                                        shareIntent,
                                        context.getString(R.string.share),
                                    ),
                                )
                            },
                            modifier = Modifier.size(40.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.Share,
                                contentDescription = stringResource(R.string.share),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun buildBodyAnnotatedString(
    text: String,
    onLink: (String) -> Unit,
): androidx.compose.ui.text.AnnotatedString {
    return buildAnnotatedString {
        append(text)
        for (span in TextHelpers.findLinks(text)) {
            addLink(
                LinkAnnotation.Clickable(
                    tag = span.url,
                    styles = TextLinkStyles(style = SpanStyle(color = BrandBlue)),
                    linkInteractionListener = {
                        onLink(span.url)
                    },
                ),
                span.start,
                span.end,
            )
        }
    }
}
