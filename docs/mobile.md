# Android native client

Thin `WebView` shell that loads your Firebase Hosting SPA (`SITE_URL`).

**Offline cold start:** Open the app online once so the SPA service worker and Firestore cache can populate. After that, airplane mode + process kill can still show the last feed (media from X CDN may fail). Debug builds no longer force `LOAD_NO_CACHE`.

## Requirements

- Android Studio Ladybug+ (or SDK 35 + JDK 17)
- Device or emulator API 26+

## Configure

```bash
cp android/local.properties.example android/local.properties
```

Edit `android/local.properties`:

```properties
sdk.dir=/Users/YOU/Library/Android/sdk
site.url=https://YOUR_PROJECT_ID.web.app
# Optional — omit or leave blank to disable Sentry (recommended for forks)
# sentry.dsn=https://YOUR_PUBLIC_KEY@oXXXX.ingest.us.sentry.io/PROJECT_ID
```

`site.url` becomes `BuildConfig.SITE_URL`. `sentry.dsn` (or env `SENTRY_DSN`) becomes `BuildConfig.SENTRY_DSN`. Empty / placeholder / unset ⇒ Sentry stays fully disabled (no init, no Gradle upload). Do not commit `local.properties`.

Register an Android app in Firebase with package `org.evergreenlabs.mytwitter` and keep [`android/app/google-services.json`](../android/app/google-services.json) in sync (required for FCM).

## Run

Open the `android/` folder in Android Studio, sync Gradle, then Run.

```bash
cd android
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

## Behavior

| Concern | How |
|--------|-----|
| Feed / favorites | Same web SPA |
| Sign in with X | Custom Tabs → `/oauth/start?client=android` → `mytwitter://auth?token=…` → WebView |
| Status / t.co links | Intent filters; SPA `resolveTweetUrl` / `getTweet` / `?tweet=` |
| Push | FCM when favorited accounts post (incremental sync); tap opens tweet. OS permission is **not** requested on cold start — the SPA shows a soft prompt once the user has favorites (or after they favorite someone), then calls `requestPushRegistration`. The prompt is skipped when OS permission is already granted (`MyTwitterNative.notificationsAuthorized`) or the user previously opted in |
| Pull to refresh | SPA gesture calls `syncMyTimeline` (per-user sync; feed updates via Firestore) |
| Native bridge | `window.MyTwitterNative` (`platform`, `requestPushRegistration`, `setHasSession`) |
| Portrait notch | Root padding for status bar + display cutout |

Deploy Hosting + Functions (`startXAuth`, `xOAuthCallback`, `resolveTweetUrl`, `getTweet`, `registerDevice`, `syncMyTimeline`, `syncTimeline`) and Firestore rules for favorites/devices.

## Play release (AAB)

1. Create `android/keystore.properties` (gitignored), e.g. from `~/.sidekick-secrets/mytwitter-android-env.sh`:

```properties
storeFile=/absolute/path/to/mytwitter-upload.jks
storePassword=…
keyAlias=mytwitter
keyPassword=…
```

2. Ensure `android/local.properties` has production `site.url` (and optional `sentry.dsn`), or `source ~/.sidekick-secrets/mytwitter-android-env.sh` so `SENTRY_DSN` is set.

3. Build the Play App Bundle:

```bash
cd android
./gradlew :app:bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

Upload that AAB to Play Console → Testing → closed/open testing (or Internal testing). First upload requires creating the Play app for `org.evergreenlabs.mytwitter` and enrolling in Play App Signing.

## Store listing graphics

Prebuilt assets live in `android/play-store/`:

- App icon: `icon/icon-512.png` (512×512)
- Feature graphic: `feature-graphic/feature-graphic-1024x500.png` (1024×500)
- Phone screenshots: `screenshots/phone/*.png`
- Tablet screenshots: `screenshots/tablet/*.png` (Medium_Tablet AVD, landscape + portrait)

---

# iOS native client

Thin `WKWebView` shell (UIKit) that loads the same Hosting SPA. Bundle ID: `org.evergreenlabs.mytwitter`.

**Offline cold start:** Same as Android — one prior online visit registers the Hosting service worker (iOS 16.4+) and fills Firestore’s persistent cache. The iOS shell enables **App-Bound Domains** (`WKAppBoundDomains` + `limitsNavigationsToAppBoundDomains`) so Service Workers work in WKWebView; keep your Hosting hosts listed there when forking.

## Requirements

- Xcode 16+ / iOS 16+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) to regenerate the project from `ios/project.yml` if needed

## Configure

```bash
cp ios/Config.xcconfig.example ios/Config.xcconfig
```

Edit `ios/Config.xcconfig` (gitignored). In xcconfig files, `//` starts a comment, so write HTTPS URLs as `https:/$()/host`:

```
SITE_URL = https:/$()/YOUR_PROJECT_ID.web.app
# Optional — leave blank (or omit) to disable Sentry
# SENTRY_DSN = https:/$()/YOUR_PUBLIC_KEY@oXXXX.ingest.us.sentry.io/PROJECT_ID
```

Leave `SENTRY_DSN` blank to disable Sentry — the app never starts the SDK without a real `https://` DSN (placeholders and unresolved `$(…)` values are ignored). The app links SPM product `Sentry-Dynamic` (not static `Sentry`) so App Store archives include `Sentry.framework` dSYMs when you do enable it. Fastlane dSYM upload is also optional: it runs only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are all set.

Register an iOS app in Firebase with the same bundle ID and keep [`ios/MyTwitter/GoogleService-Info.plist`](../ios/MyTwitter/GoogleService-Info.plist) in sync. Upload an Apple APNs **Authentication Key** (`.p8` from [Certificates, Identifiers & Keys](https://developer.apple.com/account/resources/authkeys/list), with Apple Push Notifications enabled) in Firebase Console → Project settings → Cloud Messaging → Apple app configuration — both **development** and **production** slots (same `.p8` / Key ID / Team ID is fine). Also enable **Push Notifications** on the App ID `org.evergreenlabs.mytwitter` and run with code signing so `aps-environment` is embedded.

Open [`ios/MyTwitter.xcodeproj`](../ios/MyTwitter.xcodeproj), select your team, then Run.

```bash
cd ios
xcodegen generate   # only if project.yml changed
xcodebuild -project MyTwitter.xcodeproj -scheme MyTwitter \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

## Behavior

| Concern | How |
|--------|-----|
| Feed / favorites | Same web SPA |
| Sign in with X | `SFSafariViewController` → `/oauth/start?client=ios` → `mytwitter://auth?token=…` → WKWebView |
| Status / t.co (in-app) | Navigation policy + `TweetUrlParser` / SPA `MyTwitterOpenTweet` |
| Custom schemes | `mytwitter://auth`, `mytwitter://tweet`, `mytwitter://url` |
| Push | FCM + APNs; tap opens tweet via `data.tweetId`. Same deferred soft-prompt flow as Android (favorites-gated; no cold-start OS dialog). Native reports `notificationsAuthorized` so the prompt is not repeated after OS grant |
| Pull to refresh | Same SPA gesture → `syncMyTimeline` |
| Native bridge | `window.MyTwitterNative` (`platform: ios`, `requestPushRegistration`, `setHasSession`, version fields) |
| Returning session | `UserDefaults` + `mt_session` cookie + at-document-start `has-session` class so chrome/skeletons (and cached posts from the SPA) paint before Auth restore |
| Safe area | WKWebView pinned to `safeAreaLayoutGuide` |

Universal Links for `https://x.com/.../status/...` are not configured yet (follow-up).

## App Store / TestFlight / Play beta (Fastlane)

From the **repo root**, use Homebrew Fastlane (`/opt/homebrew/bin/fastlane`). Commit and push version bumps before / after store uploads as usual.

```bash
# Android — Play open testing (beta track). Loads ~/.sidekick-secrets/mytwitter-android-env.sh when present.
fastlane android beta
# Optional: VERSION_ALREADY_BUMPED=1 fastlane android beta   # skip versionCode bump
# Optional: fastlane android beta track:internal

# iOS — TestFlight (bumps CURRENT_PROJECT_VERSION in ios/project.yml + xcodegen)
fastlane ios beta
# Optional: fastlane ios beta whats_new:"Offline cold start fixes"

# Both (Android first, then iOS)
fastlane beta_both
```

Release builds use `MyTwitterRelease.entitlements` (`aps-environment: production`). Debug keeps `development`. Ensure the APNs `.p8` is uploaded in Firebase for **both** development and production slots.

ASC API key defaults to `~/Xcode/keys/Evergreen_AppConnectAPI_TH4226994B.p8` (override with `APP_STORE_CONNECT_KEY_PATH` / `APP_STORE_CONNECT_KEY_CONTENT`).
