import SwiftUI
import AVKit

/// Full-screen image / video viewer opened from a post media tap.
struct MediaFullscreenView: View {
    let item: MediaItem
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if item.isVideo, let url = item.playableVideoURL {
                ZoomableContainer {
                    VideoPlayer(player: player)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .onAppear {
                    let p = AVPlayer(url: url)
                    p.isMuted = false
                    player = p
                    p.play()
                }
                .onDisappear {
                    player?.pause()
                    player = nil
                }
            } else if let imageURL = item.displayImageURL {
                ZoomableContainer {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        case .failure:
                            ContentUnavailableView("Couldn’t load image", systemImage: "photo")
                                .foregroundStyle(.white)
                        default:
                            ProgressView()
                                .tint(.white)
                        }
                    }
                }
            } else {
                ContentUnavailableView("Media unavailable", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.white)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .white.opacity(0.35))
                    .padding(16)
            }
            .accessibilityLabel("Close")
        }
        .statusBarHidden(true)
    }
}

/// Pinch to zoom, drag to pan when zoomed, double-tap to toggle 1× / 2.5×.
private struct ZoomableContainer<Content: View>: View {
    @ViewBuilder var content: () -> Content

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private let minScale: CGFloat = 1
    private let maxScale: CGFloat = 5
    private let doubleTapScale: CGFloat = 2.5

    var body: some View {
        content()
            .scaleEffect(scale)
            .offset(offset)
            .gesture(magnifyAndDrag)
            .onTapGesture(count: 2) {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                    if scale > 1.05 {
                        scale = 1
                        lastScale = 1
                        offset = .zero
                        lastOffset = .zero
                    } else {
                        scale = doubleTapScale
                        lastScale = doubleTapScale
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
    }

    private var magnifyAndDrag: some Gesture {
        SimultaneousGesture(
            MagnificationGesture()
                .onChanged { value in
                    let next = lastScale * value
                    scale = min(max(next, minScale), maxScale)
                }
                .onEnded { _ in
                    withAnimation(.easeOut(duration: 0.15)) {
                        if scale < minScale {
                            scale = minScale
                            offset = .zero
                            lastOffset = .zero
                        }
                        lastScale = scale
                    }
                },
            DragGesture()
                .onChanged { value in
                    guard scale > 1.01 else { return }
                    offset = CGSize(
                        width: lastOffset.width + value.translation.width,
                        height: lastOffset.height + value.translation.height
                    )
                }
                .onEnded { _ in
                    lastOffset = offset
                    if scale <= 1.01 {
                        withAnimation(.easeOut(duration: 0.15)) {
                            offset = .zero
                            lastOffset = .zero
                        }
                    }
                }
        )
    }
}
