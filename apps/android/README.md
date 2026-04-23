# 퍼즐록스 Android (WebView + 네이티브 AdMob)

[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/) 대신 **WebView**로 [https://puzzlox.com/](https://puzzlox.com/)을 열고, **방 입장·방 생성** 시점에 토스(앱인토스)와 동일한 정책으로 **AdMob 보상형 광고**를 **네이티브 SDK**로 표시합니다. 웹 `Lobby`는 `window.PuzzloxAndroid.showRewardedForRoom` 브리지를 감지해 동일한 `localStorage` 기반 “방당 1회” 게이트를 씁니다.

## 사전 준비

1. **Android Studio** 최신 안정판, **JDK 17**.
2. **Google AdMob** 앱에 보상형 광고 단위가 등록돼 있어야 합니다.  
3. (선택) 루트 `apps/android/local.properties`에 **앱(애플리케이션) ID**를 넣을 수 있습니다. (단위 ID `ca-app-pub-…/…`가 아닙니다.)

```properties
ADMOB_APP_ID=ca-app-pub-퍼블리셔숫자~앱접미사
```

`local.properties`를 두지 않으면 Gradle이 **Google 샘플 앱 ID**(`ca-app-pub-3940256099942544~3347511713`)로 빌드됩니다. **스토어용 릴리스**에서는 반드시 AdMob 콘솔에 나온 **앱 ID**로 바꾸는 것이 좋습니다.  
- **debug / release** 보상형 **단위** ID: `ca-app-pub-9880062103386476/9681650177`

## 빌드

1. Android Studio → **Open** → `apps/android`.
2. Gradle 동기화 후 **Run** 또는 **Build → Generate App Bundle** (Play용은 **release**).

`gradlew`가 없다면 Android Studio의 Gradle 래퍼 생성 안내에 따르거나, Studio 메뉴로 빌드하세요.

## Digital Asset Links (선택)

이전 TWA(Chrome 전용 전체화면)용 `/.well-known/assetlinks.json`은 WebView **필수**는 아닙니다. 앱 링크로 `https://puzzlox.com/...`를 연다면 `AndroidManifest`의 `VIEW` `intent-filter`는 유지됩니다.

## 참고

- [AdMob — 보상형 광고(Android)](https://developers.google.com/admob/android/rewarded)
- 웹: `apps/web`의 `androidNativeRewardedAdGate.ts`, `Lobby` 보상 구간
