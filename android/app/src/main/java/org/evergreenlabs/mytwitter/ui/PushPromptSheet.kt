package org.evergreenlabs.mytwitter.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.AppGraph
import org.evergreenlabs.mytwitter.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PushPromptSheet(
    onDismiss: () -> Unit,
    onRequestPermission: () -> Unit,
) {
    val push = AppGraph.push
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    fun decline() {
        push.setPushPromptDeclined(true)
        onDismiss()
    }

    ModalBottomSheet(
        onDismissRequest = { decline() },
        sheetState = sheetState,
    ) {
        TopAppBar(
            title = { },
            navigationIcon = {
                IconButton(onClick = { decline() }) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(R.string.close))
                }
            },
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                text = stringResource(R.string.push_prompt_title),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.push_prompt_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(24.dp))
            Button(
                onClick = {
                    push.setPushOptIn(true)
                    onRequestPermission()
                    scope.launch {
                        push.registerDeviceIfPossible()
                    }
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.enable_notifications))
            }
            Spacer(modifier = Modifier.height(8.dp))
            TextButton(
                onClick = { decline() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.not_now))
            }
        }
    }
}
