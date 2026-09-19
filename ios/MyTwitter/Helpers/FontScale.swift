import SwiftUI
import UIKit

enum FontScale {
    static let storageKey = "mytwitter:fontScale"
    static let min = 0.85
    static let max = 1.4
    static let step = 0.1
    /// Slightly under 100% so the feed reads closer to the web client at rest.
    static let defaultValue = 0.9

    static func clamp(_ value: Double) -> Double {
        let stepped = (value * 10).rounded() / 10
        return Swift.min(max, Swift.max(min, stepped))
    }
}

@Observable
final class FontScaleStore {
    var scale: Double {
        didSet {
            UserDefaults.standard.set(scale, forKey: FontScale.storageKey)
        }
    }

    var percentLabel: String {
        "\(Int((scale * 100).rounded()))%"
    }

    var canDecrease: Bool { scale > FontScale.min + 1e-9 }
    var canIncrease: Bool { scale < FontScale.max - 1e-9 }

    init() {
        let stored = UserDefaults.standard.object(forKey: FontScale.storageKey) as? Double
        scale = FontScale.clamp(stored ?? FontScale.defaultValue)
    }

    func bump(_ delta: Double) {
        scale = FontScale.clamp(scale + delta)
    }
}

private struct FontScaleEnvKey: EnvironmentKey {
    static let defaultValue: Double = FontScale.defaultValue
}

extension EnvironmentValues {
    var fontScale: Double {
        get { self[FontScaleEnvKey.self] }
        set { self[FontScaleEnvKey.self] = newValue }
    }
}

private extension Font.TextStyle {
    var uiTextStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: return .largeTitle
        case .title: return .title1
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .body: return .body
        case .callout: return .callout
        case .subheadline: return .subheadline
        case .footnote: return .footnote
        case .caption: return .caption1
        case .caption2: return .caption2
        @unknown default: return .body
        }
    }
}

private struct MTFontModifier: ViewModifier {
    @Environment(\.fontScale) private var fontScale
    @Environment(\.sizeCategory) private var sizeCategory
    let style: Font.TextStyle
    let weight: Font.Weight

    func body(content: Content) -> some View {
        let _ = sizeCategory
        let base = UIFont.preferredFont(forTextStyle: style.uiTextStyle).pointSize
        content.font(.system(size: base * fontScale, weight: weight))
    }
}

extension View {
    /// Semantic style scaled by the in-app text-size preference (and system Dynamic Type).
    func mtFont(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> some View {
        modifier(MTFontModifier(style: style, weight: weight))
    }
}
