import { TossAds } from "@apps-in-toss/web-framework";
import { useEffect, useRef, useState } from "react";

/** 앱인토스 콘솔 테스트용 리스트형 배너 ID @see https://developers-apps-in-toss.toss.im/ads/develop.html */
export const TOSS_LOBBY_TEST_BANNER_AD_GROUP_ID = "ait-ad-test-banner-id";

type InitState = "idle" | "pending" | "ok" | "fail";
let tossAdsInitState: InitState = "idle";
const tossAdsInitWaiters: Array<(ok: boolean) => void> = [];

function ensureTossAdsInitialized(): Promise<boolean> {
  if (!TossAds.initialize.isSupported()) return Promise.resolve(false);
  if (tossAdsInitState === "ok") return Promise.resolve(true);
  if (tossAdsInitState === "fail") return Promise.resolve(false);
  return new Promise((resolve) => {
    tossAdsInitWaiters.push(resolve);
    if (tossAdsInitState === "idle") {
      tossAdsInitState = "pending";
      TossAds.initialize({
        callbacks: {
          onInitialized: () => {
            tossAdsInitState = "ok";
            tossAdsInitWaiters.splice(0).forEach((r) => r(true));
          },
          onInitializationFailed: () => {
            tossAdsInitState = "fail";
            tossAdsInitWaiters.splice(0).forEach((r) => r(false));
          },
        },
      });
    }
  });
}

/**
 * 토스 로비 하단 고정형 배너(리스트형 96px 권장).
 * 게임형: 홈 인디케이터 위 최소 여백 4px — @see https://developers-apps-in-toss.toss.im/ads/develop.html
 */
export function TossLobbyBottomBanner({ safeAreaBottom }: { safeAreaBottom: number }) {
  const supported =
    typeof window !== "undefined" &&
    TossAds.initialize.isSupported() &&
    TossAds.attachBanner.isSupported();
  const containerRef = useRef<HTMLDivElement>(null);
  const [adsReady, setAdsReady] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void ensureTossAdsInitialized().then((ok) => {
      if (!cancelled && ok) setAdsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !adsReady || !containerRef.current) return;

    const el = containerRef.current;
    const attached = TossAds.attachBanner(TOSS_LOBBY_TEST_BANNER_AD_GROUP_ID, el, {
      theme: "auto",
      tone: "blackAndWhite",
      variant: "expanded",
    });

    return () => {
      attached.destroy();
    };
  }, [supported, adsReady]);

  if (!supported) return null;

  return (
    <div
      className="w-full shrink-0 bg-[#F4F8FF]"
      style={{
        paddingTop: 4,
        paddingBottom: safeAreaBottom + 4,
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: 96 }} />
    </div>
  );
}
