import Foundation
import SwiftUI
import AVFoundation
import AVKit

enum TextHelpers {
    static func relativeTime(_ date: Date?) -> String {
        guard let date else { return "" }
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 { return "\(max(seconds, 0))s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 7 { return "\(days)d" }
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return f.string(from: date)
    }

    static func stripPreviewUrls(from text: String, preview: LinkPreview?) -> String {
        guard let preview else { return text }
        var result = text
        for candidate in [preview.tcoUrl, preview.url, preview.expandedUrl, preview.displayUrl] {
            guard let candidate, !candidate.isEmpty else { continue }
            result = result.replacingOccurrences(of: candidate, with: "")
        }
        return result
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func attributedBody(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return attributed
        }
        let ns = text as NSString
        let matches = detector.matches(in: text, range: NSRange(location: 0, length: ns.length))
        for match in matches.reversed() {
            guard let range = Range(match.range, in: text),
                  let url = match.url,
                  let attrRange = Range(range, in: attributed)
            else { continue }
            attributed[attrRange].link = url
            attributed[attrRange].foregroundColor = .accentColor
        }
        return attributed
    }
}

enum VideoPlaybackCoordinator {
    static var currentPlayer: AVPlayerBox?

    static func play(_ box: AVPlayerBox) {
        if let current = currentPlayer, current !== box {
            current.pause()
        }
        currentPlayer = box
        box.play()
    }

    static func pauseIfCurrent(_ box: AVPlayerBox) {
        if currentPlayer === box {
            box.pause()
            currentPlayer = nil
        }
    }
}

final class AVPlayerBox {
    let player: AVPlayer

    init(url: URL) {
        player = AVPlayer(url: url)
        player.isMuted = true
    }

    func play() {
        player.play()
    }

    func pause() {
        player.pause()
    }
}
