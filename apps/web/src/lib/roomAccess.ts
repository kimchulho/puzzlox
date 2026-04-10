import { apiUrl } from "./apiBase";

/** Supabase `rooms` 조회 시 `password` 컬럼은 클라이언트로 가져오지 않음. */
export const ROOM_PUBLIC_COLUMNS =
  "id, creator_name, image_url, piece_count, max_players, status, created_at, completed_at, difficulty, has_password, total_play_time_seconds, is_private, room_code, created_by" as const;

function roomPwdSessionKey(roomId: number) {
  return `puzzle_room_pwd_ok:${roomId}`;
}

/**
 * 비밀번호 방: 프롬프트 + 서버 검증 후 sessionStorage 에 통과 표시.
 * @returns 취소·오류 시 false
 */
export async function ensureRoomPasswordVerified(
  roomId: number,
  hasPassword: boolean,
  isKo: boolean
): Promise<boolean> {
  if (!hasPassword) return true;
  try {
    if (sessionStorage.getItem(roomPwdSessionKey(roomId)) === "1") return true;
  } catch {
    /* ignore */
  }
  const pwd = window.prompt(isKo ? "방 비밀번호를 입력하세요:" : "Enter room password:");
  if (pwd === null) return false;
  const res = await fetch(apiUrl("/api/rooms/verify-password"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, password: pwd }),
  });
  if (!res.ok) {
    alert(
      res.status === 403
        ? isKo
          ? "비밀번호가 올바르지 않습니다."
          : "Incorrect password."
        : isKo
          ? "비밀번호 확인에 실패했습니다."
          : "Could not verify the password."
    );
    return false;
  }
  try {
    sessionStorage.setItem(roomPwdSessionKey(roomId), "1");
  } catch {
    /* ignore */
  }
  return true;
}
