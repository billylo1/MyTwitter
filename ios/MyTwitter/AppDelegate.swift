import UIKit
import FirebaseCore
import FirebaseMessaging
import Sentry
import OSLog

final class AppDelegate: NSObject, UIApplicationDelegate {
    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "App")

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        configureSentry()
        FirebaseApp.configure()
        PushService.shared.configure()

        if let remote = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            PushService.shared.handleNotificationUserInfo(remote)
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
        log.info("APNs device token registered")
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        log.error("APNs registration failed: \(error.localizedDescription, privacy: .public)")
    }

    private func configureSentry() {
        let dsn = AppConfig.sentryDSN
        guard !dsn.isEmpty else {
            log.warning("Sentry disabled (empty SENTRY_DSN)")
            return
        }
        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = {
                #if DEBUG
                "debug"
                #else
                "release"
                #endif
            }()
            options.releaseName =
                "\(Bundle.main.bundleIdentifier ?? "org.evergreenlabs.mytwitter")@\(AppConfig.versionName)+\(AppConfig.versionCode)"
            #if DEBUG
            options.tracesSampleRate = 1.0
            options.debug = true
            #else
            options.tracesSampleRate = 0.2
            options.debug = false
            #endif
        }
    }
}
