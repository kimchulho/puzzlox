import type { AuthMeResponse, AuthSuccessResponse, AuthUser } from "@contracts/auth";
import { apiUrl } from "./apiBase";

const TOKEN_KEY = "puzzle_access_token";
const USER_KEY = "puzzle_user";

export function loadStoredSession(): { token: string; user: AuthUser } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  if (!token || !raw) return null;
  try {
    const user = JSON.parse(raw) as AuthUser;
    if (!user?.id) return null;
    return { token, user };
  } catch {
    return null;
  }
}

export function persistSession(data: AuthSuccessResponse): void {
  localStorage.setItem(TOKEN_KEY, data.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function postTossLogin(body: {
  authorizationCode: string;
  referrer: string;
}): Promise<AuthSuccessResponse> {
  const url = apiUrl("/api/auth/toss/login");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    const preview = text.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(
      `Unexpected response for /api/auth/toss/login (HTTP ${res.status}, content-type: ${contentType}). Body preview: ${preview}`
    );
  }

  const json = (await res.json()) as AuthSuccessResponse & { message?: string };
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
  if (!json.accessToken || !json.user) throw new Error("로그인 응답이 올바르지 않습니다.");
  return json;
}

export async function fetchAuthMe(token: string): Promise<AuthMeResponse> {
  const url = apiUrl("/api/auth/me");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    const preview = text.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(
      `Unexpected response for /api/auth/me (HTTP ${res.status}, content-type: ${contentType}). Body preview: ${preview}`
    );
  }

  const json = (await res.json()) as AuthMeResponse & { message?: string };
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
  if (!json.user) throw new Error("사용자 정보를 불러오지 못했습니다.");
  return json;
}
