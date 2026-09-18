import Foundation
import AuthenticationServices
import FirebaseAuth
import FirebaseFirestore
import OSLog
import UIKit

@Observable
@MainActor
final class AuthService: NSObject {
    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "Auth")
    private static let pendingInviteKey = "pendingInvite"

    var user: User?
    var member: Member?
    var authError: String?
    var isBusy = false
    var isReady = false

    private var authListener: AuthStateDidChangeListenerHandle?
    private var memberListener: ListenerRegistration?
    private var authSession: ASWebAuthenticationSession?
    private var lastAuthReturnKey: String?
    private var lastAuthReturnAt: Date?
    private var presentationContext: AuthPresentationContext?

    var isSignedIn: Bool { user != nil }
    var isMember: Bool { member?.isEnabled == true }

    var pendingInvite: String? {
        get { UserDefaults.standard.string(forKey: Self.pendingInviteKey) }
        set {
            if let newValue, !newValue.isEmpty {
                UserDefaults.standard.set(newValue, forKey: Self.pendingInviteKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.pendingInviteKey)
            }
        }
    }

    override init() {
        super.init()
        authListener = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                self?.handleAuthState(user)
            }
        }
        user = Auth.auth().currentUser
        if let user {
            startMemberListener(uid: user.uid)
        }
        isReady = true
    }

    func stopListening() {
        if let authListener {
            Auth.auth().removeStateDidChangeListener(authListener)
            self.authListener = nil
        }
        memberListener?.remove()
        memberListener = nil
    }

    func signIn() {
        authError = nil
        isBusy = true
        var comps = URLComponents(string: "\(AppConfig.siteURL)/oauth/start")
        var items = [URLQueryItem(name: "client", value: "ios")]
        if let invite = pendingInvite, !invite.isEmpty {
            items.append(URLQueryItem(name: "invite", value: invite))
        }
        comps?.queryItems = items
        guard let url = comps?.url else {
            authError = "Could not start sign-in"
            isBusy = false
            return
        }

        let context = AuthPresentationContext()
        presentationContext = context
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "mytwitter"
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.authSession = nil
                self.presentationContext = nil
                if let error {
                    let ns = error as NSError
                    if ns.domain == ASWebAuthenticationSessionError.errorDomain,
                       ns.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
                    {
                        self.log.info("OAuth cancelled by user")
                        self.isBusy = false
                        return
                    }
                    self.log.error("OAuth session failed: \(error.localizedDescription, privacy: .public)")
                    self.authError = "X sign-in failed. Please try again."
                    self.isBusy = false
                    return
                }
                guard let callbackURL else {
                    self.authError = "X sign-in was cancelled or incomplete."
                    self.isBusy = false
                    return
                }
                await self.handleAuthCallback(callbackURL)
            }
        }
        session.presentationContextProvider = context
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() {
            authError = "Could not start sign-in"
            isBusy = false
            authSession = nil
            presentationContext = nil
        }
    }

    func handleIncomingURL(_ url: URL) async {
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "mytwitter", url.host?.lowercased() == "auth" {
            await handleAuthCallback(url)
            return
        }
        if scheme == "https" || scheme == "http" {
            if let host = url.host?.lowercased(),
               host == AppConfig.siteHost || host.hasSuffix(".web.app") || host.hasSuffix(".firebaseapp.com")
            {
                let invite = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?
                    .first(where: { $0.name == "invite" })?
                    .value
                if let invite, !invite.isEmpty {
                    pendingInvite = invite
                }
            }
        }
    }

    func signOut() {
        do {
            try Auth.auth().signOut()
        } catch {
            log.error("signOut failed: \(error.localizedDescription, privacy: .public)")
        }
        memberListener?.remove()
        memberListener = nil
        member = nil
        user = nil
    }

    private func handleAuthState(_ user: User?) {
        self.user = user
        if let user {
            startMemberListener(uid: user.uid)
        } else {
            memberListener?.remove()
            memberListener = nil
            member = nil
        }
    }

    private func handleAuthCallback(_ url: URL) async {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let handoff = items.first(where: { $0.name == "handoff" })?.value
        let token = items.first(where: { $0.name == "token" })?.value
        let errorCode = items.first(where: { $0.name == "authError" })?.value
        let invite = items.first(where: { $0.name == "invite" })?.value

        if let invite, !invite.isEmpty {
            pendingInvite = invite
        }

        let dedupeKey = [handoff, token, errorCode, url.absoluteString]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .first ?? url.absoluteString
        if dedupeKey == lastAuthReturnKey,
           let at = lastAuthReturnAt,
           Date().timeIntervalSince(at) < 8
        {
            log.info("Ignoring duplicate OAuth return")
            return
        }
        lastAuthReturnKey = dedupeKey
        lastAuthReturnAt = Date()

        if let errorCode, !errorCode.isEmpty {
            authError = Self.message(for: errorCode)
            isBusy = false
            return
        }

        do {
            let customToken: String
            if let handoff, !handoff.isEmpty {
                let response: HandoffTokenResponse = try await FunctionsClient.shared.call(
                    "exchangeAuthHandoff",
                    data: ["handoff": handoff]
                )
                customToken = response.token
            } else if let token, !token.isEmpty {
                customToken = token
            } else {
                authError = "X sign-in was cancelled or incomplete."
                isBusy = false
                return
            }
            _ = try await Auth.auth().signIn(withCustomToken: customToken)
            pendingInvite = nil
            authError = nil
        } catch {
            if Auth.auth().currentUser != nil {
                log.warning("handoff exchange failed after sign-in; ignoring")
            } else {
                log.error("auth callback failed: \(error.localizedDescription, privacy: .public)")
                authError = "X sign-in failed. Please try again."
            }
        }
        isBusy = false
    }

    private func startMemberListener(uid: String) {
        memberListener?.remove()
        memberListener = Firestore.firestore().collection("members").document(uid)
            .addSnapshotListener { [weak self] snap, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        self.log.error("member listener: \(error.localizedDescription, privacy: .public)")
                        return
                    }
                    guard let snap else { return }
                    let fromCache = snap.metadata.isFromCache
                    if !snap.exists || (snap.data()?["enabled"] as? Bool) == false {
                        if !fromCache {
                            let message =
                                "You’re signed in to X but not a member of this feed yet."
                            self.signOut()
                            self.authError = message
                        }
                        return
                    }
                    do {
                        self.member = try snap.data(as: Member.self)
                        self.pendingInvite = nil
                    } catch {
                        self.log.error("member decode: \(error.localizedDescription, privacy: .public)")
                    }
                }
            }
    }

    static func message(for code: String) -> String {
        switch code {
        case "not_invited":
            return "You’re not on the family list yet. Ask for an invite link, then try again."
        case "expired_or_invalid_session", "expired_session":
            return "Sign-in timed out. Please try again."
        case "oauth_failed":
            return "X sign-in failed. Please try again."
        case "missing_oauth_params":
            return "X sign-in was cancelled or incomplete."
        default:
            return code.isEmpty ? "" : "Sign-in error: \(code)"
        }
    }
}

private final class AuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return window
        }
        return scenes.flatMap(\.windows).first ?? ASPresentationAnchor()
    }
}
