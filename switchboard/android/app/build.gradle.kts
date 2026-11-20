import java.util.Base64
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Every release must carry a bigger versionCode than the one installed, or the
// phone refuses the update. tools/release.sh passes minutes-since-epoch, which
// only goes up and needs no bookkeeping.
val sbVersionCode = (findProperty("sbVersionCode") as String?)?.toInt()
    ?: System.getenv("SB_VERSION_CODE")?.toInt() ?: 1
val sbVersionName = (findProperty("sbVersionName") as String?)
    ?: System.getenv("SB_VERSION_NAME") ?: "0.1.0-dev"

android {
    namespace = "dev.switchboard.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.switchboard.app"
        minSdk = 29
        targetSdk = 35
        versionCode = sbVersionCode
        versionName = sbVersionName
    }

    signingConfigs {
        // Self-update only works if every build is signed with the same key:
        // Android refuses to install an update whose signature changed.
        //   1. keystore.properties next to this file (tools/keystore.sh makes it)
        //   2. SB_KEYSTORE_BASE64 + SB_KEYSTORE_PASSWORD (CI secrets)
        //   3. otherwise the machine's debug key (fine for a first try only)
        create("sideload") {
            val properties = rootProject.file("keystore.properties")
            val encoded = System.getenv("SB_KEYSTORE_BASE64")
            when {
                properties.exists() -> {
                    val p = Properties().apply { properties.inputStream().use { load(it) } }
                    storeFile = rootProject.file(p.getProperty("storeFile"))
                    storePassword = p.getProperty("storePassword")
                    keyAlias = p.getProperty("keyAlias")
                    keyPassword = p.getProperty("keyPassword")
                }
                !encoded.isNullOrBlank() -> {
                    val f = layout.buildDirectory.file("sb-ci.jks").get().asFile
                    f.parentFile.mkdirs()
                    f.writeBytes(Base64.getDecoder().decode(encoded))
                    storeFile = f
                    storePassword = System.getenv("SB_KEYSTORE_PASSWORD")
                    keyAlias = "switchboard"
                    keyPassword = System.getenv("SB_KEYSTORE_PASSWORD")
                }
            }
        }
    }

    buildTypes {
        release {
            // R8 takes the APK from ~56 MB (mostly icon classes) to a few MB,
            // which matters when the phone downloads every update itself.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("sideload").takeIf { it.storeFile != null }
                ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.okhttp)
    implementation(libs.flic2)
    testImplementation(libs.junit)
}
