import SwiftUI
import AVKit
import UIKit

struct PostMediaView: View {
    let items: [MediaItem]

    private var gridItems: [MediaItem] {
        Array(items.prefix(4))
    }

    var body: some View {
        let count = gridItems.count
        Group {
            if count == 1, let item = gridItems.first {
                mediaCell(item, contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: 320, alignment: .center)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)],
                    spacing: 4
                ) {
                    ForEach(Array(gridItems.enumerated()), id: \.offset) { _, item in
                        mediaCell(item, contentMode: .fill)
                            .frame(maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fill)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func mediaCell(_ item: MediaItem, contentMode: ContentMode) -> some View {
        let ratio = item.aspectRatio
        if item.isVideo, let videoURL = item.playableVideoURL {
            LoopingVideoPlayer(url: videoURL, poster: item.displayImageURL, aspectRatio: ratio)
        } else if let imageURL = item.displayImageURL {
            Color.clear
                .aspectRatio(ratio, contentMode: .fit)
                .overlay {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: contentMode)
                        case .failure:
                            Color.secondary.opacity(0.2)
                        default:
                            ProgressView()
                        }
                    }
                }
                .clipped()
        } else {
            Color.secondary.opacity(0.2)
                .aspectRatio(ratio, contentMode: .fit)
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
            .aspectRatio(aspectRatio, contentMode: .fit)
            .overlay {
                if let box {
                    AspectVideoPlayer(player: box.player)
                } else if let poster {
                    AsyncImage(url: poster) { phase in
                        if case .success(let image) = phase {
                            image.resizable().aspectRatio(contentMode: .fit)
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
