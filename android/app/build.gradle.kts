import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
    id("io.sentry.android.gradle")
}

val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

val keystoreProperties = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

val siteUrl: String =
    (localProperties.getProperty("site.url")
        ?: providers.gradleProperty("site.url").orNull
        ?: "https://YOUR_PROJECT_ID.web.app")
        .trimEnd('/')

// Optional — empty / placeholder ⇒ Sentry disabled at runtime (safe for forks).
fun sanitizeSentryDsn(raw: String?): String {
    val dsn = (raw ?: "").trim()
    if (dsn.isEmpty()) return ""
    if (dsn.contains("YOUR_", ignoreCase = true)) return ""
    if (!dsn.startsWith("http://") && !dsn.startsWith("https://")) return ""
    return dsn
}

val sentryDsnRaw: String =
    sanitizeSentryDsn(
        localProperties.getProperty("sentry.dsn") ?: System.getenv("SENTRY_DSN"),
    )
val sentryEnabled = sentryDsnRaw.isNotEmpty()
val sentryDsn: String =
    sentryDsnRaw
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")

android {
    namespace = "org.evergreenlabs.mytwitter"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.evergreenlabs.mytwitter"
        minSdk = 26
        targetSdk = 36
        versionCode = 7
        versionName = "0.1.5"
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
        buildConfigField("String", "SENTRY_DSN", "\"$sentryDsn\"")
    }

    signingConfigs {
        create("release") {
            val storePath = keystoreProperties.getProperty("storeFile")
                ?: System.getenv("KEYSTORE_PATH")
            val storePass = keystoreProperties.getProperty("storePassword")
                ?: System.getenv("KEYSTORE_PASSWORD")
            val alias = keystoreProperties.getProperty("keyAlias")
                ?: System.getenv("KEY_ALIAS")
            val keyPass = keystoreProperties.getProperty("keyPassword")
                ?: System.getenv("KEY_PASSWORD")
            if (!storePath.isNullOrBlank() &&
                !storePass.isNullOrBlank() &&
                !alias.isNullOrBlank() &&
                !keyPass.isNullOrBlank()
            ) {
                storeFile = file(storePath)
                storePassword = storePass
                keyAlias = alias
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
    implementation(platform("io.sentry:sentry-bom:8.33.0"))
    implementation("io.sentry:sentry-android")
}

sentry {
    // Never require Sentry credentials for a local/fork build.
    autoUploadProguardMapping.set(
        sentryEnabled && !System.getenv("SENTRY_AUTH_TOKEN").isNullOrBlank(),
    )
    includeSourceContext.set(false)
    telemetry.set(false)
    tracingInstrumentation {
        enabled.set(sentryEnabled)
    }
}
