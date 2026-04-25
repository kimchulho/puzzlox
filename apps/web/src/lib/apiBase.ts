/** API origin without trailing slash. Empty = same origin (Vite dev + integrated server, or Toss proxy). */
export function getApiBase(): string {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_REMOTE_API_IN_DEV !== "true") {
    return "";
  }
  const raw =
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    "";
  if (typeof raw === "string" && raw.trim()) {
    return raw.replace(/\/$/, "");
  }
  return "";
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/** Leaderboard rows for a room (served from API with service-level DB access, not browser RLS). */
export type RoomScoreRow = {
  room_id: number;
  username: string;
  score: number;
  nickname?: string | null;
};

export async function fetchRoomScores(roomId: number): Promise<RoomScoreRow[]> {
  try {
    const res = await fetch(apiUrl(`/api/rooms/${roomId}/scores`));
    if (!res.ok) return [];
    const j = (await res.json()) as { scores?: unknown };
    if (!Array.isArray(j.scores)) return [];
    return j.scores
      .map((r) => {
        const row = r as { room_id?: unknown; username?: unknown; score?: unknown; nickname?: unknown };
        const uname = String(row.username ?? "").trim();
        if (!uname) return null;
        const nicknameRaw = String(row.nickname ?? "").trim();
        return {
          room_id: Number.isFinite(Number(row.room_id)) ? Number(row.room_id) : roomId,
          username: uname,
          score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
          nickname: nicknameRaw !== "" ? nicknameRaw : null,
        };
      })
      .filter((x): x is RoomScoreRow => x != null);
  } catch {
    return [];
  }
}
