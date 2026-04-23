plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "1.9.25" apply false
}

/**
 * android-browser-helper 등이 끌어오는 오래된 kotlin-stdlib-jdk7/jdk8(예: 1.6.x)과
 * AGP가 쓰는 kotlin-stdlib(1.8+)가 겹치면 Duplicate class 가 납니다. Kotlin 계열을 한 버전으로 맞춥니다.
 */
subprojects {
    configurations.configureEach {
        resolutionStrategy {
            force(
                "org.jetbrains.kotlin:kotlin-stdlib:1.9.25",
                "org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.25",
                "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.25",
            )
        }
    }
}
