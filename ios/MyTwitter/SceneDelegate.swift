import UIKit
import Darwin

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    /// Phone-narrow column when running as an iOS app on Mac.
    private static let macMinWidth: CGFloat = 390

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

    /// iOS-on-Mac: lock to a compact width and use as much vertical space as the display allows.
    private func configureMacWindowSize(for windowScene: UIWindowScene) {
        guard ProcessInfo.processInfo.isiOSAppOnMac,
              let restrictions = windowScene.sizeRestrictions
        else { return }

        let width = Self.macMinWidth
        let height = Self.macWindowHeight(fallbackScreen: windowScene.screen)
        restrictions.minimumSize = CGSize(width: width, height: height)
        restrictions.maximumSize = CGSize(width: width, height: height)
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
