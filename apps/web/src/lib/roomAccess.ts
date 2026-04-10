import { apiUrl } from "./apiBase";

/** Supabase `rooms` 조회 시 입장 비밀번호 컬럼은 클라이언트로 가져오지 않음. */
export const ROOM_PUBLIC_COLUMNS =
  "id, creator_name, image_url, piece_count, max_players, status, created_at, completed_at, difficulty, has_password, total_play_time_seconds, is_private, room_code, created_by" as const;

/** 로비 목록 등: `has_password` 값이 DB/직렬화마다 달라질 수 있음. */
export function roomRowHasPasswordLobby(r: { has_password?: unknown }): boolean {
  const v = r?.has_password;
  return v === true || v === "true" || v === "t" || v === 1 || v === "1";
}

/** 공개 프로필 참여 행: API `hasPassword` 우선(직렬화 표현 흡수), 없으면 `has_password`. */
export function profileParticipatedRowHasPassword(r: {
  hasPassword?: unknown;
  has_password?: unknown;
}): boolean {
  const camel = r.hasPassword;
  if (camel === true || camel === 1 || camel === "1" || camel === "true") return true;
  return roomRowHasPasswordLobby({ has_password: r.has_password });
}

const LS_GUEST_CREATED_ROOMS = "puzzle_created_room_ids";

function readGuestCreatedRoomIds(): number[] {
  try {
    const raw = localStorage.getItem(LS_GUEST_CREATED_ROOMS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function sameCreatorId(rowCreator: unknown, userId: unknown): boolean {
  if (rowCreator == null || userId == null || userId === "") return false;
  return String(rowCreator) === String(userId);
}

export type RoomPasswordGateRow = {
  id: number;
  created_by?: string | number | null;
  creator_name?: string | null;
};

/** 로그인·게스트 방장 여부 (Lobby `roomIsMine` 와 동일). */
export function isRoomCreatorClient(
  room: RoomPasswordGateRow,
  user?: { id?: string | number; username?: string } | null
): boolean {
  if (user?.id != null && user.id !== "") {
    if (sameCreatorId(room.created_by, user.id)) return true;
    if (!room.created_by && user.username && room.creator_name === user.username) return true;
    return false;
  }
  return readGuestCreatedRoomIds().includes(room.id);
}

function roomPwdSessionKey(roomId: number) {
  return `puzzle_room_pwd_ok:${roomId}`;
}

/**
 * 비밀번호 방: 방장은 생략. 그 외 프롬프트 + 서버 검증(Bearer 시 방장 재확인).
 * @returns 취소·오류 시 false
 */
export async function ensureRoomPasswordVerified(
  roomId: number,
  hasPassword: boolean,
  isKo: boolean,
  opts?: {
    room?: RoomPasswordGateRow;
    user?: { id?: string | number; username?: string } | null;
  }
): Promise<boolean> {
  if (!hasPassword) return true;
  if (opts?.room && isRoomCreatorClient(opts.room, opts.user)) {
    try {
      sessionStorage.setItem(roomPwdSessionKey(roomId), "1");
    } catch {
      /* ignore */
    }
    return true;
  }
  try {
    if (sessionStorage.getItem(roomPwdSessionKey(roomId)) === "1") return true;
  } catch {
    /* ignore */
  }
  const pwd = window.prompt(isKo ? "방 비밀번호를 입력하세요:" : "Enter room password:");
  if (pwd === null) return false;
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("puzzle_access_token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl("/api/rooms/verify-password"), {
    method: "POST",
    headers,
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
