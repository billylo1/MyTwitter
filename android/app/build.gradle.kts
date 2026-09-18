import java.io.FileInputStream
import java.net.URI
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
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

val siteHost: String =
    try {
        URI(siteUrl).host ?: "YOUR_PROJECT_ID.web.app"
    } catch (_: Exception) {
        "YOUR_PROJECT_ID.web.app"
    }

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
        minSdk = 33
        targetSdk = 36
        versionCode = 9
        versionName = "0.2.0"
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
        buildConfigField("String", "SENTRY_DSN", "\"$sentryDsn\"")
        manifestPlaceholders["siteHost"] = siteHost
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
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("io.coil-kt.coil3:coil-compose:3.0.4")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.0.4")

    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")

    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-auth-ktx")
    implementation("com.google.firebase:firebase-firestore-ktx")
    implementation("com.google.firebase:firebase-functions-ktx")
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
