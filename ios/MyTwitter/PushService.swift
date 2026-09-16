import Foundation
import OSLog
import UIKit
import UserNotifications
import FirebaseMessaging

final class PushService: NSObject {
    static let shared = PushService()
    private static let prefAuthorized = "notificationsAuthorized"

    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "Push")
    var tweetOpener: ((String) -> Void)?

    private override init() {
        super.init()
    }

    func configure() {
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
        refreshNotificationsAuthorized()
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = 0
        }
    }

    func requestPermissionAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error {
                self.log.error("notification permission error: \(error.localizedDescription, privacy: .public)")
            }
            self.log.info("notification permission granted=\(granted)")
            UserDefaults.standard.set(granted, forKey: Self.prefAuthorized)
            DispatchQueue.main.async {
                UIApplication.shared.applicationIconBadgeNumber = 0
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func cachedNotificationsAuthorized() -> Bool {
        UserDefaults.standard.bool(forKey: Self.prefAuthorized)
    }

    func refreshNotificationsAuthorized(completion: ((Bool) -> Void)? = nil) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let ok: Bool
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                ok = true
            case .notDetermined, .denied:
                ok = false
            @unknown default:
                ok = false
            }
            UserDefaults.standard.set(ok, forKey: Self.prefAuthorized)
            completion?(ok)
        }
    }

    func fetchFcmToken(completion: @escaping (String?) -> Void) {
        requestPermissionAndRegister()
        Messaging.messaging().token { token, error in
            if let error {
                self.log.error("FCM token failed: \(error.localizedDescription, privacy: .public)")
                completion(nil)
                return
            }
            self.log.info("FCM token ready len=\(token?.count ?? 0)")
            completion(token)
        }
    }

    func handleNotificationUserInfo(_ userInfo: [AnyHashable: Any]) {
        let tweetId = (userInfo["tweetId"] as? String)
            ?? (userInfo["tweet_id"] as? String)
            ?? ""
        let digits = tweetId.filter(\.isNumber)
        guard !digits.isEmpty else { return }
        DispatchQueue.main.async {
            self.tweetOpener?(digits)
        }
    }
}

extension PushService: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        handleNotificationUserInfo(response.notification.request.content.userInfo)
        completionHandler()
    }
}

extension PushService: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        log.info("FCM token refreshed len=\(fcmToken?.count ?? 0)")
    }
}
