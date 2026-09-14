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
```

`site.url` becomes `BuildConfig.SITE_URL`. Do not commit `local.properties`.

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
| Native bridge | `window.MyTwitterNative` (`platform`, `requestPushRegistration`) |
| Portrait notch | Root padding for status bar + display cutout |

Deploy Hosting + Functions (`startXAuth`, `xOAuthCallback`, `resolveTweetUrl`, `getTweet`, `registerDevice`, `syncTimeline`) and Firestore rules for favorites/devices.
