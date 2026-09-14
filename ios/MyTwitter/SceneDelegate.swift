import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
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

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url,
              let root = window?.rootViewController as? MainViewController
        else { return }
        root.handleIncomingURL(url)
    }
}
