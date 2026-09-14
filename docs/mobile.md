# Android native client

Thin `WebView` shell that loads your Firebase Hosting SPA (`SITE_URL`).

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
sentry.dsn=https://YOUR_PUBLIC_KEY@oXXXX.ingest.us.sentry.io/PROJECT_ID
```

`site.url` becomes `BuildConfig.SITE_URL`. `sentry.dsn` (or env `SENTRY_DSN`) becomes `BuildConfig.SENTRY_DSN`. If unset, Sentry stays disabled. Do not commit `local.properties`.

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
| Push | FCM when favorited accounts post (incremental sync); tap opens tweet |
| Pull to refresh | SPA gesture calls `syncMyTimeline` (per-user sync; feed updates via Firestore) |
| Native bridge | `window.MyTwitterNative` (`platform`, `requestPushRegistration`) |
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
SENTRY_DSN = https:/$()/YOUR_PUBLIC_KEY@oXXXX.ingest.us.sentry.io/PROJECT_ID
```

Leave `SENTRY_DSN` blank to disable Sentry. The app links SPM product `Sentry-Dynamic` (not static `Sentry`) so App Store archives include `Sentry.framework` dSYMs.

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
| Push | FCM + APNs; tap opens tweet via `data.tweetId` |
| Pull to refresh | Same SPA gesture → `syncMyTimeline` |
| Native bridge | `window.MyTwitterNative` (`platform: ios`, `requestPushRegistration`, version fields) |
| Safe area | WKWebView pinned to `safeAreaLayoutGuide` |

Universal Links for `https://x.com/.../status/...` are not configured yet (follow-up).

## App Store / TestFlight

Not automated in-repo yet. Use Xcode Archive or Homebrew Fastlane when ready. For release builds, switch `aps-environment` to `production` (or use separate Debug/Release entitlements) so FCM uses the production APNs slot.
