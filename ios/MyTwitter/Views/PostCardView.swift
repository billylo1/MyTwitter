import SwiftUI

struct PostCardView: View {
    let post: Post
    let isLiked: Bool
    let isFavorited: Bool
    var isHighlighted: Bool = false
    var showHitLink: Bool = true
    let onOpen: () -> Void
    let onAuthor: () -> Void
    let onLike: () -> Void
    let onLink: (URL) -> Void

    private var bodyText: String {
        TextHelpers.stripPreviewUrls(from: post.text ?? "", preview: post.linkPreview)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if post.showAsRepost {
                Label {
                    Text("@\(post.repostedByHandle ?? "") reposted")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "arrow.2.squarepath")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            HStack(alignment: .top, spacing: 12) {
                avatarButton
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Button(action: onAuthor) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(post.displayName)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.primary)
                                Text("@\(post.displayHandle)")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer(minLength: 4)
                        Text(TextHelpers.relativeTime(post.createdAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if isFavorited {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundStyle(.yellow)
                        }
                    }

                    if !bodyText.isEmpty {
                        Text(TextHelpers.attributedBody(bodyText))
                            .font(.body)
                            .textSelection(.enabled)
                            .environment(\.openURL, OpenURLAction { url in
                                onLink(url)
                                return .handled
                            })
                    }

                    if let preview = post.linkPreview {
                        LinkPreviewCard(preview: preview) {
                            if let url = preview.openURL {
                                onLink(url)
                            }
                        }
                    }

                    let media = post.resolvedMedia
                    if !media.isEmpty {
                        PostMediaView(items: media)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    HStack(spacing: 20) {
                        Button(action: onLike) {
                            Label(
                                isLiked ? "Liked" : "Like",
                                systemImage: isLiked ? "heart.fill" : "heart"
                            )
                            .labelStyle(.iconOnly)
                            .foregroundStyle(isLiked ? .pink : .secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isLiked ? "Unlike" : "Like")

                        ShareLink(item: post.xURL) {
                            Image(systemName: "square.and.arrow.up")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)

                        Spacer()
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(12)
        .padding(.leading, isFavorited ? 4 : 0)
        .overlay(alignment: .leading) {
            if isFavorited {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.yellow.opacity(0.85))
                    .frame(width: 3)
                    .padding(.vertical, 10)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(isHighlighted ? Color.accentColor.opacity(0.12) : Color(.secondarySystemBackground))
        )
        .contentShape(Rectangle())
        .onTapGesture {
            if showHitLink { onOpen() }
        }
    }

    private var avatarButton: some View {
        Button(action: onAuthor) {
            AsyncImage(url: URL(string: post.authorAvatar ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Circle().fill(Color.secondary.opacity(0.25))
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(Circle())
        }
        .buttonStyle(.plain)
    }
}
