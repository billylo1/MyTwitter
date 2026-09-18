package org.evergreenlabs.mytwitter.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.evergreenlabs.mytwitter.AppGraph
import org.evergreenlabs.mytwitter.R
import org.evergreenlabs.mytwitter.ui.theme.ErrorRed

@Composable
fun AuthGateScreen(
    modifier: Modifier = Modifier,
) {
    val auth = AppGraph.auth
    val context = LocalContext.current
    val authError by auth.authError.collectAsStateWithLifecycle()
    val isBusy by auth.isBusy.collectAsStateWithLifecycle()
    val pendingInvite by auth.pendingInvite.collectAsStateWithLifecycle()

    val gateMessage = if (!pendingInvite.isNullOrBlank()) {
        stringResource(R.string.gate_message_invite)
    } else {
        stringResource(R.string.gate_message)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.weight(1f))
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = gateMessage,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        if (!authError.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = authError.orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                color = ErrorRed,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
        }
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = { auth.signIn(context) },
            enabled = !isBusy,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
        ) {
            if (isBusy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp,
                )
            } else {
                Text(stringResource(R.string.sign_in_with_x))
            }
        }
        Spacer(modifier = Modifier.weight(1f))
    }
}
