import SwiftUI
import AVKit
import UIKit

struct PostMediaView: View {
    let items: [MediaItem]

    private var gridItems: [MediaItem] {
        Array(items.prefix(4))
    }

    private let multiGap: CGFloat = 8
    @State private var fullscreenItem: MediaItem?

    var body: some View {
        let count = gridItems.count
        Group {
            if count == 1, let item = gridItems.first {
                // Full-width 4:3 frame; image aspect-fills (crops as needed)
                tappableCell(item) {
                    Color.clear
                        .frame(maxWidth: .infinity)
                        .aspectRatio(4.0 / 3.0, contentMode: .fit)
                        .overlay {
                            mediaFill(item)
                        }
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            } else if count > 1 {
                // Web: .media.media-multi → 2-column grid, square cells, object-fit cover
                multiGrid
            }
        }
        .fullScreenCover(item: $fullscreenItem) { item in
            MediaFullscreenView(item: item)
        }
    }

    /// Mirrors CSS `display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem`.
    private var multiGrid: some View {
        let rows = stride(from: 0, to: gridItems.count, by: 2).map { start in
            Array(gridItems[start..<min(start + 2, gridItems.count)])
        }
        return VStack(spacing: multiGap) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: multiGap) {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, item in
                        multiCell(item)
                    }
                    if row.count == 1 {
                        Color.clear
                            .frame(maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fit)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func multiCell(_ item: MediaItem) -> some View {
        tappableCell(item) {
            Color.clear
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    mediaFill(item)
                }
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private func tappableCell<Content: View>(
        _ item: MediaItem,
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .contentShape(Rectangle())
            .onTapGesture {
                VideoPlaybackCoordinator.pauseAll()
                fullscreenItem = item
            }
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Shows full screen")
    }

    @ViewBuilder
    private func mediaFill(_ item: MediaItem) -> some View {
        let ratio = item.aspectRatio
        if item.isVideo, let videoURL = item.playableVideoURL {
            LoopingVideoPlayer(url: videoURL, poster: item.displayImageURL, aspectRatio: ratio)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .allowsHitTesting(false)
        } else if let imageURL = item.displayImageURL {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    Color.secondary.opacity(0.2)
                default:
                    ZStack {
                        Color.secondary.opacity(0.12)
                        ProgressView()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(false)
        } else {
            Color.secondary.opacity(0.2)
        }
    }
}

private struct LoopingVideoPlayer: View {
    let url: URL
    let poster: URL?
    let aspectRatio: CGFloat
    @State private var box: AVPlayerBox?
    @State private var isVisible = false

    var body: some View {
        Color.black.opacity(0.12)
            .overlay {
                if let box {
                    AspectVideoPlayer(player: box.player)
                } else if let poster {
                    AsyncImage(url: poster) { phase in
                        if case .success(let image) = phase {
                            image.resizable().scaledToFill()
                        } else {
                            Color.black.opacity(0.3)
                        }
                    }
                } else {
                    Color.black.opacity(0.3)
                }
            }
            .clipped()
            .onAppear {
                if box == nil {
                    let created = AVPlayerBox(url: url)
                    created.player.actionAtItemEnd = .none
                    NotificationCenter.default.addObserver(
                        forName: .AVPlayerItemDidPlayToEndTime,
                        object: created.player.currentItem,
                        queue: .main
                    ) { _ in
                        created.player.seek(to: .zero)
                        created.player.play()
                    }
                    box = created
                }
            }
            .onScrollVisibilityChange { visible in
                isVisible = visible
                guard let box else { return }
                if visible {
                    VideoPlaybackCoordinator.play(box)
                } else {
                    VideoPlaybackCoordinator.pauseIfCurrent(box)
                }
            }
            .onDisappear {
                if let box {
                    VideoPlaybackCoordinator.pauseIfCurrent(box)
                }
            }
    }
}

/// AVKit `VideoPlayer` letterboxes poorly in lists; pin gravity to aspect-fit.
private struct AspectVideoPlayer: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {
        uiView.playerLayer.player = player
        uiView.playerLayer.videoGravity = .resizeAspect
    }

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
