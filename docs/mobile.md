# Android native client

Fully native **Jetpack Compose** app (minSdk 33 / Android 13+) that talks to Firebase Auth, Firestore, and Cloud Functions directly — no WebView. Package: `org.evergreenlabs.mytwitter`.

**Offline:** Firestore’s persistent cache keeps the last feed available after one online session. Media from X CDN may still fail offline.

## Requirements

- Android Studio Ladybug+ (or SDK 36 + JDK 17)
- Device or emulator **API 33+**

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

`site.url` becomes `BuildConfig.SITE_URL` and the App Links host placeholder. `sentry.dsn` (or env `SENTRY_DSN`) becomes `BuildConfig.SENTRY_DSN`. Empty / placeholder / unset ⇒ Sentry stays fully disabled (no init, no Gradle upload). Do not commit `local.properties`.

Register an Android app in Firebase with package `org.evergreenlabs.mytwitter` and keep [`android/app/google-services.json`](../android/app/google-services.json) in sync (required for FCM / Auth).

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
| Feed / favorites | Native Firestore listeners on `users/{uid}/posts`, `likes`, `favorites`, `config/public` |
| Sign in with X | Custom Tabs → `/oauth/start?client=android` (+ optional `invite`) → `mytwitter://auth?handoff=…` → `exchangeAuthHandoff` → `signInWithCustomToken` |
| Invite join | `https://SITE/?invite=CODE` via verified App Links; invite stored for the next sign-in |
| Status / t.co | Intent filters + `TweetUrlParser` + `resolveTweetUrl` / `getTweet`; opens in-app detail or external browser |
| Custom schemes | `mytwitter://auth`, `mytwitter://tweet`, `mytwitter://url` |
| Push | FCM; tap opens tweet via `data.tweetId`. Favorites-gated soft prompt (no cold-start OS dialog); then `registerDevice`. Channel id `favorites` |
| Pull to refresh | Compose pull-to-refresh → `syncMyTimeline` |
| Profile / admin | Info sheet: RSS (`getRssFeedUrl`), sign out; admin usage + `createInvite` when `invitesEnabled` |
| Theme | Material 3 light/dark following system; brand blue accent |

Deploy Hosting + Functions (`startXAuth`, `xOAuthCallback`, `exchangeAuthHandoff`, `resolveTweetUrl`, `getTweet`, `registerDevice`, `syncMyTimeline`, `syncTimeline`) and Firestore rules for favorites/devices.

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

Fully native **SwiftUI** app (iOS 18+) that talks to Firebase Auth, Firestore, and Cloud Functions directly — no WebView. Bundle ID: `org.evergreenlabs.mytwitter`.

**Offline:** Firestore’s persistent cache keeps the last feed available after one online session. Media from X CDN may still fail offline.

## Requirements

- Xcode 16+ / **iOS 18+**
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

`SITE_URL` is the OAuth origin (`/oauth/start`, `/oauth/callback`). Leave `SENTRY_DSN` blank to disable Sentry. The app links SPM products `FirebaseCore`, `FirebaseAuth`, `FirebaseFirestore`, `FirebaseFunctions`, `FirebaseMessaging`, and `Sentry-Dynamic`.

Register an iOS app in Firebase with the same bundle ID and keep [`ios/MyTwitter/GoogleService-Info.plist`](../ios/MyTwitter/GoogleService-Info.plist) in sync. Upload an Apple APNs **Authentication Key** in Firebase Console → Cloud Messaging → Apple app configuration (development + production). Enable **Push Notifications** on the App ID and run with code signing so `aps-environment` is embedded.

Open [`ios/MyTwitter.xcodeproj`](../ios/MyTwitter.xcodeproj), select your team, then Run.

```bash
cd ios
xcodegen generate   # only if project.yml changed
xcodebuild -project MyTwitter.xcodeproj -scheme MyTwitter \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

## Behavior

| Concern | How |
|--------|-----|
| Feed / favorites | Native Firestore listeners on `users/{uid}/posts`, `likes`, `favorites`, `config/public` |
| Sign in with X | `ASWebAuthenticationSession` → `/oauth/start?client=ios` (+ optional `invite`) → `mytwitter://auth?handoff=…` → `exchangeAuthHandoff` → `Auth.signIn(withCustomToken:)` |
| Invite join | `https://SITE/?invite=CODE` via Universal Links; invite stored for the next sign-in |
| Status / t.co | `TweetUrlParser` + `resolveTweetUrl` / `getTweet` callables; opens detail sheet or Safari |
| Custom schemes | `mytwitter://auth`, `mytwitter://tweet`, `mytwitter://url` |
| Push | FCM + APNs; tap opens tweet via `data.tweetId`. Favorites-gated soft prompt (no cold-start OS dialog); then `registerDevice` |
| Pull to refresh | Native `.refreshable` → `syncMyTimeline` |
| Profile / admin | Info sheet: RSS (`getRssFeedUrl`), sign out; admin usage + `createInvite` when `invitesEnabled` |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` in `ios/project.yml` → `Info.plist` |

### Invite deep links (iOS + Android)

Invite URLs stay `https://<SITE_URL>/?invite=CODE`.

1. Hosting serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`.
2. iOS: Associated Domains → SwiftUI `.onContinueUserActivity` stores the invite / opens tweets.
3. Android: verified App Links → `MainActivity` routes invite / tweet params into `DeepLinkRouter` / `AuthStore`.
4. Functions echo `invite` on OAuth failure; native `mytwitter://auth` carries `handoff` / `authError` / `invite`.

**Verify after Hosting deploy + a new store/TestFlight/Play build** (deep links need the new binary):

```bash
curl -sI https://mytwitter-feed.web.app/.well-known/apple-app-site-association
curl -s https://mytwitter-feed.web.app/.well-known/assetlinks.json
# Apple CDN (can lag): https://app-site-association.cdn-apple.com/a/v1/mytwitter-feed.web.app
# Android: adb shell pm get-app-links org.evergreenlabs.mytwitter
```

Simulator note: Universal Links often open Safari on the simulator; use a physical device or `xcrun simctl openurl booted 'mytwitter://…'` / a DEBUG pending-invite hook for local invite testing.
