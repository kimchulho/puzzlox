import { apiUrl } from "./apiBase";

const LS_GUEST_ASSIST_POINTS = "puzzlox_guest_assist_points_v1";

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export function getGuestAssistPoints(): number {
  try {
    const raw = localStorage.getItem(LS_GUEST_ASSIST_POINTS);
    if (raw == null || raw === "") {
      localStorage.setItem(LS_GUEST_ASSIST_POINTS, String(10));
      return 10;
    }
    const pts = parseNonNegativeInt(raw, 10);
    localStorage.setItem(LS_GUEST_ASSIST_POINTS, String(pts));
    return pts;
  } catch {
    return 10;
  }
}

export function spendGuestAssistPoints(cost: number): { ok: boolean; balance: number } {
  const safeCost = Math.max(0, Math.floor(cost));
  const cur = getGuestAssistPoints();
  if (cur < safeCost) return { ok: false, balance: cur };
  const next = cur - safeCost;
  try {
    localStorage.setItem(LS_GUEST_ASSIST_POINTS, String(next));
  } catch {
    // noop
  }
  return { ok: true, balance: next };
}

export function earnGuestAssistPoints(amount: number): number {
  const safe = Math.max(0, Math.floor(amount));
  const cur = getGuestAssistPoints();
  const next = cur + safe;
  try {
    localStorage.setItem(LS_GUEST_ASSIST_POINTS, String(next));
  } catch {
    // noop
  }
  return next;
}

export async function fetchUserAssistPoints(token: string): Promise<number> {
  const res = await fetch(apiUrl("/api/assist-points"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch assist points.");
  const j = (await res.json()) as { assistPoints?: unknown };
  return parseNonNegativeInt(j.assistPoints, 0);
}

export async function spendUserAssistPoints(token: string, amount: number): Promise<number | null> {
  const safe = Math.max(0, Math.floor(amount));
  const res = await fetch(apiUrl("/api/assist-points/spend"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ amount: safe }),
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error("Failed to spend assist points.");
  const j = (await res.json()) as { assistPoints?: unknown };
  return parseNonNegativeInt(j.assistPoints, 0);
}

export async function earnUserAssistPoints(token: string, amount: number): Promise<number> {
  const safe = Math.max(0, Math.floor(amount));
  const res = await fetch(apiUrl("/api/assist-points/earn"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ amount: safe }),
  });
  if (!res.ok) throw new Error("Failed to earn assist points.");
  const j = (await res.json()) as { assistPoints?: unknown };
  return parseNonNegativeInt(j.assistPoints, 0);
}
