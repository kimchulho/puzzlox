/**
 * Puzzlox Android WebView(네이티브 AdMob 보상형) — 방마다 1회 시청.
 * @see runTossRewardedRoomEntry in tossRewardedAdGate.ts
 */

const LS_SEEN = "puzzlox_android_native_reward_ad_seen_room_ids";

function readSeenRoomIds(): Set<number> {
  try {
    const raw = localStorage.getItem(LS_SEEN);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is number => typeof x === "number" && Number.isFinite(x)));
  } catch {
    return new Set();
  }
}

export function hasAndroidNativeRewardAdBeenSeenForRoom(roomId: number): boolean {
  return readSeenRoomIds().has(roomId);
}

function markSeen(roomId: number) {
  const next = readSeenRoomIds();
  next.add(roomId);
  localStorage.setItem(LS_SEEN, JSON.stringify([...next].slice(0, 400)));
}

type AndroidBridge = { showRewardedForRoom: (roomId: string, requestId: string) => void };

let nativePending: {
  requestId: string;
  roomId: number;
  enter: () => void;
} | null = null;
let nativeResolve: ((b: boolean) => void) | null = null;

function ensureNativeHook(): void {
  if (typeof window === "undefined") return;
  if ((window as unknown as { puzzloxAndroidRewardHook?: unknown }).puzzloxAndroidRewardHook) return;
  (window as unknown as { puzzloxAndroidRewardHook: (req: string, phase: string, userEarned?: boolean) => void }).puzzloxAndroidRewardHook = (
    req: string,
    phase: string,
    userEarned?: boolean
  ) => {
    const p = nativePending;
    if (!p || p.requestId !== req) return;
    if (phase === "earned") {
      markSeen(p.roomId);
      p.enter();
    }
    if (phase === "dismissed") {
      const r = nativeResolve;
      nativePending = null;
      nativeResolve = null;
      r?.(!!userEarned);
    }
  };
}

export function isPuzzloxAndroidWithNativeReward(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { PuzzloxAndroid?: AndroidBridge }).PuzzloxAndroid?.showRewardedForRoom === "function";
}

/**
 * 네이티브 load → show 보상형. 같은 roomId는 localStorage에 기록되어 동일 기기에서 재입장 시 생략.
 * 리워드는 `earned` 이후에만 `enter` (dismissed만으로는 입장 없음, 토스와 동일).
 */
export async function runAndroidNativeRewardedRoomEntry(roomId: number, enter: () => void): Promise<boolean> {
  const W = window as unknown as { PuzzloxAndroid?: AndroidBridge };
  if (!W.PuzzloxAndroid?.showRewardedForRoom) {
    enter();
    return true;
  }

  if (readSeenRoomIds().has(roomId)) {
    enter();
    return true;
  }

  ensureNativeHook();

  return await new Promise<boolean>((resolve) => {
    const requestId = `${roomId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    nativePending = { requestId, roomId, enter };
    nativeResolve = resolve;
    try {
      W.PuzzloxAndroid!.showRewardedForRoom(String(roomId), requestId);
    } catch {
      nativePending = null;
      nativeResolve = null;
      resolve(false);
    }
  });
}
