import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// Google test ids — app id and rewarded unit must be the same (test) pair, or a matching prod pair
// (test app id + live rewarded unit = failed loads / no fill)
val adMobTestAppId = "ca-app-pub-3940256099942544~3347511713"
val adMobTestRewardedUnitId = "ca-app-pub-3940256099942544/5224354917"

// Puzzlox AdMob — rewarded (운영) 단 ID (AdMob 콘솔 > 보상형)
val puzzloxAdMobRewardedUnitId = "ca-app-pub-9880062103386476/9681650177"
val adMobDefaultProdRewardedUnitId = puzzloxAdMobRewardedUnitId

// local.properties: ADMOB_APP_ID=ca-app-pub-xxx~yyy (콘솔 "앱" 메뉴, 단 ID와 별도)
// 선택: ADMOB_REWARDED_AD_UNIT_ID=… (운영에서 단만 바꿀 때)
// 미지정 ADMOB_APP_ID → 테스트 앱 + 테스트 보상형(샘플 광고)으로 빌드
val admobAppId: String = localProps.getProperty("ADMOB_APP_ID")?.trim() ?: adMobTestAppId

val rewardedAdUnitId: String =
    if (admobAppId == adMobTestAppId) {
        adMobTestRewardedUnitId
    } else {
        localProps.getProperty("ADMOB_REWARDED_AD_UNIT_ID")?.trim()
            ?: adMobDefaultProdRewardedUnitId
    }

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
        buildConfigField("String", "REWARDED_AD_UNIT_ID", "\"$rewardedAdUnitId\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.gms:play-services-ads:23.6.0")
}
