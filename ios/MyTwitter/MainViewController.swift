import UIKit
import WebKit
import SafariServices
import OSLog

final class MainViewController: UIViewController {
    private let log = Logger(subsystem: "org.evergreenlabs.mytwitter", category: "Web")
    private var webView: WKWebView!
    private let siteURL = AppConfig.siteURL
    private var oauthSafari: SFSafariViewController?
    private var pendingTweetOpen: String?
    private let launchElapsed = ProcessInfo.processInfo.systemUptime

    private static let xAuthHosts: Set<String> = [
        "twitter.com",
        "www.twitter.com",
        "api.twitter.com",
        "x.com",
        "www.x.com",
    ]
    private static let prefHasSession = "hasSession"
    private static let sessionCookie = "mt_session"

    private func bootLog(_ msg: String) {
        let ms = Int((ProcessInfo.processInfo.systemUptime - launchElapsed) * 1000)
        log.info("boot +\(ms)ms \(msg, privacy: .public)")
    }

    private func hasStoredSession() -> Bool {
        UserDefaults.standard.bool(forKey: Self.prefHasSession)
    }

    private func setHasSession(_ has: Bool) {
        UserDefaults.standard.set(has, forKey: Self.prefHasSession)
        syncSessionCookie()
    }

    private func applySessionHint() {
        guard hasStoredSession() else { return }
        evaluateJS("document.documentElement.classList.add('has-session');")
    }

    /// Mirrors Android CookieManager `mt_session=1` so the SPA's inline hint script
    /// can show chrome/skeletons before Auth IndexedDB restore finishes.
    private func syncSessionCookie() {
        guard let url = URL(string: siteURL), let host = url.host else { return }
        let store = WKWebsiteDataStore.default().httpCookieStore
        if hasStoredSession() {
            var props: [HTTPCookiePropertyKey: Any] = [
                .name: Self.sessionCookie,
                .value: "1",
                .path: "/",
                .domain: host,
            ]
            if url.scheme?.lowercased() == "https" {
                props[.secure] = "TRUE"
            }
            if let cookie = HTTPCookie(properties: props) {
                store.setCookie(cookie)
            }
        } else {
            store.getAllCookies { cookies in
                for cookie in cookies where cookie.name == Self.sessionCookie {
                    store.delete(cookie)
                }
            }
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        bootLog("viewDidLoad")
        view.backgroundColor = UIColor(red: 0.059, green: 0.078, blue: 0.098, alpha: 1)

        let userContent = WKUserContentController()
        userContent.add(self, name: "mytwitterNative")
        if hasStoredSession() {
            // WK equivalent of Android DOCUMENT_START_SCRIPT — class is on <html>
            // before first paint, so has-session CSS can hide the splash immediately.
            let script = WKUserScript(
                source: "document.documentElement.classList.add('has-session');",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            userContent.addUserScript(script)
            bootLog("document-start session hint")
        }

        let config = WKWebViewConfiguration()
        config.userContentController = userContent
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.websiteDataStore = .default()
        // Opt into App-Bound Domains so Service Workers (and our JS bridge) work in WKWebView.
        config.limitsNavigationsToAppBoundDomains = true
        // Without this, <video playsinline> still opens the system fullscreen player.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsPictureInPictureMediaPlayback = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if let ua = webView.value(forKey: "userAgent") as? String {
            webView.customUserAgent = "\(ua) MyTwitteriOS/1.0"
        } else {
            webView.customUserAgent = "MyTwitteriOS/1.0"
        }

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        // On Mac the title bar already owns the top chrome; pinning to safeAreaLayoutGuide
        // leaves a blank strip of view.backgroundColor above the WKWebView (the black bar).
        if ProcessInfo.processInfo.isiOSAppOnMac {
            view.backgroundColor = .white
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                webView.topAnchor.constraint(equalTo: view.topAnchor),
                webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
        } else {
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
                webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            ])
        }

        PushService.shared.tweetOpener = { [weak self] tweetId in
            self?.openTweetById(tweetId)
        }

        loadSite()
    }

    /// Bump when Hosting ships shell/JS fixes that must not stay stuck in WK HTTP cache.
    private static let shellCacheEpoch = "0.1.18"

    private func loadSite() {
        guard let url = URL(string: siteURL) else {
            log.error("Invalid SITE_URL=\(self.siteURL, privacy: .public)")
            return
        }
        log.info("Loading SITE_URL=\(self.siteURL, privacy: .public)")
        syncSessionCookie()

        let defaults = UserDefaults.standard
        let key = "shellCacheEpoch"
        let needsFreshShell = defaults.string(forKey: key) != Self.shellCacheEpoch

        #if DEBUG
        // Automation/testing: `defaults write … pendingAuthToken <jwt>` then launch.
        if let pending = defaults.string(forKey: "pendingAuthToken"), !pending.isEmpty {
            defaults.removeObject(forKey: "pendingAuthToken")
            var comps = URLComponents(string: siteURL)
            comps?.queryItems = [URLQueryItem(name: "token", value: pending)]
            if let target = comps?.url {
                log.info("DEBUG pendingAuthToken → WebView")
                var request = URLRequest(url: target)
                request.cachePolicy = needsFreshShell
                    ? .reloadIgnoringLocalCacheData
                    : .returnCacheDataElseLoad
                finishLoad(request: request, needsFreshShell: needsFreshShell, epochKey: key)
                return
            }
        }
        #endif

        var request = URLRequest(url: url)
        if needsFreshShell {
            request.cachePolicy = .reloadIgnoringLocalCacheData
        } else {
            request.cachePolicy = .returnCacheDataElseLoad
        }
        finishLoad(request: request, needsFreshShell: needsFreshShell, epochKey: key)
    }

    private func finishLoad(request: URLRequest, needsFreshShell: Bool, epochKey: String) {
        let defaults = UserDefaults.standard
        if needsFreshShell {
            let store = WKWebsiteDataStore.default()
            let types: Set<String> = [
                WKWebsiteDataTypeDiskCache,
                WKWebsiteDataTypeMemoryCache,
            ]
            let host = request.url?.host?.lowercased() ?? ""
            store.fetchDataRecords(ofTypes: types) { [weak self] records in
                let mine = records.filter { record in
                    record.displayName.lowercased().contains(host)
                        || record.displayName.lowercased().contains("mytwitter-feed")
                }
                store.removeData(ofTypes: types, for: mine) {
                    DispatchQueue.main.async {
                        guard let self else { return }
                        self.log.info("Cleared WK cache for shell epoch \(Self.shellCacheEpoch, privacy: .public)")
                        self.webView.load(request)
                        defaults.set(Self.shellCacheEpoch, forKey: epochKey)
                    }
                }
            }
        } else {
            webView.load(request)
        }
    }

    // MARK: - Deep links

    func handleIncomingURL(_ url: URL) {
        dismissOAuthSafariIfNeeded()
        guard url.scheme?.lowercased() == "mytwitter" else {
            if TweetUrlParser.isXStatusOrTco(url) {
                openTweetFromURL(url)
            }
            return
        }
        switch url.host?.lowercased() {
        case "auth":
            applyAuthReturn(url)
        case "tweet":
            let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "id" })?
                .value
            let tweetId = (id?.isEmpty == false ? id : nil) ?? url.lastPathComponent
            if !tweetId.isEmpty { openTweetById(tweetId) }
        case "url":
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let raw = comps?.queryItems?.first(where: { $0.name == "u" || $0.name == "url" })?.value
            if let raw, let target = URL(string: raw) {
                openTweetFromURL(target)
            }
        default:
            break
        }
    }

    private func applyAuthReturn(_ url: URL) {
        var comps = URLComponents(string: siteURL)
        var items: [URLQueryItem] = []
        let incoming = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let token = incoming.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            items.append(URLQueryItem(name: "token", value: token))
        }
        if let err = incoming.first(where: { $0.name == "authError" })?.value, !err.isEmpty {
            items.append(URLQueryItem(name: "authError", value: err))
        }
        comps?.queryItems = items.isEmpty ? nil : items
        guard let target = comps?.url else { return }
        log.info("OAuth return → WebView")
        syncSessionCookie()
        var request = URLRequest(url: target)
        request.cachePolicy = .returnCacheDataElseLoad
        webView.load(request)
    }

    // MARK: - Navigation policy helpers

    private func isFirstPartyHost(_ host: String) -> Bool {
        guard let siteHost = AppConfig.siteHost else { return false }
        if host == siteHost { return true }
        // Firebase Hosting redirects between *.web.app and *.firebaseapp.com.
        if siteHost.hasSuffix(".web.app") {
            let base = String(siteHost.dropLast(".web.app".count))
            return host == "\(base).firebaseapp.com"
        }
        if siteHost.hasSuffix(".firebaseapp.com") {
            let base = String(siteHost.dropLast(".firebaseapp.com".count))
            return host == "\(base).web.app"
        }
        return false
    }

    private func handleNavigation(to url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        let path = url.path

        if isFirstPartyHost(host) {
            if path.hasPrefix("/oauth/start") {
                startOAuth(with: url)
                return true
            }
            return false
        }

        if Self.xAuthHosts.contains(host), path.localizedCaseInsensitiveContains("oauth") {
            startOAuth(with: url)
            return true
        }

        if TweetUrlParser.isXStatusOrTco(url) {
            openTweetFromURL(url)
            return true
        }

        if url.scheme == "https" || url.scheme == "http" {
            let safari = SFSafariViewController(url: url)
            present(safari, animated: true)
            return true
        }

        return false
    }

    private func startOAuth(with startURL: URL) {
        var comps = URLComponents(url: startURL, resolvingAgainstBaseURL: false)
        var items = comps?.queryItems ?? []
        if items.first(where: { $0.name == "client" }) == nil {
            items.append(URLQueryItem(name: "client", value: "ios"))
        }
        comps?.queryItems = items
        let withClient = comps?.url ?? startURL

        Task {
            // Prefer landing Safari on the X authorize URL (Android Custom Tabs parity).
            let authorize = await resolveRedirect(withClient.absoluteString) ?? withClient.absoluteString
            guard let target = URL(string: authorize) else { return }
            await MainActor.run {
                self.presentOAuthSafari(url: target)
            }
        }
    }

    private func presentOAuthSafari(url: URL) {
        dismissOAuthSafariIfNeeded()
        let safari = SFSafariViewController(url: url)
        safari.dismissButtonStyle = .close
        safari.delegate = self
        oauthSafari = safari
        log.info("Opening OAuth Safari: \(url.absoluteString, privacy: .public)")
        present(safari, animated: true)
    }

    private func dismissOAuthSafariIfNeeded() {
        if let safari = oauthSafari {
            safari.dismiss(animated: true)
            oauthSafari = nil
        } else if presentedViewController is SFSafariViewController {
            presentedViewController?.dismiss(animated: true)
        }
    }

    private func resolveRedirect(_ urlString: String) async -> String? {
        guard let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        do {
            let (_, response) = try await URLSession(
                configuration: .ephemeral,
                delegate: RedirectCaptureDelegate(),
                delegateQueue: nil
            ).data(for: request)
            if let http = response as? HTTPURLResponse,
               (300...399).contains(http.statusCode),
               let location = http.value(forHTTPHeaderField: "Location"),
               !location.isEmpty
            {
                return location
            }
        } catch {
            log.warning("resolveRedirect failed: \(error.localizedDescription, privacy: .public)")
        }
        return nil
    }

    // MARK: - Tweet open

    private func openTweetFromURL(_ url: URL) {
        if let statusId = TweetUrlParser.extractStatusId(url) {
            openTweetById(statusId)
            return
        }
        let jsUrl = url.absoluteString
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        evaluateJS(
            """
            (function(){
              if (typeof window.MyTwitterOpenTweet === 'function') {
                window.MyTwitterOpenTweet('\(jsUrl)');
              } else {
                window.__mytwitterPendingOpen = '\(jsUrl)';
              }
            })();
            """
        )
        if webView.url == nil || webView.url?.absoluteString == "about:blank" {
            if let home = URL(string: siteURL) {
                syncSessionCookie()
                webView.load(URLRequest(url: home))
            }
        }
    }

    func openTweetById(_ tweetId: String) {
        let id = tweetId.filter(\.isNumber)
        guard !id.isEmpty else { return }
        var comps = URLComponents(string: siteURL)
        comps?.queryItems = [URLQueryItem(name: "tweet", value: id)]
        guard let target = comps?.url else { return }
        if webView.url == nil || webView.url?.absoluteString == "about:blank" {
            syncSessionCookie()
            webView.load(URLRequest(url: target))
        } else {
            evaluateJS(
                """
                (function(){
                  if (typeof window.MyTwitterOpenTweet === 'function') {
                    window.MyTwitterOpenTweet('\(id)');
                  } else {
                    window.location.href = '\(target.absoluteString)';
                  }
                })();
                """
            )
        }
    }

    // MARK: - Bridge

    private func injectNativeBridge() {
        let versionName = AppConfig.versionName
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let versionCode = AppConfig.versionCode
        let notificationsAuthorized = PushService.shared.cachedNotificationsAuthorized()
        let pending = pendingTweetOpen
        pendingTweetOpen = nil
        let pendingJS: String
        if let pending {
            let safe = pending
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            pendingJS = "window.__mytwitterPendingOpen = '\(safe)';"
        } else {
            pendingJS = ""
        }

        evaluateJS(
            """
            (function(){
              \(pendingJS)
              window.MyTwitterNative = {
                platform: 'ios',
                versionName: '\(versionName)',
                versionCode: \(versionCode),
                notificationsAuthorized: \(notificationsAuthorized),
                postMessage: function(msg) {
                  try {
                    window.webkit.messageHandlers.mytwitterNative.postMessage({
                      type: 'postMessage',
                      payload: typeof msg === 'string' ? msg : JSON.stringify(msg)
                    });
                  } catch (e) {}
                },
                setHasSession: function(has) {
                  try {
                    window.webkit.messageHandlers.mytwitterNative.postMessage({
                      type: 'setHasSession',
                      has: !!has
                    });
                  } catch (e) {}
                },
                requestPushRegistration: function() {
                  return new Promise(function(resolve, reject) {
                    window.__mytwitterPushResolve = resolve;
                    window.__mytwitterPushReject = reject;
                    try {
                      window.webkit.messageHandlers.mytwitterNative.postMessage({ type: 'requestPushToken' });
                    } catch (e) {
                      reject(e);
                    }
                  });
                }
              };
              if (window.__mytwitterPendingOpen && typeof window.MyTwitterOpenTweet === 'function') {
                var pending = window.__mytwitterPendingOpen;
                window.__mytwitterPendingOpen = null;
                window.MyTwitterOpenTweet(pending);
              }
              window.dispatchEvent(new CustomEvent('mytwitter:nativeReady', { detail: { platform: 'ios' } }));
              try {
                var hinted = document.documentElement.classList.contains('has-session') ||
                  localStorage.getItem('mytwitter:hasSession') === '1';
                window.webkit.messageHandlers.mytwitterNative.postMessage({
                  type: 'setHasSession',
                  has: !!hinted
                });
              } catch (e) {}
            })();
            """
        )
    }

    private func fulfillPushToken(_ token: String?) {
        guard let token, !token.isEmpty else {
            evaluateJS("window.__mytwitterPushResolve && window.__mytwitterPushResolve(null);")
            return
        }
        let safe = token
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "")
        evaluateJS(
            """
            window.__mytwitterPushResolve && window.__mytwitterPushResolve({
              token: '\(safe)',
              platform: 'ios'
            });
            """
        )
    }

    private func evaluateJS(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}

// MARK: - Delegates

extension MainViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if handleNavigation(to: url) {
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        bootLog("onPageStarted \(webView.url?.absoluteString ?? "")")
        applySessionHint()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        applySessionHint()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        bootLog("onPageFinished \(webView.url?.absoluteString ?? "")")
        injectNativeBridge()
        PushService.shared.refreshNotificationsAuthorized { [weak self] authorized in
            guard authorized else { return }
            DispatchQueue.main.async {
                self?.evaluateJS(
                    "if (window.MyTwitterNative) window.MyTwitterNative.notificationsAuthorized = true;"
                )
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        log.error("provisional nav failed: \(error.localizedDescription, privacy: .public)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log.error("nav failed: \(error.localizedDescription, privacy: .public)")
    }
}

extension MainViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        log.info("JS alert: \(message, privacy: .public)")
        completionHandler()
    }
}

extension MainViewController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "mytwitterNative" else { return }
        let type: String?
        if let dict = message.body as? [String: Any] {
            type = dict["type"] as? String
        } else if let s = message.body as? String {
            type = s
        } else {
            type = nil
        }
        switch type {
        case "requestPushToken":
            PushService.shared.fetchFcmToken { [weak self] token in
                DispatchQueue.main.async {
                    self?.fulfillPushToken(token)
                }
            }
        case "setHasSession":
            let has: Bool
            if let dict = message.body as? [String: Any] {
                if let flag = dict["has"] as? Bool {
                    has = flag
                } else if let num = dict["has"] as? NSNumber {
                    has = num.boolValue
                } else {
                    has = false
                }
            } else {
                has = false
            }
            DispatchQueue.main.async { [weak self] in
                self?.setHasSession(has)
            }
        case "postMessage":
            break
        default:
            break
        }
    }
}

extension MainViewController: SFSafariViewControllerDelegate {
    func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        if oauthSafari === controller {
            oauthSafari = nil
        }
    }
}

/// Captures redirect Location without following it.
private final class RedirectCaptureDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
