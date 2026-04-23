import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// AdMob "앱" ID(콘솔 → 앱 → 앱 설정, 단위 ID와 별도). local.properties: ADMOB_APP_ID=ca-app-pub-xxx~yyy
// 미설정 시 Google 샘플 ID(개발/테스트 광고용).
val admobAppId: String = localProps.getProperty("ADMOB_APP_ID")?.trim()
    ?: "ca-app-pub-3940256099942544~3347511713"

android {
    namespace = "com.puzzlox.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.puzzlox.app"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        resValue("string", "gma_app_id", admobAppId)
    }

    buildTypes {
        debug {
            buildConfigField("String", "REWARDED_AD_UNIT_ID", "\"ca-app-pub-9880062103386476/9681650177\"")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField(
                "String",
                "REWARDED_AD_UNIT_ID",
                "\"ca-app-pub-9880062103386476/9681650177\"",
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
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.gms:play-services-ads:23.6.0")
}
