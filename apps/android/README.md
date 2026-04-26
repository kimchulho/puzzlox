# 퍼즐록스 Android (WebView + 네이티브 AdMob)

[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/) 대신 **WebView**로 [https://puzzlox.com/](https://puzzlox.com/)을 열고, **방 입장·방 생성** 시점에 토스(앱인토스)와 동일한 정책으로 **AdMob 보상형 광고**를 **네이티브 SDK**로 표시합니다. 웹 `Lobby`는 `window.PuzzloxAndroid.showRewardedForRoom` 브리지를 감지해 동일한 `localStorage` 기반 “방당 1회” 게이트를 씁니다.

## 사전 준비

1. **Android Studio** 최신 안정판, **JDK 17**.
2. **Google AdMob** 앱에 보상형 광고 단위가 등록돼 있어야 합니다.  
3. (권장) `apps/android/local.properties`에 **AdMob 앱(애플리케이션) ID**를 넣습니다(콘솔 “앱” 메뉴, `~`가 들어가는 값). **보상형 단 ID**(`…/…`)와는 별도입니다. 운영 단만 쓰려면(선택):

```properties
ADMOB_APP_ID=ca-app-pub-9880062103386476~콘솔의앱접미
ADMOB_REWARDED_AD_UNIT_ID=ca-app-pub-9880062103386476/9681650177
```

`ADMOB_APP_ID`를 **빼 두면** 빌드는 **Google 테스트 앱 ID + 테스트 보상형 단**으로 묶이며(샘플 광고), 운영 앱/단과 섞이면 `onAdFailedToLoad`로 광고가 나오지 않을 수 있으므로, 스토어/실서비스 빌드에서는 콘솔 **앱 ID**를 반드시 맞춥니다. 테스트 전용 키(샘플 앱)일 때는 보상형 단도 테스트용(`…/5224354917`)으로 맞출 필요가 있으며, Gradle이 그렇게 골라줍니다.

## 빌드

1. Android Studio → **Open** → `apps/android`.
2. Gradle 동기화 후 **Run** 또는 **Build → Generate App Bundle** (Play용은 **release**).

`gradlew`가 없다면 Android Studio의 Gradle 래퍼 생성 안내에 따르거나, Studio 메뉴로 빌드하세요.

## Digital Asset Links (선택)

이전 TWA(Chrome 전용 전체화면)용 `/.well-known/assetlinks.json`은 WebView **필수**는 아닙니다. 앱 링크로 `https://puzzlox.com/...`를 연다면 `AndroidManifest`의 `VIEW` `intent-filter`는 유지됩니다.

## 참고

- [AdMob — 보상형 광고(Android)](https://developers.google.com/admob/android/rewarded)
- 웹: `apps/web`의 `androidNativeRewardedAdGate.ts`, `Lobby` 보상 구간
