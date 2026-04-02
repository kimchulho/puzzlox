import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

/** 앱인토스 콘솔 보상형 광고 테스트용 그룹 ID @see https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EA%B4%91%EA%B3%A0/IntegratedAd.html */
export const TOSS_REWARDED_AD_TEST_GROUP_ID = "ait-ad-test-rewarded-id";

const LS_SEEN_ROOMS = "toss_puzzle_reward_ad_seen_room_ids";

function readSeenRoomIds(): Set<number> {
  try {
    const raw = localStorage.getItem(LS_SEEN_ROOMS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is number => typeof x === "number" && Number.isFinite(x)));
  } catch {
    return new Set();
  }
}

/** UI 라벨용: 해당 방은 이 기기에서 이미 보상형 광고를 시청해 입장한 적이 있는지 */
export function hasTossRewardAdBeenSeenForRoom(roomId: number): boolean {
  return readSeenRoomIds().has(roomId);
}

function markSeen(roomId: number) {
  const next = readSeenRoomIds();
  next.add(roomId);
  localStorage.setItem(LS_SEEN_ROOMS, JSON.stringify([...next].slice(0, 400)));
}

/**
 * 토스 통합 보상형 광고( load → show ) 후 방 입장.
 * 같은 roomId는 localStorage에 기록되어 같은 기기에서 재입장 시 광고 생략.
 * 리워드 지급·입장은 `userEarnedReward` 시에만 처리 (dismissed만으로는 입장하지 않음).
 */
export async function runTossRewardedRoomEntry(roomId: number, enter: () => void): Promise<boolean> {
  if (readSeenRoomIds().has(roomId)) {
    enter();
    return true;
  }

  const loadOk = typeof loadFullScreenAd.isSupported === "function" && loadFullScreenAd.isSupported();
  const showOk = typeof showFullScreenAd.isSupported === "function" && showFullScreenAd.isSupported();
  if (!loadOk || !showOk) {
    enter();
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let finished = false;
    let loadUnregister: (() => void) | undefined;
    let showUnregister: (() => void) | undefined;

    const cleanup = () => {
      try {
        loadUnregister?.();
      } catch {
        /* noop */
      }
      try {
        showUnregister?.();
      } catch {
        /* noop */
      }
    };

    const done = (ok: boolean) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(ok);
    };

    loadUnregister = loadFullScreenAd({
      options: { adGroupId: TOSS_REWARDED_AD_TEST_GROUP_ID },
      onEvent: (event) => {
        if (event.type !== "loaded") return;
        let rewarded = false;
        showUnregister = showFullScreenAd({
          options: { adGroupId: TOSS_REWARDED_AD_TEST_GROUP_ID },
          onEvent: (ev) => {
            if (ev.type === "userEarnedReward") {
              rewarded = true;
              markSeen(roomId);
              enter();
            }
            if (ev.type === "dismissed") {
              done(rewarded);
            }
            if (ev.type === "failedToShow") {
              done(rewarded);
            }
          },
          onError: () => done(false),
        });
      },
      onError: () => done(false),
    });
  });
}
