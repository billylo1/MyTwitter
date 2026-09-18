import SwiftUI

struct RootView: View {
    @Environment(AuthService.self) private var auth
    @Environment(FeedStore.self) private var feed
    @Environment(DeepLinkRouter.self) private var router

    var body: some View {
        Group {
            if !auth.isReady {
                ProgressView("Loading…")
            } else if auth.isSignedIn {
                FeedView()
                    .onAppear {
                        if let uid = auth.user?.uid {
                            feed.start(uid: uid)
                        }
                    }
                    .onChange(of: auth.user?.uid) { _, uid in
                        if let uid {
                            feed.start(uid: uid)
                        } else {
                            feed.stop()
                        }
                    }
            } else {
                AuthGateView()
                    .onAppear { feed.stop() }
            }
        }
        .task(id: auth.user?.uid) {
            guard auth.user != nil else { return }
            await registerDeviceIfNeeded()
        }
        .onChange(of: feed.favoritedIds.count) { _, count in
            maybeShowPushPrompt(favoriteCount: count)
        }
        .sheet(isPresented: Binding(
            get: { router.pushPromptPresented },
            set: { router.pushPromptPresented = $0 }
        )) {
            PushPromptSheet()
                .presentationBackground(.background)
        }
        .overlay(alignment: .bottom) {
            if let toast = router.toastMessage {
                Text(toast)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear {
                        Task {
                            try? await Task.sleep(for: .seconds(2.5))
                            router.toastMessage = nil
                        }
                    }
            }
        }
    }

    private func registerDeviceIfNeeded() async {
        guard PushService.shared.cachedNotificationsAuthorized() else { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            PushService.shared.fetchFcmToken { token in
                Task {
                    defer { cont.resume() }
                    guard let token, !token.isEmpty else { return }
                    try? await FunctionsClient.shared.callVoid(
                        "registerDevice",
                        data: ["token": token, "platform": "ios"]
                    )
                }
            }
        }
    }

    private func maybeShowPushPrompt(favoriteCount: Int) {
        guard favoriteCount > 0 else { return }
        guard !PushService.shared.cachedNotificationsAuthorized() else { return }
        guard !UserDefaults.standard.bool(forKey: "pushPromptDeclined") else { return }
        guard !UserDefaults.standard.bool(forKey: "pushOptIn") else { return }
        Task {
            try? await Task.sleep(for: .seconds(8))
            if feed.favoritedIds.count > 0,
               !PushService.shared.cachedNotificationsAuthorized(),
               !UserDefaults.standard.bool(forKey: "pushPromptDeclined")
            {
                router.pushPromptPresented = true
            }
        }
    }
}

private struct PushPromptSheet: View {
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Get notified when people you favorite post?")
                    .font(.title3.weight(.semibold))
                Text("We’ll only notify you about accounts you’ve starred.")
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    UserDefaults.standard.set(true, forKey: "pushOptIn")
                    PushService.shared.fetchFcmToken { token in
                        Task {
                            if let token, !token.isEmpty {
                                try? await FunctionsClient.shared.callVoid(
                                    "registerDevice",
                                    data: ["token": token, "platform": "ios"]
                                )
                            }
                        }
                    }
                    dismiss()
                } label: {
                    Text("Enable notifications")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Button("Not now") {
                    UserDefaults.standard.set(true, forKey: "pushPromptDeclined")
                    dismiss()
                }
                .frame(maxWidth: .infinity)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(.systemBackground))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        UserDefaults.standard.set(true, forKey: "pushPromptDeclined")
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
