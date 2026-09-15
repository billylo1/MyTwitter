fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

### beta_both

```sh
[bundle exec] fastlane beta_both
```

Play open testing then TestFlight (Android first)

----


## iOS

### ios generate

```sh
[bundle exec] fastlane ios generate
```

Regenerate Xcode project from ios/project.yml

### ios build

```sh
[bundle exec] fastlane ios build
```

Build an App Store IPA locally (no upload, no bump)

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Bump iOS build, archive, upload to TestFlight

### ios release

```sh
[bundle exec] fastlane ios release
```

Bump iOS marketing+build, archive, submit to App Store

----


## Android

### android build_aab

```sh
[bundle exec] fastlane android build_aab
```

Build a release AAB locally (no upload)

### android beta

```sh
[bundle exec] fastlane android beta
```

Bump versionCode, build AAB, upload to Play open testing (beta)

### android release

```sh
[bundle exec] fastlane android release
```

Bump version, upload to Play beta, promote to production

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
