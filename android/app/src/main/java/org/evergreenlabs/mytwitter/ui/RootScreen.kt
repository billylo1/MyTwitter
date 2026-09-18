package org.evergreenlabs.mytwitter.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.evergreenlabs.mytwitter.AppGraph

@Composable
fun RootScreen(
    modifier: Modifier = Modifier,
) {
    val auth = AppGraph.auth
    val feed = AppGraph.feed
    val router = AppGraph.router
    val push = AppGraph.push
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    val isReady by auth.isReady.collectAsStateWithLifecycle()
    val user by auth.user.collectAsStateWithLifecycle()
    val favorites by feed.favorites.collectAsStateWithLifecycle()
    val notificationsAuthorized by push.notificationsAuthorized.collectAsStateWithLifecycle()
    val pushPromptPresented by router.pushPromptPresented.collectAsStateWithLifecycle()
    val toastMessage by router.toastMessage.collectAsStateWithLifecycle()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        push.onPermissionResult(granted)
        if (granted) {
            scope.launch { push.registerDeviceIfPossible() }
        }
    }

    LaunchedEffect(toastMessage) {
        val message = toastMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        delay(2500)
        router.clearToast()
    }

    LaunchedEffect(user?.uid, notificationsAuthorized) {
        if (user != null && notificationsAuthorized) {
            push.registerDeviceIfPossible()
        }
    }

    LaunchedEffect(user?.uid) {
        val uid = user?.uid
        if (uid != null) {
            feed.start(uid)
        } else {
            feed.stop()
        }
    }

    LaunchedEffect(favorites.size) {
        if (favorites.isEmpty()) return@LaunchedEffect
        if (push.cachedNotificationsAuthorized()) return@LaunchedEffect
        if (push.isPushPromptDeclined()) return@LaunchedEffect
        if (push.isPushOptIn()) return@LaunchedEffect
        delay(8000)
        if (feed.favoritedIds.isNotEmpty() &&
            !push.cachedNotificationsAuthorized() &&
            !push.isPushPromptDeclined()
        ) {
            router.setPushPromptPresented(true)
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                !isReady -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }
                user != null -> {
                    FeedScreen(modifier = Modifier.fillMaxSize())
                }
                else -> {
                    AuthGateScreen(modifier = Modifier.fillMaxSize())
                }
            }
        }
    }

    if (pushPromptPresented) {
        PushPromptSheet(
            onDismiss = { router.setPushPromptPresented(false) },
            onRequestPermission = {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    !push.hasNotificationPermission()
                ) {
                    permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    scope.launch { push.registerDeviceIfPossible() }
                }
            },
        )
    }
}
