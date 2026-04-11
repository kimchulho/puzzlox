# 퍼즐록스 Android (TWA — 웹 기본)

이 모듈은 **웹 사이트(https://puzzlox.com/)를 그대로 여는** [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/) 래퍼입니다. 웹·앱인토스(Granite) 코드와 **같은 Git 저장소**에 두고, Android Studio로만 빌드합니다.

## 사전 준비

1. **Android Studio** 최신 안정판 설치 ([developer.android.com/studio](https://developer.android.com/studio)).
2. **JDK 17** (Studio에 번들된 JDK로 충분).
3. **Google Play 개발자 계정** (스토어 출시 시).

## 1단계: 프로젝트 열기

1. Android Studio → **Open** → 이 저장소의 `apps/android` 폴더 선택.
2. Gradle 동기화가 끝날 때까지 대기합니다.  
   - `gradle-wrapper.jar`가 없다는 안내가 나오면, Studio가 제안하는 대로 **Wrapper 생성**을 허용하거나, 터미널에서 `gradle wrapper`를 실행한 뒤 다시 엽니다.

## 2단계: 패키지 이름(선택)

기본 `applicationId`는 **`com.puzzlox.app`** 입니다. 바꾸려면:

- `app/build.gradle.kts`의 `applicationId` / `namespace`
- 아래 4·5단계의 환경 변수 `ANDROID_TWA_PACKAGE_NAME`  
을 **동일한 값**으로 맞춥니다.

## 3단계: 로컬에서 동작 확인

- **디버그 빌드**로 기기/에뮬레이터에 설치해 실행합니다.
- 처음에는 Digital Asset Links가 없어 **주소창이 잠깐 보일 수 있습니다**(정상).  
- Chrome 개발자용 플래그로 검증을 끄는 방법도 있으나, 출시 전에는 **아래 4~5단계**를 완료하는 것을 권장합니다.

## 4단계: 서버에 Digital Asset Links 연결

스토어용 **업로드 키**(또는 Play 앱 서명 사용 시 Play가 알려주는 인증서)의 **SHA-256** 지문이 필요합니다.

1. 업로드 키스토어가 있다면:
   ```bash
   keytool -list -v -keystore your-upload.keystore -alias your-alias
   ```
   출력의 **SHA256** 한 줄을 복사합니다 (콜론 포함 형식 그대로).
2. 배포 중인 **Node 서버(Render 등)** 에 환경 변수를 설정합니다 (`.env.example` 참고):
   - `ANDROID_TWA_PACKAGE_NAME` — 예: `com.puzzlox.app`
   - `ANDROID_TWA_SHA256_CERT_FINGERPRINTS` — 지문이 여러 개면 **쉼표 또는 공백**으로 구분
3. 배포 후 브라우저에서  
   `https://puzzlox.com/.well-known/assetlinks.json`  
   이 **JSON 배열**을 반환하는지 확인합니다. (미설정 시 404)

레포의 `server.ts`가 위 경로를 처리합니다.

## 5단계: 앱 쪽 도메인 일치

- `app/src/main/AndroidManifest.xml`의 `DEFAULT_URL`과 `intent-filter`의 `android:host`
- `app/src/main/res/values/strings.xml`의 `asset_statements` 안 `https://puzzlox.com`

이 세 곳이 **실제 서비스 URL**과 같아야 합니다. 스테이징 도메인을 쓰면 동일하게 바꿉니다.

## 6단계: 릴리스 서명 & AAB

1. Android Studio → **Build → Generate Signed App Bundle or APK** → **Android App Bundle**.
2. 업로드용 키스토어를 만들거나 선택합니다. (Play 앱 서명을 쓰면 Google이 재서명합니다.)
3. 생성된 **`.aab`** 파일을 보관합니다.

## 7단계: Play Console

1. [Google Play Console](https://play.google.com/console)에서 새 앱 생성.
2. 패키지 이름이 **`com.puzzlox.app`**(또는 변경한 ID)과 일치하는지 확인.
3. **내부 테스트** 트랙에 AAB 업로드 → 테스터로 설치해 **전체 화면·주소창 숨김** 여부를 확인합니다.
4. 스토어 정책(개인정보처리방침 URL, 콘텐츠 등급, 데이터 안전 등)을 작성·제출합니다.

## 문제 해결

| 현상 | 조치 |
|------|------|
| 주소창이 계속 보임 | `assetlinks.json`이 공개되었는지, 패키지명·SHA256이 앱·서버·Play 키와 일치하는지 확인 |
| 앱이 사이트를 열지 않음 | 기기 인터넷, `https://puzzlox.com` 접속, 방화벽 |
| Gradle 동기화 실패 | JDK 17, `compileSdk`/`AGP` 버전, 방화벽에서 Maven(google) 허용 |

## 대안: Bubblewrap

CLI로 TWA 프로젝트를 만들고 싶다면 [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)을 사용해도 됩니다. 이 레포의 `apps/android`와 중복되지 않게 **별 폴더**에 생성하는 것을 권장합니다.

## 참고 링크

- [Trusted Web Activity — Chrome Developers](https://developer.chrome.com/docs/android/trusted-web-activity/)
- [Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started)
