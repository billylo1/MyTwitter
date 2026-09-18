import SwiftUI
import UIKit

struct InfoSheet: View {
    @Environment(AuthService.self) private var auth
    @Environment(FeedStore.self) private var feed
    @Environment(DeepLinkRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var rssURL: URL?
    @State private var inviteURL: String?
    @State private var inviteBusy = false
    @State private var adminMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Your private following feed from X. Posts sync about every 10 minutes; pull to refresh anytime.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(feed.statusText)
                        .font(.subheadline)
                    Text("Version \(AppConfig.versionName) (\(AppConfig.versionCode))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let rssURL {
                    Section("RSS") {
                        ShareLink("Share RSS feed URL", item: rssURL)
                        Link("Open RSS feed", destination: rssURL)
                    }
                }

                if auth.member?.isAdmin == true {
                    Section("Admin") {
                        Text(usageLine)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if feed.publicConfig?.isInvitesEnabled == true {
                            Button {
                                Task { await createInvite() }
                            } label: {
                                if inviteBusy {
                                    ProgressView()
                                } else {
                                    Text("Create invite link")
                                }
                            }
                            .disabled(inviteBusy)
                            if let inviteURL {
                                ShareLink("Share invite", item: inviteURL)
                                Text(inviteURL)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                        if let adminMessage {
                            Text(adminMessage)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                }

                Section {
                    if let handle = auth.member?.displayHandle, !handle.isEmpty {
                        Text("@\(handle)")
                    }
                    Button("Sign out", role: .destructive) {
                        feed.stop()
                        auth.signOut()
                        dismiss()
                    }
                }
            }
            .navigationTitle("Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await loadRss() }
        }
    }

    private var usageLine: String {
        let usage = feed.publicConfig?.usage
        let total = usage?.postsReadCumulative ?? usage?.postsRead ?? 0
        let price = usage?.pricePerPostUsd ?? 0.005
        let cumulative = usage?.estimatedCostUsd ?? (Double(total) * price)
        let today = usage?.todayPostsRead ?? 0
        let todayCost = Double(today) * price
        return "\(total) posts read · ~$\(String(format: "%.2f", cumulative)) cumulative · \(today) today (~$\(String(format: "%.2f", todayCost)))"
    }

    private func loadRss() async {
        do {
            let response: RssFeedURLResponse = try await FunctionsClient.shared.call("getRssFeedUrl")
            rssURL = URL(string: response.url)
        } catch {
            // Non-fatal — RSS is optional
        }
    }

    private func createInvite() async {
        inviteBusy = true
        defer { inviteBusy = false }
        do {
            let response: CreateInviteResponse = try await FunctionsClient.shared.call(
                "createInvite",
                data: ["maxUses": 5, "days": 14]
            )
            inviteURL = response.url
            adminMessage = nil
            UIPasteboard.general.string = response.url
            router.showToast("Invite link copied")
        } catch {
            adminMessage = error.localizedDescription
        }
    }
}
