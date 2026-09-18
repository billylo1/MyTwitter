import SwiftUI

struct AuthorCardView: View {
    var userId: String?
    var handle: String?

    @Environment(FeedStore.self) private var feed
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var card: AuthorCard?
    @State private var statusMessage: String?
    @State private var isLoading = true
    @State private var isTogglingFollow = false
    @State private var isTogglingFavorite = false

    private static var cache: [String: AuthorCard] = [:]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && card == nil {
                    ProgressView("Loading…")
                } else if let card {
                    content(card)
                } else {
                    ContentUnavailableView(
                        "Profile unavailable",
                        systemImage: "person.crop.circle.badge.exclamationmark",
                        description: Text(statusMessage ?? "Could not load this profile.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding()
            .background(Color(.systemBackground))
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    @ViewBuilder
    private func content(_ card: AuthorCard) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                AsyncImage(url: URL(string: card.avatar ?? "")) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Circle().fill(Color.secondary.opacity(0.25))
                    }
                }
                .frame(width: 64, height: 64)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(card.displayName)
                            .font(.title3.weight(.semibold))
                        if card.verified == true {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(.blue)
                                .font(.subheadline)
                        }
                    }
                    Text("@\(card.displayHandle)")
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            if let bio = card.description, !bio.isEmpty {
                Text(bio)
                    .font(.body)
            }

            if let statusMessage, !statusMessage.isEmpty {
                Text(statusMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            if card.isSelf != true {
                HStack(spacing: 12) {
                    Button {
                        Task { await toggleFollow() }
                    } label: {
                        if isTogglingFollow {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text(card.following == true ? "Following" : "Follow")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(card.following == true ? .secondary : .accentColor)
                    .disabled(isTogglingFollow)

                    Button {
                        Task { await toggleFavorite() }
                    } label: {
                        if isTogglingFavorite {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Label(
                                card.favorited == true ? "Favorited" : "Favorite",
                                systemImage: card.favorited == true ? "star.fill" : "star"
                            )
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isTogglingFavorite)
                }
            }

            Spacer()
        }
    }

    private func cacheKey() -> String {
        userId ?? handle ?? ""
    }

    private func load() async {
        let key = cacheKey()
        if let cached = Self.cache[key] {
            card = cached
            isLoading = false
        }
        isLoading = card == nil
        do {
            var data: [String: Any] = [:]
            if let userId, !userId.isEmpty { data["userId"] = userId }
            if let handle, !handle.isEmpty { data["handle"] = handle }
            let response: AuthorCardResponse = try await FunctionsClient.shared.call(
                "getAuthorCard",
                data: data
            )
            let favorited = feed.isFavorited(response.id)
            let loaded = response.asAuthorCard(favorited: favorited)
            card = loaded
            Self.cache[key] = loaded
            Self.cache[response.id] = loaded
            statusMessage = nil
        } catch let error as FunctionsClientError {
            if case .failedPrecondition(let msg) = error {
                statusMessage = msg
            } else {
                statusMessage = error.localizedDescription
            }
        } catch {
            statusMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func toggleFollow() async {
        guard var card else { return }
        isTogglingFollow = true
        defer { isTogglingFollow = false }
        let next = !(card.following == true)
        do {
            try await FunctionsClient.shared.callVoid(
                "setFollowing",
                data: ["userId": card.id, "follow": next]
            )
            card.following = next
            self.card = card
            Self.cache[card.id] = card
            statusMessage = nil
        } catch let error as FunctionsClientError {
            if case .failedPrecondition(let msg) = error {
                statusMessage = msg
            } else {
                statusMessage = error.localizedDescription
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func toggleFavorite() async {
        guard var card else { return }
        isTogglingFavorite = true
        defer { isTogglingFavorite = false }
        do {
            try await feed.toggleFavorite(author: card)
            card.favorited = !(card.favorited == true)
            self.card = card
            Self.cache[card.id] = card
            // Soft-prompt after first favorite
            if card.favorited == true,
               !PushService.shared.cachedNotificationsAuthorized(),
               !UserDefaults.standard.bool(forKey: "pushPromptDeclined")
            {
                router.pushPromptPresented = true
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }
}
