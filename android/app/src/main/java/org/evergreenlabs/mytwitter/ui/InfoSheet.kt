package org.evergreenlabs.mytwitter.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.AppConfig
import org.evergreenlabs.mytwitter.AppGraph
import org.evergreenlabs.mytwitter.R
import org.evergreenlabs.mytwitter.services.FunctionsClient
import org.evergreenlabs.mytwitter.ui.theme.ErrorRed
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InfoSheet(
    onDismiss: () -> Unit,
) {
    val auth = AppGraph.auth
    val feed = AppGraph.feed
    val router = AppGraph.router
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val member by auth.member.collectAsStateWithLifecycle()
    val statusText by feed.statusText.collectAsStateWithLifecycle()
    val publicConfig by feed.publicConfig.collectAsStateWithLifecycle()

    var rssUrl by remember { mutableStateOf<String?>(null) }
    var inviteUrl by remember { mutableStateOf<String?>(null) }
    var inviteBusy by remember { mutableStateOf(false) }
    var adminMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            rssUrl = FunctionsClient.shared.getRssFeedUrl()
        } catch (_: Exception) {
            // RSS is optional
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
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.align(Alignment.CenterStart),
            ) {
                Text(stringResource(R.string.done))
            }
            Text(
                text = stringResource(R.string.info),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                text = stringResource(R.string.info_blurb),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = statusText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(
                    R.string.version_label,
                    AppConfig.versionName,
                    AppConfig.versionCode,
                ),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            rssUrl?.let { url ->
                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.rss),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                        }
                        context.startActivity(
                            Intent.createChooser(
                                shareIntent,
                                context.getString(R.string.share_rss),
                            ),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.share_rss))
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.open_rss))
                }
            }

            if (member?.isAdmin == true) {
                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.admin),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = usageLine(publicConfig?.usage),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (publicConfig?.isInvitesEnabled == true) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = {
                            inviteBusy = true
                            scope.launch {
                                try {
                                    val response = FunctionsClient.shared.createInvite(
                                        maxUses = 5,
                                        days = 14,
                                    )
                                    inviteUrl = response.url
                                    adminMessage = null
                                    copyToClipboard(context, response.url)
                                    router.showToast(context.getString(R.string.invite_copied))
                                } catch (e: Exception) {
                                    adminMessage = e.message
                                } finally {
                                    inviteBusy = false
                                }
                            }
                        },
                        enabled = !inviteBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (inviteBusy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(stringResource(R.string.create_invite))
                        }
                    }
                    inviteUrl?.let { url ->
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = {
                                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, url)
                                }
                                context.startActivity(
                                    Intent.createChooser(
                                        shareIntent,
                                        context.getString(R.string.share_invite),
                                    ),
                                )
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(stringResource(R.string.share_invite))
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = url,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                adminMessage?.let { msg ->
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = msg,
                        style = MaterialTheme.typography.bodySmall,
                        color = ErrorRed,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            member?.displayHandle?.takeIf { it.isNotBlank() }?.let { handle ->
                Text(
                    text = "@$handle",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(12.dp))
            }
            Button(
                onClick = {
                    feed.stop()
                    auth.signOut()
                    onDismiss()
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.sign_out))
            }
        }
    }
}

private fun usageLine(usage: org.evergreenlabs.mytwitter.data.UsageStats?): String {
    val total = usage?.postsReadCumulative ?: usage?.postsRead ?: 0
    val price = usage?.pricePerPostUsd ?: 0.005
    val cumulative = usage?.estimatedCostUsd ?: (total * price)
    val today = usage?.todayPostsRead ?: 0
    val todayCost = today * price
    return "$total posts read · ~$${String.format(Locale.US, "%.2f", cumulative)} cumulative · " +
        "$today today (~$${String.format(Locale.US, "%.2f", todayCost)})"
}

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("invite", text))
}
