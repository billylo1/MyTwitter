import UIKit
import Darwin

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    /// Narrowest allowed Mac window (still phone-like).
    private static let macMinWidth: CGFloat = 507
    /// Comfortable launch width (~30% wider than the prior 520pt default).
    private static let macLaunchWidth: CGFloat = 676
    /// Allow stretching to a short iPad-ish column.
    private static let macMaxWidth: CGFloat = 1170
    private static let macMinHeight: CGFloat = 500

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        configureMacWindowSize(for: windowScene)

        let window = UIWindow(windowScene: windowScene)
        let root = MainViewController()
        window.rootViewController = root
        window.tintColor = UIColor(named: "AccentColor")
        window.makeKeyAndVisible()
        self.window = window

        if let url = connectionOptions.urlContexts.first?.url {
            root.handleIncomingURL(url)
        }
        if let response = connectionOptions.notificationResponse {
            PushService.shared.handleNotificationUserInfo(
                response.notification.request.content.userInfo
            )
        }
    }

    /// iOS-on-Mac: open tall at a comfortable width, then allow free resize within bounds.
    private func configureMacWindowSize(for windowScene: UIWindowScene) {
        guard ProcessInfo.processInfo.isiOSAppOnMac,
              let restrictions = windowScene.sizeRestrictions
        else { return }

        let launchHeight = Self.macWindowHeight(fallbackScreen: windowScene.screen)
        let launch = CGSize(width: Self.macLaunchWidth, height: launchHeight)
        // Force the first frame to the launch size (min == max is how iOS-on-Mac
        // picks an initial geometry). Unlock resizing on the next turn.
        restrictions.minimumSize = launch
        restrictions.maximumSize = launch

        DispatchQueue.main.async {
            restrictions.minimumSize = CGSize(
                width: Self.macMinWidth,
                height: Self.macMinHeight
            )
            restrictions.maximumSize = CGSize(
                width: Self.macMaxWidth,
                height: CGFloat.greatestFiniteMagnitude
            )
        }
    }

    /// Prefer the host Mac display height; UIScreen often still reports an iPhone size.
    private static func macWindowHeight(fallbackScreen: UIScreen) -> CGFloat {
        typealias MainDisplayIDFn = @convention(c) () -> UInt32
        typealias DisplayBoundsFn = @convention(c) (UInt32) -> CGRect
        if let handle = dlopen(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
            RTLD_LAZY
        ),
           let mainSym = dlsym(handle, "CGMainDisplayID"),
           let boundsSym = dlsym(handle, "CGDisplayBounds")
        {
            let mainDisplayID = unsafeBitCast(mainSym, to: MainDisplayIDFn.self)
            let displayBounds = unsafeBitCast(boundsSym, to: DisplayBoundsFn.self)
            let height = displayBounds(mainDisplayID()).height
            if height > 0 {
                // Leave room for the menu bar and window chrome.
                return max(height - 88, 800)
            }
        }
        return max(fallbackScreen.bounds.height, 900)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url,
              let root = window?.rootViewController as? MainViewController
        else { return }
        root.handleIncomingURL(url)
    }
}
