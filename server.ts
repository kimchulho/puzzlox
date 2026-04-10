import express from "express";
import { existsSync } from "fs";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import {
  CursorMovePayload,
  JoinRoomPayload,
  MoveBatchPayload,
  PlayerPresencePayload,
  ROOM_EVENTS,
  LockAppliedPayload,
  LockDeniedPayload,
  LockRequestPayload,
  LockReleasedPayload,
  ScoreDeltaPayload,
  ScoreSyncPayload,
  SyncTimePayload,
  UnlockRequestPayload,
} from "./packages/contracts/realtime";
import { HealthResponse } from "./packages/contracts/api";
import { AuthSuccessResponse, TossLoginRequest } from "./packages/contracts/auth";
import { tossPartnerRequest, TossPartnerRequestError } from "./tossPartnerClient";

dotenv.config();

/** Set LOG_PIECE_PERSIST=1 to log MoveBatch → DB queue → pieces upsert (rotation / back face). */
const LOG_PIECE_PERSIST = /^1|true|yes$/i.test(String(process.env.LOG_PIECE_PERSIST ?? "").trim());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase 클라이언트 초기화 (서버용)
const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const authSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;
/** Piece x/y/orientation upserts must bypass RLS; anon often cannot update these rows/columns. */
const pieceStateSupabase = authSupabase ?? supabase;
const jwtSecret = process.env.JWT_SECRET || "dev-jwt-secret-change-me";

/** Same algorithm as apps/web `encodeRoomId` (for API payloads). */
function encodeRoomCodeForApi(id: number): string {
  const M = 2176782336n;
  const A = 1234567n;
  const C = 890123n;
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const BASE = 36n;
  const idBig = BigInt(id);
  const encodedNum = (idBig * A + C) % M;
  let num = encodedNum;
  let str = "";
  for (let i = 0; i < 6; i++) {
    str = ALPHABET[Number(num % BASE)] + str;
    num = num / BASE;
  }
  return str;
}

/** Per-room locked piece counts and row totals for dashboard/profile progress (single batched query). */
async function loadPieceProgressMaps(
  client: SupabaseClient,
  roomIds: number[]
): Promise<{ lockedByRoom: Map<number, number>; rowsByRoom: Map<number, number> } | null> {
  const lockedByRoom = new Map<number, number>();
  const rowsByRoom = new Map<number, number>();
  if (roomIds.length === 0) return { lockedByRoom, rowsByRoom };
  const { data: pieceRows, error } = await client
    .from("pieces")
    .select("room_id, is_locked")
    .in("room_id", roomIds);
  if (error) {
    console.warn("[piece-progress]", error.message);
    return null;
  }
  for (const row of pieceRows ?? []) {
    const rid = Number((row as { room_id?: unknown }).room_id);
    if (!Number.isFinite(rid) || rid <= 0) continue;
    rowsByRoom.set(rid, (rowsByRoom.get(rid) ?? 0) + 1);
    if ((row as { is_locked?: unknown }).is_locked === true) {
      lockedByRoom.set(rid, (lockedByRoom.get(rid) ?? 0) + 1);
    }
  }
  return { lockedByRoom, rowsByRoom };
}

/**
 * Match lobby `snappedCount`: min(total, max(pieces.is_locked count, user's score sum in room)).
 * Progress can come from `scores` before/without `is_locked` rows matching lobby behavior.
 */
function dashboardProgressSnapped(totalPieces: number, lockedFromDb: number, userScoreSum: number): number {
  if (totalPieces <= 0) return 0;
  const scored = Math.max(0, Math.floor(userScoreSum));
  return Math.min(totalPieces, Math.max(lockedFromDb, scored));
}

/** 로비 직접 업로드 방 — `rooms.is_private` (Lobby `handleCreateRoom` 과 동일). */
function roomIsPrivateForListing(row: { is_private?: unknown }): boolean {
  return row.is_private === true;
}

/** 로비 진행/완료 목록: 비밀번호 방 제외 (`has_password`·`room_password`·레거시 `password` 컬럼까지 동일 기준). */
function roomHasPasswordForLobbyList(row: {
  has_password?: unknown;
  room_password?: unknown;
  password?: unknown;
}): boolean {
  const hp = row.has_password;
  if (hp === true || hp === "true" || hp === "t" || hp === 1 || hp === "1") return true;
  const rp = row.room_password;
  if (rp != null && String(rp).trim() !== "") return true;
  const leg = row.password;
  if (leg != null && String(leg).trim() !== "") return true;
  return false;
}

type AuthProvider = "web_local" | "toss";

interface JwtPayload {
  sub: string;
  provider: AuthProvider;
  channel: "web" | "toss";
  role: "player";
}

interface AuthedRequest extends Request {
  user?: JwtPayload;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });
  const ROOMS_SUMMARY_CACHE_TTL_MS = 2000;
  const roomsSummaryCache = new Map<
    string,
    { at: number; payload: { activeRooms: any[]; completedRooms: any[] } }
  >();
  
  const PORT = process.env.PORT || 3000;

  // Allow cross-origin API calls (e.g. local Granite WebView -> production API).
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  });

  app.use(express.json({ limit: "8mb" }));

  if (!authSupabase) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY is missing. /api/auth/web/* endpoints will return 503."
    );
  }

  app.get("/api/health", (req, res) => {
    const payload: HealthResponse = {
      status: "ok",
      message: "Server is running with Socket.io",
    };
    res.json(payload);
  });

  /** 로비/클라이언트 응답에서 방 입장 비밀번호 컬럼 제거 */
  function omitRoomPassword(row: Record<string, unknown>) {
    const { password: _p, room_password: _rp, ...rest } = row;
    return rest;
  }

  const issueToken = (payload: JwtPayload) =>
    jwt.sign(payload, jwtSecret, { expiresIn: "7d" });

  const parseBearerToken = (authorizationHeader?: string) => {
    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return null;
    }
    return authorizationHeader.slice("Bearer ".length).trim();
  };

  /** 비밀번호 방 입장 검증. 방장(JWT sub === created_by)은 비밀번호 없이 통과. */
  app.post("/api/rooms/verify-password", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const roomId = Number((req.body ?? {}).roomId);
    const attemptRaw = (req.body ?? {}).password;
    if (!Number.isFinite(roomId) || roomId <= 0) {
      return res.status(400).json({ message: "roomId is required." });
    }
    const { data: room, error } = await authSupabase
      .from("rooms")
      .select("has_password, password, room_password, created_by")
      .eq("id", roomId)
      .maybeSingle();
    if (error) {
      return res.status(500).json({ message: error.message });
    }
    if (!room) {
      return res.status(404).json({ message: "Room not found." });
    }

    const token = parseBearerToken(
      typeof req.headers.authorization === "string" ? req.headers.authorization : undefined
    );
    if (token) {
      try {
        const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
        const uid = Number(decoded.sub);
        const cb = room.created_by != null ? Number(room.created_by) : NaN;
        if (Number.isFinite(uid) && uid > 0 && Number.isFinite(cb) && cb === uid) {
          return res.status(204).end();
        }
      } catch {
        /* invalid token → 비밀번호 검사로 진행 */
      }
    }

    if (!roomHasPasswordForLobbyList(room as Record<string, unknown>)) {
      return res.status(204).end();
    }
    const expected = (room.room_password ?? room.password ?? "").toString().trim();
    const got = attemptRaw == null ? "" : String(attemptRaw).trim();
    if (expected === "" || got !== expected) {
      return res.status(403).json({ message: "Wrong password." });
    }
    return res.status(204).end();
  });

  const authRequired = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ message: "Missing access token." });
    }
    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired access token." });
    }
  };

  app.post("/api/auth/web/signup", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const { username, password } = req.body ?? {};
    const normalizedUsername = (username ?? "").toString().trim().toLowerCase();
    const rawPassword = (password ?? "").toString();

    if (!normalizedUsername || rawPassword.length < 4) {
      return res.status(400).json({
        message: "username is required and password must be at least 4 characters.",
      });
    }

    if (normalizedUsername.startsWith("toss_")) {
      return res.status(400).json({
        message:
          "'toss_'로 시작하는 아이디는 예약되어 있어 가입할 수 없습니다. 다른 아이디를 사용해 주세요.",
      });
    }

    const { data: existingIdentity, error: existingError } = await authSupabase
      .from("user_identities")
      .select("id")
      .eq("provider", "web_local")
      .eq("provider_user_id", normalizedUsername)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ message: existingError.message });
    }
    if (existingIdentity) {
      return res.status(409).json({ message: "Username already exists." });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const { data: createdUser, error: userInsertError } = await authSupabase
      .from("users")
      .insert({
        username: normalizedUsername,
        nickname: normalizedUsername,
        password: passwordHash,
        role: normalizedUsername === "admin" ? "admin" : "user",
        completed_puzzles: 0,
        placed_pieces: 0,
        profile_public: true,
      })
      .select("id, username, nickname, role, completed_puzzles, placed_pieces, profile_public, created_at, last_active_at")
      .single();

    if (userInsertError || !createdUser) {
      return res
        .status(500)
        .json({ message: userInsertError?.message ?? "Failed to create user." });
    }

    const { error: identityInsertError } = await authSupabase.from("user_identities").insert({
      user_id: createdUser.id,
      provider: "web_local",
      provider_user_id: normalizedUsername,
      password_hash: passwordHash,
      last_login_at: new Date().toISOString(),
    });

    if (identityInsertError) {
      await authSupabase.from("users").delete().eq("id", createdUser.id);
      return res.status(500).json({ message: identityInsertError.message });
    }

    const token = issueToken({
      sub: String(createdUser.id),
      provider: "web_local",
      channel: "web",
      role: "player",
    });

    return res.status(201).json({
      accessToken: token,
      user: createdUser,
    });
  });

  app.post("/api/auth/web/login", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const { username, password } = req.body ?? {};
    const normalizedUsername = (username ?? "").toString().trim().toLowerCase();
    const rawPassword = (password ?? "").toString();

    if (!normalizedUsername || !rawPassword) {
      return res.status(400).json({ message: "username and password are required." });
    }

    const { data: identity, error: identityError } = await authSupabase
      .from("user_identities")
      .select("id, user_id, password_hash")
      .eq("provider", "web_local")
      .eq("provider_user_id", normalizedUsername)
      .maybeSingle();

    if (identityError) {
      return res.status(500).json({ message: identityError.message });
    }
    if (!identity?.password_hash) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const passwordMatch = await bcrypt.compare(rawPassword, identity.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const { data: user, error: userError } = await authSupabase
      .from("users")
      .select("id, username, nickname, role, completed_puzzles, placed_pieces, profile_public, created_at, last_active_at")
      .eq("id", identity.user_id)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ message: userError.message });
    }
    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    await authSupabase
      .from("user_identities")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", identity.id);

    await authSupabase
      .from("users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", user.id);

    const token = issueToken({
      sub: String(user.id),
      provider: "web_local",
      channel: "web",
      role: "player",
    });

    const response: AuthSuccessResponse = {
      accessToken: token,
      user,
    };
    return res.json(response);
  });

  app.post("/api/auth/toss/login", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }

    const { authorizationCode, referrer } = (req.body ?? {}) as TossLoginRequest;
    const code = (authorizationCode ?? "").toString().trim();
    const ref = (referrer ?? "").toString().trim();
    const codePreview = code ? `${code.slice(0, 8)}...(${code.length})` : "empty";

    if (!code || !ref) {
      return res.status(400).json({
        message: "authorizationCode and referrer are required (Apps in Toss appLogin response).",
      });
    }

    /** Partner API expects lowercase `sandbox` for 샌드박스; `appLogin` types use `SANDBOX`. */
    const partnerReferrer =
      ref === "SANDBOX" || ref.toLowerCase() === "sandbox" ? "sandbox" : ref;
    console.log("[toss-login] incoming", {
      referrer: ref,
      partnerReferrer,
      codePreview,
    });

    let providerUserId: string;
    try {
      const tokenRes = await tossPartnerRequest<Record<string, unknown>>({
        method: "POST",
        path: "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
        headers: {},
        jsonBody: { authorizationCode: code, referrer: partnerReferrer },
      });

      if (tokenRes.statusCode < 200 || tokenRes.statusCode >= 300) {
        return res.status(502).json({
          message: `Toss generate-token HTTP ${tokenRes.statusCode}.`,
          detail: tokenRes.body,
        });
      }

      const tokenBody = tokenRes.body as {
        resultType?: string;
        success?: { accessToken?: string };
        error?: string | { reason?: string };
      };

      if (tokenBody.error === "invalid_grant") {
        return res.status(401).json({ message: "invalid_grant", detail: tokenBody });
      }

      if (tokenBody.resultType !== "SUCCESS" || !tokenBody.success?.accessToken) {
        console.error("[toss-login] generate-token not successful", {
          resultType: tokenBody.resultType,
          error: tokenBody.error,
          referrer: partnerReferrer,
        });
        return res.status(502).json({
          message:
            `Toss generate-token did not return a successful accessToken. ` +
            `resultType=${String(tokenBody.resultType)} error=${JSON.stringify(tokenBody.error)}`,
          detail: tokenBody,
        });
      }

      const tossAccessToken = tokenBody.success.accessToken;

      const meRes = await tossPartnerRequest<Record<string, unknown>>({
        method: "GET",
        path: "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
        headers: { Authorization: `Bearer ${tossAccessToken}` },
      });

      if (meRes.statusCode < 200 || meRes.statusCode >= 300) {
        return res.status(502).json({
          message: `Toss login-me HTTP ${meRes.statusCode}.`,
          detail: meRes.body,
        });
      }

      const meBody = meRes.body as {
        resultType?: string;
        success?: { userKey?: number };
        error?: string;
      };

      if (meBody.error === "invalid_grant") {
        return res.status(401).json({ message: "invalid_grant", detail: meBody });
      }

      const userKey = meBody.success?.userKey;
      if (meBody.resultType !== "SUCCESS" || userKey === undefined || userKey === null) {
        return res.status(502).json({
          message: "Toss login-me did not return userKey.",
          detail: meBody,
        });
      }

      providerUserId = String(userKey);
    } catch (error) {
      console.error("[toss-login] partner API request failed", error);
      if (error instanceof TossPartnerRequestError) {
        return res.status(502).json({
          message: error.message,
          code: error.code,
        });
      }
      return res.status(502).json({
        message: "Toss partner API request failed.",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const { data: existingIdentity, error: identityError } = await authSupabase
      .from("user_identities")
      .select("id, user_id")
      .eq("provider", "toss")
      .eq("provider_user_id", providerUserId)
      .maybeSingle();

    if (identityError) {
      return res.status(500).json({ message: identityError.message });
    }

    let userId = existingIdentity?.user_id as number | undefined;
    if (!userId) {
      const generatedUsername = `toss_${providerUserId}`.slice(0, 64);
      const { data: createdUser, error: createUserError } = await authSupabase
        .from("users")
        .insert({
          username: generatedUsername,
          nickname: generatedUsername,
          password: "",
          role: "user",
          completed_puzzles: 0,
          placed_pieces: 0,
          profile_public: true,
        })
        .select("id")
        .single();

      if (createUserError || !createdUser) {
        return res
          .status(500)
          .json({ message: createUserError?.message ?? "Failed to create toss user." });
      }
      userId = createdUser.id as number;

      const { error: createIdentityError } = await authSupabase
        .from("user_identities")
        .insert({
          user_id: userId,
          provider: "toss",
          provider_user_id: providerUserId,
          password_hash: null,
          last_login_at: new Date().toISOString(),
        });

      if (createIdentityError) {
        await authSupabase.from("users").delete().eq("id", userId);
        return res.status(500).json({ message: createIdentityError.message });
      }
    } else {
      await authSupabase
        .from("user_identities")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", existingIdentity?.id);
    }

    const { data: user, error: userError } = await authSupabase
      .from("users")
      .select("id, username, nickname, role, completed_puzzles, placed_pieces, profile_public, created_at, last_active_at")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(500).json({ message: userError?.message ?? "Failed to load user." });
    }

    await authSupabase
      .from("users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", user.id);

    const token = issueToken({
      sub: String(user.id),
      provider: "toss",
      channel: "toss",
      role: "player",
    });

    const response: AuthSuccessResponse = {
      accessToken: token,
      user,
    };
    return res.json(response);
  });

  app.get("/api/auth/me", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!userId) {
      return res.status(401).json({ message: "Invalid token subject." });
    }

    const { data: user, error } = await authSupabase
      .from("users")
      .select("id, username, nickname, role, completed_puzzles, placed_pieces, profile_public, created_at, last_active_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ message: error.message });
    }
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({ user });
  });

  app.patch("/api/user/profile", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }
    const body = req.body ?? {};
    const profilePublic = body.profilePublic;
    const nicknameRaw = (body as Record<string, unknown>).nickname;
    const nextNickname =
      nicknameRaw == null ? undefined : String(nicknameRaw).trim().slice(0, 32);
    if (typeof profilePublic !== "boolean" && typeof nextNickname === "undefined") {
      return res.status(400).json({ message: "profilePublic(boolean) or nickname(string) is required." });
    }
    if (typeof nextNickname === "string" && nextNickname.length === 0) {
      return res.status(400).json({ message: "nickname cannot be empty." });
    }
    const updatePayload: Record<string, unknown> = {};
    if (typeof profilePublic === "boolean") updatePayload.profile_public = profilePublic;
    if (typeof nextNickname === "string") updatePayload.nickname = nextNickname;
    const { error: upErr } = await authSupabase
      .from("users")
      .update(updatePayload)
      .eq("id", userId);
    if (upErr) {
      console.warn("[api/user/profile]", upErr.message);
      return res.status(500).json({ message: upErr.message });
    }
    const { data: user, error: readErr } = await authSupabase
      .from("users")
      .select("id, username, nickname, role, completed_puzzles, placed_pieces, profile_public, created_at, last_active_at")
      .eq("id", userId)
      .maybeSingle();
    if (readErr || !user) {
      return res.status(500).json({ message: readErr?.message ?? "Failed to load user." });
    }
    return res.json({ user });
  });

  /**
   * 로그인 사용자가 직접 업로드한 이미지 삭제.
   * 해당 이미지 URL로 생성된 비공개 방(직접 업로드 기반)도 함께 삭제한다.
   */
  app.delete("/api/user/uploaded-image", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }
    const imageId = Number((req.body ?? {}).imageId);
    const imageUrl = ((req.body ?? {}).imageUrl ?? "").toString().trim();
    if ((!Number.isFinite(imageId) || imageId <= 0) && imageUrl === "") {
      return res.status(400).json({ message: "imageId or imageUrl is required." });
    }

    let imageQuery = authSupabase
      .from("puzzle_images")
      .select("id, url, is_public")
      .limit(1);
    if (Number.isFinite(imageId) && imageId > 0) {
      imageQuery = imageQuery.eq("id", imageId);
    } else {
      imageQuery = imageQuery.eq("url", imageUrl);
    }
    const { data: imageRow, error: imageErr } = await imageQuery.maybeSingle();
    if (imageErr) {
      return res.status(500).json({ message: imageErr.message });
    }
    const targetUrl = String(imageRow?.url ?? imageUrl ?? "").trim();
    if (!targetUrl) {
      return res.status(400).json({ message: "Image URL is empty." });
    }
    if (imageRow?.is_public === true) {
      return res.status(400).json({ message: "Public image cannot be deleted from this endpoint." });
    }

    const { data: roomsByImage, error: roomsErr } = await authSupabase
      .from("rooms")
      .select("id")
      .eq("image_url", targetUrl)
      .eq("is_private", true);
    if (roomsErr) {
      return res.status(500).json({ message: roomsErr.message });
    }
    const roomIds = (roomsByImage ?? [])
      .map((r) => Number((r as { id?: unknown }).id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (roomIds.length === 0) {
      return res.status(403).json({ message: "Only your uploaded image can be deleted." });
    }

    const { data: ownedRooms, error: ownedErr } = await authSupabase
      .from("rooms")
      .select("id")
      .in("id", roomIds)
      .eq("created_by", userId);
    if (ownedErr) return res.status(500).json({ message: ownedErr.message });
    const ownedRoomIds = (ownedRooms ?? [])
      .map((r) => Number((r as { id?: unknown }).id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ownedRoomIds.length === 0) {
      return res.status(403).json({ message: "Only your uploaded image can be deleted." });
    }

    const BLANK_ROOM_IMAGE_DATA_URL =
      "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%221280%22%20height%3D%22720%22%20viewBox%3D%220%200%201280%20720%22%3E%3Crect%20width%3D%221280%22%20height%3D%22720%22%20fill%3D%22%23ffffff%22/%3E%3C/svg%3E";
    const { error: roomBlankErr } = await authSupabase
      .from("rooms")
      .update({ image_url: BLANK_ROOM_IMAGE_DATA_URL })
      .in("id", ownedRoomIds);
    if (roomBlankErr) return res.status(500).json({ message: roomBlankErr.message });

    let imageDeleteQuery = authSupabase.from("puzzle_images").delete().eq("url", targetUrl).neq("is_public", true);
    if (Number.isFinite(imageId) && imageId > 0) {
      imageDeleteQuery = imageDeleteQuery.eq("id", imageId);
    }
    const { error: imageDelErr } = await imageDeleteQuery;
    if (imageDelErr) {
      return res.status(500).json({ message: imageDelErr.message });
    }

    return res.json({ ok: true, blankedRoomCount: ownedRoomIds.length, deletedImageId: imageRow?.id ?? null });
  });

  app.get("/api/user/dashboard", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }

    const { data: me, error: meErr } = await authSupabase
      .from("users")
      .select("id, username, nickname, role, completed_puzzles, placed_pieces, profile_public, created_at, last_active_at")
      .eq("id", userId)
      .maybeSingle();
    if (meErr || !me) {
      return res.status(500).json({ message: meErr?.message ?? "User not found." });
    }

    const subjectUsername = String(me.username);

    const { data: visits } = await authSupabase
      .from("user_room_visits")
      .select("room_id, last_visited_at")
      .eq("user_id", userId);

    const { data: scoreRows } = await authSupabase
      .from("scores")
      .select("room_id, score")
      .eq("username", subjectUsername);

    const roomIdSet = new Set<number>();
    for (const v of visits ?? []) {
      const rid = Number((v as { room_id?: unknown }).room_id);
      if (Number.isFinite(rid) && rid > 0) roomIdSet.add(rid);
    }
    for (const s of scoreRows ?? []) {
      const rid = Number((s as { room_id?: unknown }).room_id);
      if (Number.isFinite(rid) && rid > 0) roomIdSet.add(rid);
    }

    const visitByRoom = new Map<number, string>();
    for (const v of visits ?? []) {
      const rid = Number((v as { room_id?: unknown }).room_id);
      const t = (v as { last_visited_at?: unknown }).last_visited_at;
      if (Number.isFinite(rid) && rid > 0 && typeof t === "string") visitByRoom.set(rid, t);
    }
    const scoreByRoom = new Map<number, number>();
    for (const s of scoreRows ?? []) {
      const rid = Number((s as { room_id?: unknown }).room_id);
      const sc = Number((s as { score?: unknown }).score ?? 0);
      if (!Number.isFinite(rid) || rid <= 0 || !Number.isFinite(sc)) continue;
      scoreByRoom.set(rid, (scoreByRoom.get(rid) ?? 0) + Math.floor(sc));
    }

    const roomIdsForProgress = [...roomIdSet];
    const pieceMaps = await loadPieceProgressMaps(authSupabase, roomIdsForProgress);
    const lockedByRoom = pieceMaps?.lockedByRoom ?? new Map<number, number>();
    const pieceRowsByRoom = pieceMaps?.rowsByRoom ?? new Map<number, number>();

    /** Same as lobby: sum of all players' scores per room (not only the dashboard user). */
    const roomScoreSumByRoom = new Map<number, number>();
    if (roomIdsForProgress.length > 0) {
      const { data: allScores, error: allScoresErr } = await authSupabase
        .from("scores")
        .select("room_id, score")
        .in("room_id", roomIdsForProgress);
      if (allScoresErr) {
        console.warn("[dashboard/room-scores]", allScoresErr.message);
      } else {
        for (const row of allScores ?? []) {
          const rid = Number((row as { room_id?: unknown }).room_id);
          const sc = Number((row as { score?: unknown }).score ?? 0);
          if (!Number.isFinite(rid) || rid <= 0 || !Number.isFinite(sc) || sc <= 0) continue;
          roomScoreSumByRoom.set(rid, (roomScoreSumByRoom.get(rid) ?? 0) + Math.floor(sc));
        }
      }
    }

    let participatedRooms: Array<Record<string, unknown>> = [];
    if (roomIdSet.size > 0) {
      const { data: rooms, error: roomsErr } = await authSupabase
        .from("rooms")
        .select(
          "id, image_url, piece_count, difficulty, status, creator_name, created_by, created_at, completed_at"
        )
        .in("id", [...roomIdSet]);
      if (roomsErr) {
        return res.status(500).json({ message: roomsErr.message });
      }
      participatedRooms = (rooms ?? []).map((room: Record<string, unknown>) => {
        const rid = Number(room.id);
        const createdBy = room.created_by != null ? Number(room.created_by) : NaN;
        const iAmCreator = Number.isFinite(createdBy) && createdBy === userId;
        const pieceCountDb = Number(room.piece_count ?? 0);
        const rowTotal = pieceRowsByRoom.get(rid) ?? 0;
        const totalPieces = Math.max(pieceCountDb, rowTotal);
        const lockedFromDb = lockedByRoom.get(rid) ?? 0;
        const userScoreSum = scoreByRoom.get(rid) ?? 0;
        const roomScoreSum = roomScoreSumByRoom.get(rid) ?? 0;
        const lockedPieces = dashboardProgressSnapped(totalPieces, lockedFromDb, roomScoreSum);
        const progressPercent =
          totalPieces > 0 ? Math.min(100, Math.round((lockedPieces / totalPieces) * 100)) : 0;
        const statusStr = String(room.status ?? "");
        const isCompleted =
          statusStr === "completed" || (totalPieces > 0 && lockedPieces >= totalPieces);
        return {
          roomId: rid,
          roomCode: encodeRoomCodeForApi(rid),
          imageUrl: (room.image_url as string) ?? null,
          difficulty: (room.difficulty as string) ?? null,
          status: (room.status as string) ?? null,
          pieceCount: pieceCountDb,
          totalPieces,
          lockedPieces,
          progressPercent,
          isCompleted,
          completedAt: (room.completed_at as string) ?? null,
          creatorName: (room.creator_name as string) ?? null,
          lastVisitedAt: visitByRoom.get(rid) ?? null,
          scoreInRoom: userScoreSum,
          iAmCreator,
        };
      });
      participatedRooms.sort((a, b) => {
        const ta = a.lastVisitedAt ? Date.parse(String(a.lastVisitedAt)) : 0;
        const tb = b.lastVisitedAt ? Date.parse(String(b.lastVisitedAt)) : 0;
        if (tb !== ta) return tb - ta;
        return Number(b.roomId) - Number(a.roomId);
      });
    }

    /** 로비에서 직접 업로드(custom)로 만든 방만 `is_private=true`; 퍼즐록스 제공 이미지 선택 방은 `false`. */
    const { data: createdRooms, error: crErr } = await authSupabase
      .from("rooms")
      .select("id, image_url, piece_count, difficulty, status, creator_name, created_at, completed_at")
      .eq("created_by", userId)
      .eq("is_private", true)
      .order("created_at", { ascending: false })
      .limit(80);

    if (crErr) {
      return res.status(500).json({ message: crErr.message });
    }

    const myUploads = (createdRooms ?? []).map((room: Record<string, unknown>) => ({
      roomId: Number(room.id),
      roomCode: encodeRoomCodeForApi(Number(room.id)),
      imageUrl: (room.image_url as string) ?? null,
      difficulty: (room.difficulty as string) ?? null,
      status: (room.status as string) ?? null,
      pieceCount: Number(room.piece_count ?? 0),
      createdAt: (room.created_at as string) ?? null,
      completedAt: (room.completed_at as string) ?? null,
    }));

    return res.json({ user: me, participatedRooms, myUploads });
  });

  app.get("/api/profile/:username", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const raw = (req.params.username ?? "").toString().trim().toLowerCase();
    if (!raw) {
      return res.status(400).json({ message: "username is required." });
    }

    const { data: subject, error: subErr } = await authSupabase
      .from("users")
      .select("id, username, nickname, completed_puzzles, placed_pieces, profile_public")
      .eq("username", raw)
      .maybeSingle();

    if (subErr) {
      return res.status(500).json({ message: subErr.message });
    }
    if (!subject) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!subject.profile_public) {
      return res.status(404).json({ message: "Profile is private." });
    }

    const subjectId = Number(subject.id);
    const subjectUsername = String(subject.username);

    const { data: visits } = await authSupabase
      .from("user_room_visits")
      .select("room_id, last_visited_at")
      .eq("user_id", subjectId);

    const { data: scoreRows } = await authSupabase
      .from("scores")
      .select("room_id, score")
      .eq("username", subjectUsername);

    const roomIdSet = new Set<number>();
    for (const v of visits ?? []) {
      const rid = Number((v as { room_id?: unknown }).room_id);
      if (Number.isFinite(rid) && rid > 0) roomIdSet.add(rid);
    }
    for (const s of scoreRows ?? []) {
      const rid = Number((s as { room_id?: unknown }).room_id);
      if (Number.isFinite(rid) && rid > 0) roomIdSet.add(rid);
    }

    const visitByRoom = new Map<number, string>();
    for (const v of visits ?? []) {
      const rid = Number((v as { room_id?: unknown }).room_id);
      const t = (v as { last_visited_at?: unknown }).last_visited_at;
      if (Number.isFinite(rid) && rid > 0 && typeof t === "string") visitByRoom.set(rid, t);
    }
    const scoreByRoom = new Map<number, number>();
    for (const s of scoreRows ?? []) {
      const rid = Number((s as { room_id?: unknown }).room_id);
      const sc = Number((s as { score?: unknown }).score ?? 0);
      if (!Number.isFinite(rid) || rid <= 0 || !Number.isFinite(sc)) continue;
      scoreByRoom.set(rid, (scoreByRoom.get(rid) ?? 0) + Math.floor(sc));
    }

    const profileRoomIds = [...roomIdSet];
    const profilePieceMaps = await loadPieceProgressMaps(authSupabase, profileRoomIds);
    const profileLockedByRoom = profilePieceMaps?.lockedByRoom ?? new Map<number, number>();
    const profilePieceRowsByRoom = profilePieceMaps?.rowsByRoom ?? new Map<number, number>();

    const profileRoomScoreSumByRoom = new Map<number, number>();
    if (profileRoomIds.length > 0) {
      const { data: profileAllScores, error: profileScoresErr } = await authSupabase
        .from("scores")
        .select("room_id, score")
        .in("room_id", profileRoomIds);
      if (profileScoresErr) {
        console.warn("[profile/room-scores]", profileScoresErr.message);
      } else {
        for (const row of profileAllScores ?? []) {
          const rid = Number((row as { room_id?: unknown }).room_id);
          const sc = Number((row as { score?: unknown }).score ?? 0);
          if (!Number.isFinite(rid) || rid <= 0 || !Number.isFinite(sc) || sc <= 0) continue;
          profileRoomScoreSumByRoom.set(rid, (profileRoomScoreSumByRoom.get(rid) ?? 0) + Math.floor(sc));
        }
      }
    }

    let participatedRooms: Array<Record<string, unknown>> = [];
    if (roomIdSet.size > 0) {
      const { data: rooms, error: roomsErr } = await authSupabase
        .from("rooms")
        .select(
          "id, image_url, piece_count, difficulty, status, creator_name, created_by, created_at, completed_at, is_private, has_password, room_password, password"
        )
        .in("id", [...roomIdSet]);
      if (roomsErr) {
        return res.status(500).json({ message: roomsErr.message });
      }
      /** 공개 프로필: 직접 업로드만 제외. 비밀번호 방은 `hasPassword` 로 내려 클라이언트에서 필터(테스트·제외). */
      const roomsForPublicProfile = (rooms ?? []).filter(
        (room: Record<string, unknown>) => !roomIsPrivateForListing(room)
      );
      participatedRooms = roomsForPublicProfile.map((room: Record<string, unknown>) => {
        const rid = Number(room.id);
        const createdBy = room.created_by != null ? Number(room.created_by) : NaN;
        const subjectCreatedThis = Number.isFinite(createdBy) && createdBy === subjectId;
        const pieceCountDb = Number(room.piece_count ?? 0);
        const rowTotal = profilePieceRowsByRoom.get(rid) ?? 0;
        const totalPieces = Math.max(pieceCountDb, rowTotal);
        const lockedFromDb = profileLockedByRoom.get(rid) ?? 0;
        const userScoreSum = scoreByRoom.get(rid) ?? 0;
        const roomScoreSum = profileRoomScoreSumByRoom.get(rid) ?? 0;
        const lockedPieces = dashboardProgressSnapped(totalPieces, lockedFromDb, roomScoreSum);
        const progressPercent =
          totalPieces > 0 ? Math.min(100, Math.round((lockedPieces / totalPieces) * 100)) : 0;
        const statusStr = String(room.status ?? "");
        const isCompleted =
          statusStr === "completed" || (totalPieces > 0 && lockedPieces >= totalPieces);
        return {
          roomId: rid,
          roomCode: encodeRoomCodeForApi(rid),
          imageUrl: subjectCreatedThis ? null : ((room.image_url as string) ?? null),
          imageHiddenReason: subjectCreatedThis ? ("creator_private" as const) : null,
          difficulty: (room.difficulty as string) ?? null,
          status: (room.status as string) ?? null,
          pieceCount: pieceCountDb,
          totalPieces,
          lockedPieces,
          progressPercent,
          isCompleted,
          completedAt: (room.completed_at as string) ?? null,
          creatorName: (room.creator_name as string) ?? null,
          lastVisitedAt: visitByRoom.get(rid) ?? null,
          scoreInRoom: userScoreSum,
          iAmCreator: subjectCreatedThis,
          hasPassword: roomHasPasswordForLobbyList(room),
        };
      });
      participatedRooms.sort((a, b) => {
        const ta = a.lastVisitedAt ? Date.parse(String(a.lastVisitedAt)) : 0;
        const tb = b.lastVisitedAt ? Date.parse(String(b.lastVisitedAt)) : 0;
        if (tb !== ta) return tb - ta;
        return Number(b.roomId) - Number(a.roomId);
      });
    }

    return res.json({
      user: {
        username: subject.username,
        nickname: (subject as { nickname?: unknown }).nickname ?? null,
        completed_puzzles: subject.completed_puzzles,
        placed_pieces: subject.placed_pieces,
      },
      participatedRooms,
    });
  });

  /** 이어하기용 방문 목록 (RLS 우회: service role + JWT sub = users.id). */
  app.get("/api/user/room-visits", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }

    const { data, error } = await authSupabase
      .from("user_room_visits")
      .select("room_id, last_visited_at")
      .eq("user_id", userId)
      .order("last_visited_at", { ascending: false })
      .limit(40);

    if (error) {
      console.warn("[api/user/room-visits]", error.message);
      return res.status(500).json({ message: error.message });
    }
    return res.json({ visits: data ?? [] });
  });

  /** Logged-in room visit for 이어하기 (RLS 우회: service role + JWT의 sub만 신뢰). */
  app.post("/api/user/room-visit", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }
    const roomId = Number((req.body ?? {}).roomId);
    if (!Number.isFinite(roomId) || roomId <= 0) {
      return res.status(400).json({ message: "roomId must be a positive number." });
    }

    const { error } = await authSupabase.from("user_room_visits").upsert(
      {
        user_id: userId,
        room_id: roomId,
        last_visited_at: new Date().toISOString(),
      },
      { onConflict: "user_id,room_id" }
    );

    if (error) {
      console.warn("[api/user/room-visit]", error.message);
      return res.status(500).json({ message: error.message });
    }
    return res.status(204).end();
  });

  app.get("/api/rooms/summary", async (req, res) => {
    /**
     * 로비 진행/완료 목록: 직접 업로드(`is_private`)·비밀번호(`has_password`) 방은 목록에서 제외.
     * 입장은 방 코드 등으로만 가능.
     */
    const cacheKey = "lobby:public-lists-v3";
    const cached = roomsSummaryCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < ROOMS_SUMMARY_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }
    const { data: activePublic, error: activePublicError } = await supabase
      .from("rooms")
      .select("*")
      .eq("status", "active")
      .eq("is_private", false)
      .order("created_at", { ascending: false });
    if (activePublicError) {
      return res.status(500).json({ message: activePublicError.message });
    }
    const active = [...(activePublic ?? [])];

    const { data: completedPublic, error: completedError } = await supabase
      .from("rooms")
      .select("*")
      .eq("status", "completed")
      .eq("is_private", false)
      .order("created_at", { ascending: false });
    if (completedError) {
      return res.status(500).json({ message: completedError.message });
    }

    const activeIds = active.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
    const completedIds = (completedPublic ?? [])
      .map((r) => Number((r as { id?: unknown }).id))
      .filter((id) => Number.isFinite(id));
    const roomIds = [...new Set([...activeIds, ...completedIds])];
    const totalByRoom = new Map<number, number>();
    const lockedByRoom = new Map<number, number>();
    const scoreByRoom = new Map<number, number>();
    if (roomIds.length > 0) {
      const { data: pieces, error: piecesError } = await supabase
        .from("pieces")
        .select("room_id,is_locked")
        .in("room_id", roomIds);
      if (piecesError) {
        return res.status(500).json({ message: piecesError.message });
      }
      for (const row of pieces ?? []) {
        const roomId = Number((row as { room_id: unknown }).room_id);
        totalByRoom.set(roomId, (totalByRoom.get(roomId) ?? 0) + 1);
        if ((row as { is_locked?: unknown }).is_locked === true) {
          lockedByRoom.set(roomId, (lockedByRoom.get(roomId) ?? 0) + 1);
        }
      }
      const { data: scores, error: scoresError } = await supabase
        .from("scores")
        .select("room_id,score")
        .in("room_id", roomIds);
      if (scoresError) {
        return res.status(500).json({ message: scoresError.message });
      }
      for (const row of scores ?? []) {
        const roomId = Number((row as { room_id: unknown }).room_id);
        const score = Number((row as { score?: unknown }).score ?? 0);
        if (!Number.isFinite(roomId) || roomId <= 0 || !Number.isFinite(score) || score <= 0) continue;
        scoreByRoom.set(roomId, (scoreByRoom.get(roomId) ?? 0) + Math.floor(score));
      }
    }

    /** `pieces` row count is authoritative once rows exist; keep `rooms.piece_count` in sync for lobby and deep links. */
    const roomByIdForPieceSync = new Map<number, any>();
    for (const r of active) {
      const id = Number((r as { id?: unknown }).id);
      if (Number.isFinite(id)) roomByIdForPieceSync.set(id, r);
    }
    for (const r of completedPublic ?? []) {
      const id = Number((r as { id?: unknown }).id);
      if (Number.isFinite(id) && !roomByIdForPieceSync.has(id)) roomByIdForPieceSync.set(id, r);
    }
    const syncPieceUpdates: Promise<{ error: { message: string } | null }>[] = [];
    for (const [rid, rowTotal] of totalByRoom) {
      if (rowTotal <= 0) continue;
      const rec = roomByIdForPieceSync.get(rid);
      if (!rec) continue;
      const dbCount = Number(rec.piece_count ?? 0);
      if (!Number.isFinite(dbCount) || dbCount === rowTotal) continue;
      syncPieceUpdates.push(
        (async () => {
          const up = await pieceStateSupabase
            .from("rooms")
            .update({ piece_count: rowTotal })
            .eq("id", rid);
          if (!up.error) rec.piece_count = rowTotal;
          return { error: up.error };
        })()
      );
    }
    if (syncPieceUpdates.length > 0) {
      const syncResults = await Promise.all(syncPieceUpdates);
      for (const sr of syncResults) {
        if (sr.error) console.warn("[rooms-summary/sync-piece-count]", sr.error.message);
      }
    }

    const newlyCompletedIds: number[] = [];
    for (const room of active) {
      const id = Number(room.id);
      const total = totalByRoom.get(id) ?? Number(room.piece_count ?? 0);
      const locked = lockedByRoom.get(id) ?? 0;
      const scored = scoreByRoom.get(id) ?? 0;
      const snapped = Math.min(total > 0 ? total : Number(room.piece_count ?? 0), Math.max(locked, scored));
      room.totalPieces = total > 0 ? total : Number(room.piece_count ?? 0);
      room.snappedCount = snapped;
      room.currentPlayers = roomStates.get(id)?.users.size ?? 0;
      if (room.totalPieces > 0 && room.totalPieces === room.snappedCount && room.status === "active") {
        newlyCompletedIds.push(id);
        room.status = "completed";
      }
    }
    if (newlyCompletedIds.length > 0) {
      const completedAtIso = new Date().toISOString();
      const { error: markCompletedError } = await supabase
        .from("rooms")
        .update({ status: "completed", completed_at: completedAtIso } as any)
        .in("id", newlyCompletedIds);
      if (markCompletedError) {
        // Backward compatibility: if DB column is not migrated yet, retry without completed_at.
        const retry = await supabase
          .from("rooms")
          .update({ status: "completed" })
          .in("id", newlyCompletedIds);
        if (retry.error) {
          console.warn("[rooms-summary/mark-completed]", retry.error.message);
        }
      }
    }

    const finalActive = active.filter((r) => r.status === "active");
    const completedMerged = new Map<number, any>();
    for (const r of completedPublic ?? []) completedMerged.set(Number(r.id), r);
    for (const r of active.filter((x) => x.status === "completed")) {
      completedMerged.set(Number(r.id), r);
    }
    const completionTimeMs = (room: any) => {
      const completedAtMs = Date.parse(String(room?.completed_at ?? ""));
      if (Number.isFinite(completedAtMs)) return completedAtMs;
      const createdAtMs = Date.parse(String(room?.created_at ?? ""));
      const baseMs = Number.isFinite(createdAtMs) ? createdAtMs : 0;
      const playSec = Number(room?.total_play_time_seconds ?? 0);
      const elapsedMs = Number.isFinite(playSec) ? Math.max(0, Math.floor(playSec * 1000)) : 0;
      return baseMs + elapsedMs;
    };
    const completedRooms = [...completedMerged.values()].sort(
      (a, b) => completionTimeMs(b) - completionTimeMs(a)
    );
    for (const room of completedRooms) {
      const id = Number(room.id);
      const rowTotal = totalByRoom.get(id) ?? 0;
      const pc = Number(room.piece_count ?? 0);
      const denom = rowTotal > 0 ? rowTotal : pc;
      if (denom > 0) {
        room.totalPieces = denom;
        const locked = lockedByRoom.get(id) ?? 0;
        const scored = scoreByRoom.get(id) ?? 0;
        room.snappedCount = Math.min(denom, Math.max(locked, scored));
        room.currentPlayers = roomStates.get(id)?.users.size ?? 0;
      }
    }
    const isLobbyListableRoom = (r: {
      is_private?: unknown;
      has_password?: unknown;
      room_password?: unknown;
      password?: unknown;
    }) => !roomIsPrivateForListing(r) && !roomHasPasswordForLobbyList(r);
    const payload = {
      activeRooms: finalActive.filter(isLobbyListableRoom).map(omitRoomPassword),
      completedRooms: completedRooms.filter(isLobbyListableRoom).map(omitRoomPassword),
    };
    roomsSummaryCache.set(cacheKey, { at: now, payload });
    // Keep cache bounded even if many users hit this endpoint.
    if (roomsSummaryCache.size > 300) {
      const expireBefore = now - ROOMS_SUMMARY_CACHE_TTL_MS * 3;
      for (const [k, v] of roomsSummaryCache) {
        if (v.at < expireBefore) roomsSummaryCache.delete(k);
      }
    }
    return res.json(payload);
  });

  // ==========================================
  // Socket.io & Playtime Logic
  // ==========================================
  
  // 방 상태 메모리: roomId -> { accumulatedTime(초), lastResumeTime(ms), users, isCompleted }
  const roomStates = new Map<number, { 
    accumulatedTime: number; 
    lastResumeTime: number | null; 
    users: Set<string>; 
    isCompleted: boolean 
  }>();
  const roomPieceLocks = new Map<number, Map<number, { socketId: string; userId: string }>>();
  /** Last known piece orientation per room for MoveBatch broadcasts (nightmare / rotation sync). */
  const roomMovePieceOrientation = new Map<
    number,
    Map<number, { rotationQuarter: number; isBackFace: boolean }>
  >();
  const roomScoreCache = new Map<number, Map<string, number>>();
  const PIECE_DB_FLUSH_MS = 1200;
  const roomPieceStatePending = new Map<
    number,
    Map<number, {
      piece_index: number;
      x: number;
      y: number;
      is_locked: boolean;
      snapped_by?: string;
      rotation_quarter?: number;
      is_back_face?: boolean;
    }>
  >();
  const roomSolvedPieceIds = new Map<number, Set<number>>();
  const roomSolvedPieceOwner = new Map<number, Map<number, string>>();
  const roomPieceStateFlushTimer = new Map<number, ReturnType<typeof setTimeout>>();
  const roomPieceStateFlushing = new Set<number>();
  const socketOwnedPieceIds = new Map<string, Map<number, Set<number>>>();
  const socketUserId = new Map<string, string>();
  const socketUserPlaySessions = new Map<string, { userId: number; startedAt: number; roomId: number }>();
  const pendingUserPlaySeconds = new Map<number, number>();
  let flushingUserPlaySeconds = false;

  // 현재까지의 정확한 플레이 타임 계산 (초 단위)
  const getCurrentPlayTime = (room: any) => {
    let time = room.accumulatedTime;
    if (room.lastResumeTime && !room.isCompleted) {
      time += (Date.now() - room.lastResumeTime) / 1000;
    }
    return time;
  };
  const enqueueUserPlaySeconds = (userId: number, deltaSec: number) => {
    const rounded = Math.floor(deltaSec);
    if (!Number.isFinite(userId) || userId <= 0 || rounded <= 0) return;
    pendingUserPlaySeconds.set(userId, (pendingUserPlaySeconds.get(userId) ?? 0) + rounded);
  };
  const flushUserPlaySeconds = async () => {
    if (flushingUserPlaySeconds || pendingUserPlaySeconds.size === 0) return;
    flushingUserPlaySeconds = true;
    const entries = [...pendingUserPlaySeconds.entries()];
    pendingUserPlaySeconds.clear();
    try {
      await Promise.all(
        entries.map(async ([userId, delta]) => {
          const { data, error } = await supabase
            .from("users")
            .select("total_play_time")
            .eq("id", userId)
            .maybeSingle();
          if (error || !data) {
            if (error) console.warn("[user-playtime/select]", { userId, message: error.message });
            return;
          }
          const next = Number(data.total_play_time ?? 0) + delta;
          const { error: updateError } = await supabase
            .from("users")
            .update({ total_play_time: next, last_active_at: new Date().toISOString() })
            .eq("id", userId);
          if (updateError) {
            console.warn("[user-playtime/update]", { userId, message: updateError.message });
            pendingUserPlaySeconds.set(userId, (pendingUserPlaySeconds.get(userId) ?? 0) + delta);
          }
        })
      );
    } finally {
      flushingUserPlaySeconds = false;
    }
  };
  const scheduleRoomPieceStateFlush = (roomId: number) => {
    if (roomPieceStateFlushTimer.has(roomId)) return;
    const timer = setTimeout(() => {
      roomPieceStateFlushTimer.delete(roomId);
      void flushRoomPieceState(roomId);
    }, PIECE_DB_FLUSH_MS);
    roomPieceStateFlushTimer.set(roomId, timer);
  };
  const flushRoomPieceState = async (roomId: number) => {
    if (roomPieceStateFlushing.has(roomId)) return;
    const pending = roomPieceStatePending.get(roomId);
    if (!pending || pending.size === 0) return;
    const scheduled = roomPieceStateFlushTimer.get(roomId);
    if (scheduled) {
      clearTimeout(scheduled);
      roomPieceStateFlushTimer.delete(roomId);
    }
    roomPieceStateFlushing.add(roomId);
    const entries = [...pending.values()];
    pending.clear();
    try {
      const payload = entries.map((u) => ({
        ...(() => {
          const row: {
            room_id: number;
            piece_index: number;
            x: number;
            y: number;
            is_locked: boolean;
            snapped_by?: string;
            rotation_quarter?: number;
            is_back_face?: boolean;
          } = {
            room_id: roomId,
            piece_index: u.piece_index,
            x: u.x,
            y: u.y,
            is_locked: u.is_locked,
          };
          if (u.snapped_by) row.snapped_by = u.snapped_by;
          if (u.is_locked === true) {
            row.rotation_quarter = 0;
            row.is_back_face = false;
          } else {
            row.rotation_quarter = Math.max(
              0,
              Math.min(3, Math.round(Number(u.rotation_quarter ?? 0)))
            );
            row.is_back_face = u.is_back_face === true;
          }
          return row;
        })(),
      }));
      const { error } = await pieceStateSupabase
        .from("pieces")
        .upsert(payload, { onConflict: "room_id,piece_index" });
      if (error) {
        console.warn("[piece-state/upsert]", {
          roomId,
          message: error.message,
          usingServiceRole: Boolean(authSupabase),
          hint: authSupabase
            ? undefined
            : "Set SUPABASE_SERVICE_ROLE_KEY on the server so piece orientation can persist under RLS.",
        });
        for (const u of entries) pending.set(u.piece_index, u);
      } else if (LOG_PIECE_PERSIST) {
        const unlocked = payload.filter((r) => r.is_locked !== true);
        const orientLine = unlocked
          .slice(0, 16)
          .map((r) => {
            const q = Number(r.rotation_quarter ?? 0);
            return `#${r.piece_index} q=${q}(${q * 90}°) ${r.is_back_face ? "back" : "front"}`;
          })
          .join(" | ");
        console.info(
          `[piece-state/upsert:ok] room=${roomId} rows=${payload.length} serviceRole=${Boolean(authSupabase)} ${orientLine}`
        );
        console.info("[piece-state/upsert:ok] detail", {
          roomId,
          rows: payload.length,
          serviceRole: Boolean(authSupabase),
          orientationSample: unlocked.slice(0, 16).map((r) => ({
            i: r.piece_index,
            quarter: r.rotation_quarter,
            deg: Number(r.rotation_quarter ?? 0) * 90,
            face: r.is_back_face ? "back" : "front",
          })),
        });
      }
    } catch (error) {
      console.warn("[piece-state/upsert-exception]", error);
      for (const u of entries) pending.set(u.piece_index, u);
    } finally {
      roomPieceStateFlushing.delete(roomId);
      if (pending.size === 0) {
        roomPieceStatePending.delete(roomId);
        return;
      }
      scheduleRoomPieceStateFlush(roomId);
    }
  };
  const enqueueRoomPieceState = (
    roomId: number,
    updates: {
      pieceId: number;
      x: number;
      y: number;
      isLocked?: boolean;
      snappedBy?: string;
      rotationQuarter?: number;
      isBackFace?: boolean;
    }[],
    userId?: string
  ) => {
    if (!roomPieceStatePending.has(roomId)) roomPieceStatePending.set(roomId, new Map());
    const pending = roomPieceStatePending.get(roomId)!;
    if (!roomSolvedPieceIds.has(roomId)) roomSolvedPieceIds.set(roomId, new Set());
    const solved = roomSolvedPieceIds.get(roomId)!;
    if (!roomSolvedPieceOwner.has(roomId)) roomSolvedPieceOwner.set(roomId, new Map());
    const solvedOwner = roomSolvedPieceOwner.get(roomId)!;
    const orientRoom = roomMovePieceOrientation.get(roomId);
    for (const u of updates) {
      const snappedBy = String(u.snappedBy ?? "").trim();
      if (snappedBy && !solvedOwner.has(u.pieceId)) {
        solvedOwner.set(u.pieceId, snappedBy);
      }
      if (u.isLocked === true) {
        solved.add(u.pieceId);
        const owner = String(userId ?? "").trim();
        if (owner && !solvedOwner.has(u.pieceId)) {
          solvedOwner.set(u.pieceId, owner);
        }
      }
      const isSolved = solved.has(u.pieceId);
      const prevPending = pending.get(u.pieceId);
      const o = orientRoom?.get(u.pieceId);
      let rotationQuarterDb: number;
      let isBackFaceDb: boolean;
      if (isSolved) {
        rotationQuarterDb = 0;
        isBackFaceDb = false;
      } else {
        if (Number.isFinite(u.rotationQuarter)) {
          rotationQuarterDb = Math.max(0, Math.min(3, Math.round(Number(u.rotationQuarter))));
        } else if (prevPending && Number.isFinite(prevPending.rotation_quarter)) {
          rotationQuarterDb = prevPending.rotation_quarter;
        } else if (o && Number.isFinite(o.rotationQuarter)) {
          rotationQuarterDb = o.rotationQuarter;
        } else {
          rotationQuarterDb = 0;
        }
        if (typeof u.isBackFace === "boolean") {
          isBackFaceDb = u.isBackFace === true;
        } else if (prevPending && typeof prevPending.is_back_face === "boolean") {
          isBackFaceDb = prevPending.is_back_face === true;
        } else if (o) {
          isBackFaceDb = o.isBackFace === true;
        } else {
          isBackFaceDb = false;
        }
      }
      pending.set(u.pieceId, {
        piece_index: u.pieceId,
        x: u.x,
        y: u.y,
        // 한번 잠긴 조각은 다시 false로 내려가지 않게 단조 증가(monotonic) 처리
        is_locked: isSolved,
        snapped_by: solvedOwner.get(u.pieceId),
        rotation_quarter: rotationQuarterDb,
        is_back_face: isBackFaceDb,
      });
    }
    scheduleRoomPieceStateFlush(roomId);
  };
  const endSocketPlaySession = (socketId: string) => {
    const session = socketUserPlaySessions.get(socketId);
    if (!session) return;
    socketUserPlaySessions.delete(socketId);
    enqueueUserPlaySeconds(session.userId, (Date.now() - session.startedAt) / 1000);
  };
  const emitRoomPresence = (roomId: number) => {
    const room = roomStates.get(roomId);
    if (!room) return;
    const users = Array.from(
      new Set(
        [...room.users]
          .map((sid) => String(socketUserId.get(sid) ?? "").trim())
          .filter((u) => u !== "")
      )
    );
    const payload: PlayerPresencePayload = {
      roomId,
      playerCount: room.users.size,
      users,
    };
    io.to(roomId.toString()).emit(ROOM_EVENTS.PlayerPresence, payload);
  };

  io.on("connection", (socket) => {
    let currentRoomId: number | null = null;
    const MOVE_FLUSH_MS = 33;
    const CURSOR_FLUSH_MS = 50;
    let moveFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let cursorFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingMoveByPiece = new Map<
      number,
      {
        pieceId: number;
        x: number;
        y: number;
        isLocked?: boolean;
        snappedBy?: string;
        rotationQuarter?: number;
        isBackFace?: boolean;
      }
    >();
    let pendingMoveUserId = "guest";
    let pendingMoveSnapped = false;
    let pendingCursor: { username: string; x: number; y: number } | null = null;
    const flushPendingMoves = () => {
      moveFlushTimer = null;
      if (!currentRoomId || pendingMoveByPiece.size === 0) return;
      const roomId = currentRoomId;
      const rawUpdates = [...pendingMoveByPiece.values()];
      pendingMoveByPiece.clear();
      const orientMap = roomMovePieceOrientation.get(roomId);
      const updates = rawUpdates.map((u) => {
        const locked = u.isLocked === true;
        const o = orientMap?.get(u.pieceId);
        const base: {
          pieceId: number;
          x: number;
          y: number;
          isLocked?: boolean;
          snappedBy?: string;
          rotationQuarter?: number;
          isBackFace?: boolean;
        } = {
          pieceId: u.pieceId,
          x: u.x,
          y: u.y,
        };
        if (locked) {
          base.isLocked = true;
          base.rotationQuarter = 0;
          base.isBackFace = false;
        } else {
          let rq = 0;
          let bf = false;
          if (Number.isFinite(Number(u.rotationQuarter))) {
            rq = Math.max(0, Math.min(3, Math.round(Number(u.rotationQuarter))));
          } else if (o) {
            rq = o.rotationQuarter;
          }
          if (typeof u.isBackFace === "boolean") {
            bf = u.isBackFace === true;
          } else if (o) {
            bf = o.isBackFace;
          }
          base.rotationQuarter = rq;
          base.isBackFace = bf;
        }
        if (typeof u.snappedBy === "string" && u.snappedBy.trim() !== "") {
          base.snappedBy = u.snappedBy.trim();
        }
        return base;
      });
      socket.to(roomId.toString()).emit(ROOM_EVENTS.MoveBatch, {
        roomId,
        userId: pendingMoveUserId,
        snapped: pendingMoveSnapped,
        updates,
      });
      pendingMoveSnapped = false;
    };
    const scheduleMoveFlush = () => {
      if (moveFlushTimer != null) return;
      moveFlushTimer = setTimeout(flushPendingMoves, MOVE_FLUSH_MS);
    };
    const flushPendingCursor = () => {
      cursorFlushTimer = null;
      if (!currentRoomId || !pendingCursor) return;
      const roomId = currentRoomId;
      const payload = pendingCursor;
      pendingCursor = null;
      socket.to(roomId.toString()).emit(ROOM_EVENTS.CursorMove, {
        roomId,
        username: payload.username,
        x: payload.x,
        y: payload.y,
      });
    };
    const scheduleCursorFlush = () => {
      if (cursorFlushTimer != null) return;
      cursorFlushTimer = setTimeout(flushPendingCursor, CURSOR_FLUSH_MS);
    };
    const rememberOwned = (roomId: number, pieceId: number) => {
      if (!socketOwnedPieceIds.has(socket.id)) socketOwnedPieceIds.set(socket.id, new Map());
      const byRoom = socketOwnedPieceIds.get(socket.id)!;
      if (!byRoom.has(roomId)) byRoom.set(roomId, new Set());
      byRoom.get(roomId)!.add(pieceId);
    };
    const forgetOwned = (roomId: number, pieceId: number) => {
      const byRoom = socketOwnedPieceIds.get(socket.id);
      if (!byRoom) return;
      const ids = byRoom.get(roomId);
      if (!ids) return;
      ids.delete(pieceId);
      if (ids.size === 0) byRoom.delete(roomId);
      if (byRoom.size === 0) socketOwnedPieceIds.delete(socket.id);
    };
    const releaseOwnedLocks = (roomId: number, userIdFallback = "guest") => {
      const locks = roomPieceLocks.get(roomId);
      const byRoom = socketOwnedPieceIds.get(socket.id);
      const owned = byRoom?.get(roomId);
      if (!locks || !owned || owned.size === 0) return;
      const released: number[] = [];
      let userId = userIdFallback;
      for (const pieceId of [...owned]) {
        const owner = locks.get(pieceId);
        if (owner?.socketId === socket.id) {
          userId = owner.userId || userId;
          locks.delete(pieceId);
          released.push(pieceId);
        }
      }
      byRoom?.delete(roomId);
      if (byRoom && byRoom.size === 0) socketOwnedPieceIds.delete(socket.id);
      if (locks.size === 0) roomPieceLocks.delete(roomId);
      if (released.length > 0) {
        const payload: LockReleasedPayload = { roomId, userId, pieceIds: released };
        io.to(roomId.toString()).emit(ROOM_EVENTS.LockReleased, payload);
      }
    };
    const getRoomScoreMap = async (roomId: number): Promise<Map<string, number>> => {
      const cached = roomScoreCache.get(roomId);
      if (cached) return cached;
      const { data, error } = await supabase
        .from("scores")
        .select("username, score")
        .eq("room_id", roomId);
      if (error) {
        console.warn("[score-cache/load]", error.message);
        const empty = new Map<string, number>();
        roomScoreCache.set(roomId, empty);
        return empty;
      }
      const m = new Map<string, number>();
      for (const row of data ?? []) {
        const username = String((row as { username?: unknown }).username ?? "").trim();
        if (!username) continue;
        const scoreRaw = Number((row as { score?: unknown }).score ?? 0);
        m.set(username, Number.isFinite(scoreRaw) ? scoreRaw : 0);
      }
      roomScoreCache.set(roomId, m);
      return m;
    };
    const distributeCompletionRewards = async (roomId: number) => {
      const scoreMap = await getRoomScoreMap(roomId);
      const roomScores = [...scoreMap.entries()]
        .map(([username, score]) => ({ username, score: Number.isFinite(score) ? score : 0 }))
        .filter((x) => x.username && x.score > 0);
      if (roomScores.length === 0) return;
      const usernames = roomScores.map((x) => x.username);
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, username, completed_puzzles, placed_pieces, profile_public")
        .in("username", usernames);
      if (usersError) {
        console.warn("[completion-reward/load-users]", usersError.message);
        return;
      }
      const byName = new Map(
        (users ?? []).map((u) => [String((u as { username: unknown }).username), u as any])
      );
      await Promise.all(
        roomScores.map(async ({ username, score }) => {
          const u = byName.get(username);
          if (!u) return;
          const completed = Number(u.completed_puzzles ?? 0) + 1;
          const placed = Number(u.placed_pieces ?? 0) + score;
          const { error } = await supabase
            .from("users")
            .update({ completed_puzzles: completed, placed_pieces: placed })
            .eq("id", u.id);
          if (error) {
            console.warn("[completion-reward/update-user]", { username, message: error.message });
          }
        })
      );
    };

    socket.on(ROOM_EVENTS.JoinRoom, async (raw: number | JoinRoomPayload) => {
      const roomId =
        typeof raw === "number" ? raw : Number((raw as { roomId?: unknown })?.roomId);
      const joinedUserIdRaw =
        typeof raw === "number" ? NaN : Number((raw as { userId?: unknown })?.userId);
      const joinedUsernameRaw =
        typeof raw === "number" ? "" : String((raw as { username?: unknown })?.username ?? "").trim();
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      const joinedUserId =
        Number.isFinite(joinedUserIdRaw) && joinedUserIdRaw > 0
          ? Math.floor(joinedUserIdRaw)
          : null;
      if (joinedUsernameRaw !== "") {
        socketUserId.set(socket.id, joinedUsernameRaw);
      }
      pendingMoveByPiece.clear();
      pendingMoveSnapped = false;
      pendingCursor = null;
      if (moveFlushTimer != null) {
        clearTimeout(moveFlushTimer);
        moveFlushTimer = null;
      }
      if (cursorFlushTimer != null) {
        clearTimeout(cursorFlushTimer);
        cursorFlushTimer = null;
      }
      if (currentRoomId) {
        void flushRoomPieceState(currentRoomId);
        endSocketPlaySession(socket.id);
        releaseOwnedLocks(currentRoomId, socketUserId.get(socket.id) ?? "guest");
        socket.leave(currentRoomId.toString());
        const oldRoom = roomStates.get(currentRoomId);
        if (oldRoom) {
          oldRoom.users.delete(socket.id);
          emitRoomPresence(currentRoomId);
          // 마지막 유저가 나갔다면 타이머 일시정지
          if (oldRoom.users.size === 0 && !oldRoom.isCompleted && oldRoom.lastResumeTime) {
            oldRoom.accumulatedTime += (Date.now() - oldRoom.lastResumeTime) / 1000;
            oldRoom.lastResumeTime = null;
            
            supabase.from("rooms").update({ 
              total_play_time_seconds: Math.floor(oldRoom.accumulatedTime)
            }).eq("id", currentRoomId).then();
          }
        }
      }

      currentRoomId = roomId;
      socket.join(roomId.toString());

      if (!roomStates.has(roomId)) {
        const { data } = await supabase
          .from("rooms")
          .select("total_play_time_seconds, status")
          .eq("id", roomId)
          .single();
          
        roomStates.set(roomId, {
          accumulatedTime: data?.total_play_time_seconds || 0,
          lastResumeTime: null,
          users: new Set(),
          isCompleted: data?.status === "completed"
        });
      }

      const room = roomStates.get(roomId)!;
      
      // 방에 아무도 없었는데 내가 처음 들어온 거라면 타이머 시작
      if (room.users.size === 0 && !room.isCompleted) {
        room.lastResumeTime = Date.now();
      }
      
      room.users.add(socket.id);
      emitRoomPresence(roomId);
      if (joinedUserId != null) {
        socketUserPlaySessions.set(socket.id, {
          userId: joinedUserId,
          startedAt: Date.now(),
          roomId,
        });
      } else {
        socketUserPlaySessions.delete(socket.id);
      }
      
      // 접속한 유저에게만 현재 기준 시간 동기화
      const syncPayload: SyncTimePayload = {
        accumulatedTime: getCurrentPlayTime(room), 
        isRunning: !room.isCompleted 
      };
      socket.emit(ROOM_EVENTS.SyncTime, syncPayload);
    });

    socket.on(ROOM_EVENTS.LockRequest, (raw: LockRequestPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const userId = String(raw?.userId ?? "").trim() || "guest";
      const prevUserId = socketUserId.get(socket.id);
      socketUserId.set(socket.id, userId);
      if (prevUserId !== userId) emitRoomPresence(roomId);
      const input = Array.isArray(raw?.pieceIds) ? raw.pieceIds : [];
      const req = [...new Set(input.filter((x) => Number.isFinite(x) && x >= 0).map((x) => Math.floor(x)))];
      if (req.length === 0) return;
      if (!roomPieceLocks.has(roomId)) roomPieceLocks.set(roomId, new Map());
      const locks = roomPieceLocks.get(roomId)!;
      const granted: number[] = [];
      const denied: number[] = [];
      for (const pieceId of req) {
        const owner = locks.get(pieceId);
        if (!owner || owner.socketId === socket.id) {
          locks.set(pieceId, { socketId: socket.id, userId });
          rememberOwned(roomId, pieceId);
          granted.push(pieceId);
        } else {
          denied.push(pieceId);
        }
      }
      if (granted.length > 0) {
        const payload: LockAppliedPayload = { roomId, userId, pieceIds: granted };
        io.to(roomId.toString()).emit(ROOM_EVENTS.LockApplied, payload);
      }
      if (denied.length > 0) {
        const payload: LockDeniedPayload = { roomId, userId, pieceIds: denied };
        socket.emit(ROOM_EVENTS.LockDenied, payload);
      }
    });

    socket.on(ROOM_EVENTS.UnlockRequest, (raw: UnlockRequestPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const userId = String(raw?.userId ?? "").trim() || socketUserId.get(socket.id) || "guest";
      const input = Array.isArray(raw?.pieceIds) ? raw.pieceIds : [];
      const req = [...new Set(input.filter((x) => Number.isFinite(x) && x >= 0).map((x) => Math.floor(x)))];
      if (req.length === 0) return;
      const locks = roomPieceLocks.get(roomId);
      if (!locks) return;
      const released: number[] = [];
      for (const pieceId of req) {
        const owner = locks.get(pieceId);
        if (owner?.socketId === socket.id) {
          locks.delete(pieceId);
          forgetOwned(roomId, pieceId);
          released.push(pieceId);
        }
      }
      if (locks.size === 0) roomPieceLocks.delete(roomId);
      if (released.length > 0) {
        const payload: LockReleasedPayload = { roomId, userId, pieceIds: released };
        io.to(roomId.toString()).emit(ROOM_EVENTS.LockReleased, payload);
      }
    });

    socket.on(ROOM_EVENTS.MoveBatch, (raw: MoveBatchPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const userId = String(raw?.userId ?? "").trim() || socketUserId.get(socket.id) || "guest";
      if (userId) {
        const prevUserId = socketUserId.get(socket.id);
        socketUserId.set(socket.id, userId);
        if (prevUserId !== userId) emitRoomPresence(roomId);
      }
      const updatesRaw = Array.isArray(raw?.updates) ? raw.updates : [];
      if (updatesRaw.length === 0) return;
      const snapped = raw?.snapped === true;
      const parseWireBool = (v: unknown): boolean | undefined => {
        if (typeof v === "boolean") return v;
        if (v === "true" || v === 1 || v === "1") return true;
        if (v === "false" || v === 0 || v === "0" || v === "") return false;
        return undefined;
      };
      const updates = updatesRaw
        .slice(0, 120)
        .map((u) => ({
          pieceId: Math.floor(Number(u.pieceId)),
          x: Number(u.x),
          y: Number(u.y),
          isLocked: u.isLocked === true,
          snappedBy:
            typeof u.snappedBy === "string" && u.snappedBy.trim() !== ""
              ? u.snappedBy.trim()
              : undefined,
          rotationQuarter: Number.isFinite(Number((u as any).rotationQuarter))
            ? Math.max(0, Math.min(3, Math.round(Number((u as any).rotationQuarter))))
            : undefined,
          isBackFace: parseWireBool((u as any).isBackFace),
        }))
        .filter(
          (u) =>
            Number.isFinite(u.pieceId) &&
            u.pieceId >= 0 &&
            Number.isFinite(u.x) &&
            Number.isFinite(u.y)
        );
      if (updates.length === 0) return;
      pendingMoveUserId = userId;
      pendingMoveSnapped = pendingMoveSnapped || snapped;
      if (!roomMovePieceOrientation.has(roomId)) roomMovePieceOrientation.set(roomId, new Map());
      const orientMap = roomMovePieceOrientation.get(roomId)!;
      for (const u of updates) {
        const prev = pendingMoveByPiece.get(u.pieceId);
        pendingMoveByPiece.set(u.pieceId, {
          ...prev,
          ...u,
          rotationQuarter:
            u.rotationQuarter ?? prev?.rotationQuarter,
          isBackFace:
            typeof u.isBackFace === "boolean"
              ? u.isBackFace
              : prev?.isBackFace,
        });
        const merged = pendingMoveByPiece.get(u.pieceId)!;
        const prevO = orientMap.get(u.pieceId);
        if (merged.isLocked === true) {
          orientMap.set(u.pieceId, { rotationQuarter: 0, isBackFace: false });
        } else {
          let nextQ = prevO?.rotationQuarter;
          let nextB = prevO?.isBackFace ?? false;
          if (Number.isFinite(Number(merged.rotationQuarter))) {
            nextQ = Math.max(0, Math.min(3, Math.round(Number(merged.rotationQuarter))));
          }
          if (typeof merged.isBackFace === "boolean") {
            nextB = merged.isBackFace;
          }
          orientMap.set(u.pieceId, {
            rotationQuarter: nextQ ?? 0,
            isBackFace: nextB,
          });
        }
      }
      // DB queue must match merged orientMap + positions, not the pre-merge wire slice (fixes is_back_face / quarter drops).
      const persistUpdates = updates.map((u) => {
        const m = pendingMoveByPiece.get(u.pieceId)!;
        const o = orientMap.get(u.pieceId)!;
        return {
          pieceId: u.pieceId,
          x: m.x,
          y: m.y,
          isLocked: m.isLocked === true,
          snappedBy: m.snappedBy,
          rotationQuarter: o.rotationQuarter,
          isBackFace: o.isBackFace,
        };
      });
      if (LOG_PIECE_PERSIST) {
        const orientLine = persistUpdates
          .map((p) => {
            const q = Number(p.rotationQuarter ?? 0);
            return `#${p.pieceId} q=${q}(${q * 90}°) ${p.isBackFace ? "back" : "front"}`;
          })
          .join(" | ");
        console.info(
          `[MoveBatch→enqueueRoomPieceState] room=${roomId} user=${userId} count=${persistUpdates.length} ${orientLine}`
        );
        console.info("[MoveBatch→enqueueRoomPieceState] detail", {
          roomId,
          userId,
          count: persistUpdates.length,
          orientation: persistUpdates.map((p) => ({
            id: p.pieceId,
            quarter: p.rotationQuarter,
            deg: Number(p.rotationQuarter ?? 0) * 90,
            face: p.isBackFace ? "back" : "front",
          })),
        });
      }
      enqueueRoomPieceState(roomId, persistUpdates, userId);
      scheduleMoveFlush();
    });

    socket.on(ROOM_EVENTS.CursorMove, (raw: CursorMovePayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const username = String(raw?.username ?? "").trim();
      const x = Number(raw?.x);
      const y = Number(raw?.y);
      if (!username || !Number.isFinite(x) || !Number.isFinite(y)) return;
      pendingCursor = { username, x, y };
      scheduleCursorFlush();
    });

    socket.on(ROOM_EVENTS.ScoreDelta, async (raw: ScoreDeltaPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const username = String(raw?.username ?? "").trim();
      if (!username) return;
      const delta = Math.max(0, Math.floor(Number(raw?.delta ?? 0)));
      if (!Number.isFinite(delta) || delta <= 0) return;
      const scoreMap = await getRoomScoreMap(roomId);
      const nextScore = (scoreMap.get(username) ?? 0) + delta;
      scoreMap.set(username, nextScore);
      const payload: ScoreSyncPayload = { roomId, username, score: nextScore };
      io.to(roomId.toString()).emit(ROOM_EVENTS.ScoreSync, payload);
      const { error } = await supabase
        .from("scores")
        .upsert({ room_id: roomId, username, score: nextScore }, { onConflict: "room_id,username" });
      if (error) {
        console.warn("[score-delta/upsert]", error.message);
      }
    });

    socket.on(ROOM_EVENTS.PuzzleCompleted, async (roomId: number) => {
      const room = roomStates.get(roomId);
      if (room && !room.isCompleted) {
        room.isCompleted = true;
        if (room.lastResumeTime) {
          room.accumulatedTime += (Date.now() - room.lastResumeTime) / 1000;
          room.lastResumeTime = null;
        }
        
        const finalTime = Math.floor(room.accumulatedTime);

        const completedAtIso = new Date().toISOString();
        const { error: completeUpdateError } = await supabase
          .from("rooms")
          .update({
            total_play_time_seconds: finalTime,
            status: "completed",
            completed_at: completedAtIso,
          } as any)
          .eq("id", roomId);
        if (completeUpdateError) {
          // Backward compatibility: if DB column is not migrated yet, retry without completed_at.
          const retry = await supabase
            .from("rooms")
            .update({
              total_play_time_seconds: finalTime,
              status: "completed",
            })
            .eq("id", roomId);
          if (retry.error) {
            console.warn("[puzzle-complete/update-room]", retry.error.message);
          }
        }
        await distributeCompletionRewards(roomId);
          
        // 완성 시 모든 유저에게 정지된 최종 시간 동기화
        const completedPayload: SyncTimePayload = {
          accumulatedTime: finalTime, 
          isRunning: false 
        };
        io.to(roomId.toString()).emit(ROOM_EVENTS.SyncTime, completedPayload);
      }
    });

    socket.on("disconnect", () => {
      pendingMoveByPiece.clear();
      pendingCursor = null;
      if (moveFlushTimer != null) clearTimeout(moveFlushTimer);
      if (cursorFlushTimer != null) clearTimeout(cursorFlushTimer);
      endSocketPlaySession(socket.id);
      if (currentRoomId && roomStates.has(currentRoomId)) {
        void flushRoomPieceState(currentRoomId);
        releaseOwnedLocks(currentRoomId, socketUserId.get(socket.id) ?? "guest");
        const room = roomStates.get(currentRoomId)!;
        room.users.delete(socket.id);
        emitRoomPresence(currentRoomId);
        
        // 마지막 유저가 나갔다면 타이머 일시정지 및 DB 저장
        if (room.users.size === 0 && !room.isCompleted) {
          if (room.lastResumeTime) {
            room.accumulatedTime += (Date.now() - room.lastResumeTime) / 1000;
            room.lastResumeTime = null;
          }
          
          supabase
            .from("rooms")
            .update({ 
              total_play_time_seconds: Math.floor(room.accumulatedTime)
            })
            .eq("id", currentRoomId)
            .then(({ error }) => {
              if (error) console.error(`DB Update Error on disconnect:`, error);
            });
        }
      }
      socketOwnedPieceIds.delete(socket.id);
      socketUserId.delete(socket.id);
      socketUserPlaySessions.delete(socket.id);
    });
  });

  // 30초 주기의 느린 타이머 루프 (DB 백업용, 네트워크 통신 없음)
  setInterval(() => {
    roomStates.forEach((room, roomId) => {
      // 진행 중인 방만 30초마다 DB에 안전하게 백업
      if (room.users.size > 0 && !room.isCompleted) {
        const currentPlayTime = Math.floor(getCurrentPlayTime(room));
        supabase
          .from("rooms")
          .update({ 
            total_play_time_seconds: currentPlayTime
          })
          .eq("id", roomId)
          .then(({ error }) => {
            if (error) console.error(`DB Backup Error for room ${roomId}:`, error);
          });
      }
    });
    void flushUserPlaySeconds();
  }, 30000);

  // ==========================================
  // Vite Middleware (Frontend Serving)
  // ==========================================

  const webDistIndex = path.join(__dirname, "apps/web/dist/index.html");
  const useBuiltWeb =
    process.env.NODE_ENV === "production" && existsSync(webDistIndex);

  if (!useBuiltWeb) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[web] NODE_ENV=production but apps/web/dist/index.html is missing — falling back to Vite dev middleware. Run npm run build:web before serving static production assets."
      );
    }
    const vite = await createViteServer({
      configFile: path.join(__dirname, "apps/web/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "apps/web/dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT as number, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

