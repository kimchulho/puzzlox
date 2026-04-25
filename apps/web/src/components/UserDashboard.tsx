import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Grid,
  Image as ImageIcon,
  Loader2,
  Lock,
  Share2,
  Trophy,
  Users,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { apiUrl } from "../lib/apiBase";
import {
  ensureRoomPasswordVerified,
  profileParticipatedRowHasPassword,
  roomRowHasPasswordLobby,
} from "../lib/roomAccess";
import { tossIntossProfileUrl } from "../lib/roomCode";
import {
  normalizePuzzleDifficulty,
  puzzleDifficultyLabel,
  type PuzzleDifficulty,
} from "../lib/puzzleDifficulty";
import type { JoinRoomMeta } from "@contracts/roomJoin";

type DashboardUser = {
  id?: number;
  username: string;
  nickname?: string | null;
  role?: string;
  completed_puzzles?: number;
  placed_pieces?: number;
  profile_public?: boolean;
};

type RoomRow = {
  roomId: number;
  roomCode: string;
  imageUrl: string | null;
  difficulty: string | null;
  status: string | null;
  pieceCount: number;
  totalPieces?: number;
  lockedPieces?: number;
  progressPercent?: number;
  isCompleted?: boolean;
  completedAt?: string | null;
  creatorName?: string | null;
  lastVisitedAt?: string | null;
  scoreInRoom?: number;
  iAmCreator?: boolean;
  imageHiddenReason?: string | null;
  /** 공개 프로필 API: 비밀번호 방 여부(테스트 필터용). */
  hasPassword?: boolean;
};

type UploadRow = {
  roomId: number;
  roomCode: string;
  imageUrl: string | null;
  difficulty: string | null;
  status: string | null;
  pieceCount: number;
  createdAt?: string | null;
  completedAt?: string | null;
};

type ParticipatedRoomFilter = "all" | "only_created" | "hide_created";

const DASHBOARD_PARTICIPATED_PAGE_SIZE = 10;

function participatedFilterLabel(v: ParticipatedRoomFilter, isKo: boolean): string {
  switch (v) {
    case "all":
      return isKo ? "전체 보기" : "Show all";
    case "only_created":
      return isKo ? "내가 만든 방만" : "Only rooms I created";
    case "hide_created":
      return isKo ? "내가 만든 방 제외" : "Hide rooms I created";
    default:
      return "";
  }
}

function clearPuzzleWebSession() {
  try {
    localStorage.removeItem("puzzle_access_token");
    localStorage.removeItem("puzzle_user");
  } catch {
    /* noop */
  }
}

export default function UserDashboard({
  mode,
  publicUsername,
  onBack,
  onJoinRoom,
  locale,
  user,
  setUser,
  /** 토큰이 더 이상 유효하지 않을 때(401). 로그인으로 보내기 위한 콜백(선택). */
  onSessionInvalid,
  visualVariant = "web",
  /** 앱인토스: 상단 안전 영역(px). 래퍼 `paddingTop` 대신 헤더에만 적용해 이중 여백을 줄입니다. */
  safeAreaTop = 0,
}: {
  mode: "self" | "public";
  publicUsername?: string;
  onBack: () => void;
  onJoinRoom: (
    roomId: number,
    imageUrl: string,
    pieceCount: number,
    difficulty: PuzzleDifficulty,
    meta?: JoinRoomMeta
  ) => void;
  locale: "ko" | "en";
  user?: DashboardUser | null;
  setUser?: (u: DashboardUser | null) => void;
  onSessionInvalid?: () => void;
  /** 앱인토스: 로비와 맞춘 밝은 톤 */
  visualVariant?: "web" | "toss";
  safeAreaTop?: number;
}) {
  const isKo = locale === "ko";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashUser, setDashUser] = useState<DashboardUser | null>(null);
  const [participated, setParticipated] = useState<RoomRow[]>([]);
  const [myUploads, setMyUploads] = useState<UploadRow[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [copyOk, setCopyOk] = useState(false);
  const [profileQrDataUrl, setProfileQrDataUrl] = useState<string | null>(null);
  /** 참여한 퍼즐방: 전체 / 내가 만든 방만 / 내가 만든 방 제외 */
  const [participatedRoomFilter, setParticipatedRoomFilter] =
    useState<ParticipatedRoomFilter>("all");
  const [participatedFilterOpen, setParticipatedFilterOpen] = useState(false);
  const participatedFilterRef = useRef<HTMLDivElement>(null);
  const [participatedListPage, setParticipatedListPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "self") {
        const token = localStorage.getItem("puzzle_access_token");
        if (!token) {
          setError(isKo ? "로그인이 필요합니다." : "Please sign in.");
          setLoading(false);
          return;
        }
        const res = await fetch(apiUrl("/api/user/dashboard"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = (await res.json().catch(() => ({}))) as {
          message?: string;
          user?: DashboardUser;
          participatedRooms?: RoomRow[];
          myUploads?: UploadRow[];
        };
        if (!res.ok) {
          if (res.status === 401) {
            clearPuzzleWebSession();
            setUser?.(null);
            onSessionInvalid?.();
            if (!onSessionInvalid) {
              setError(
                isKo
                  ? "로그인이 만료되었습니다. 뒤로 가서 다시 로그인해 주세요."
                  : "Your session has expired. Go back and sign in again."
              );
            }
            setLoading(false);
            return;
          }
          setError(j?.message || `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        setDashUser(j.user ?? null);
        setParticipated(Array.isArray(j.participatedRooms) ? j.participatedRooms : []);
        setMyUploads(Array.isArray(j.myUploads) ? j.myUploads : []);
      } else {
        const u = (publicUsername ?? "").trim().toLowerCase();
        if (!u) {
          setError(isKo ? "사용자를 찾을 수 없습니다." : "User not found.");
          setLoading(false);
          return;
        }
        const res = await fetch(apiUrl(`/api/profile/${encodeURIComponent(u)}`), {
          cache: "no-store",
        });
        const j = (await res.json().catch(() => ({}))) as {
          message?: string;
          user?: {
            username: string;
            nickname?: string | null;
            completed_puzzles?: number;
            placed_pieces?: number;
          };
          participatedRooms?: RoomRow[];
        };
        if (!res.ok) {
          setError(j?.message || (isKo ? "비공개이거나 없는 프로필입니다." : "Profile is private or not found."));
          setLoading(false);
          return;
        }
        setDashUser(
          j.user
            ? {
                username: j.user.username,
                nickname: (j.user as { nickname?: string | null }).nickname ?? null,
                completed_puzzles: j.user.completed_puzzles,
                placed_pieces: j.user.placed_pieces,
              }
            : null
        );
        const participatedFromApi = Array.isArray(j.participatedRooms) ? j.participatedRooms : [];
        const apiHasPasswordMeta = participatedFromApi.some(
          (r) =>
            (r as Record<string, unknown>).hasPassword != null ||
            (r as Record<string, unknown>).has_password != null
        );
        let participatedNext = participatedFromApi;
        /**
         * Remote profile API(구버전)가 hasPassword/has_password 를 내려주지 않는 경우:
         * 클라이언트에서 rooms.has_password 로 보강해 공개 프로필 비밀번호 필터가 동작하도록 한다.
         */
        if (!apiHasPasswordMeta && participatedFromApi.length > 0) {
          const roomIds = [...new Set(participatedFromApi.map((r) => Number(r.roomId)).filter((id) => Number.isFinite(id) && id > 0))];
          if (roomIds.length > 0) {
            const { data: roomMeta, error: roomMetaErr } = await supabase
              .from("rooms")
              .select("id, has_password")
              .in("id", roomIds);
            if (!roomMetaErr && Array.isArray(roomMeta)) {
              const hasPwById = new Map<number, boolean>();
              for (const row of roomMeta) {
                const rid = Number((row as { id?: unknown }).id);
                if (!Number.isFinite(rid) || rid <= 0) continue;
                hasPwById.set(
                  rid,
                  roomRowHasPasswordLobby({
                    has_password: (row as { has_password?: unknown }).has_password,
                  })
                );
              }
              participatedNext = participatedFromApi.map((r) => ({
                ...r,
                hasPassword: hasPwById.get(Number(r.roomId)) === true,
              }));
            }
          }
        }
        setParticipated(participatedNext);
        setMyUploads([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, publicUsername, isKo, setUser, onSessionInvalid]);

  useEffect(() => {
    const next = (dashUser?.nickname ?? dashUser?.username ?? "").toString();
    setNicknameDraft(next);
  }, [dashUser?.nickname, dashUser?.username]);

  useEffect(() => {
    void load();
  }, [load]);

  const toss = visualVariant === "toss";

  useEffect(() => {
    if (!toss || mode !== "self" || dashUser?.profile_public === false || !dashUser?.username) {
      setProfileQrDataUrl(null);
      return;
    }
    const url = tossIntossProfileUrl(dashUser.username);
    let cancelled = false;
    void import("qrcode")
      .then((m) => {
        const QR = m.default ?? m;
        return QR.toDataURL(url, {
          margin: 1,
          width: 200,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
      })
      .then((dataUrl) => {
        if (!cancelled) setProfileQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setProfileQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [toss, mode, dashUser?.username, dashUser?.profile_public]);

  useEffect(() => {
    if (!participatedFilterOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = participatedFilterRef.current;
      if (el && !el.contains(e.target as Node)) setParticipatedFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setParticipatedFilterOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [participatedFilterOpen]);

  const toggleProfilePublic = async (next: boolean) => {
    const token = localStorage.getItem("puzzle_access_token");
    if (!token) return;
    setProfileSaving(true);
    try {
      const res = await fetch(apiUrl("/api/user/profile"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ profilePublic: next }),
      });
      const j = (await res.json().catch(() => ({}))) as { user?: DashboardUser; message?: string };
      if (res.status === 401) {
        clearPuzzleWebSession();
        setUser?.(null);
        onSessionInvalid?.();
        if (!onSessionInvalid) {
          setError(
            isKo
              ? "로그인이 만료되었습니다. 뒤로 가서 다시 로그인해 주세요."
              : "Your session has expired. Go back and sign in again."
          );
        }
        return;
      }
      if (!res.ok || !j.user) {
        setError(j?.message || `HTTP ${res.status}`);
        return;
      }
      setDashUser(j.user);
      if (setUser && user) {
        const merged = { ...user, ...j.user };
        localStorage.setItem("puzzle_user", JSON.stringify(merged));
        setUser(merged);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const saveNickname = async () => {
    const token = localStorage.getItem("puzzle_access_token");
    if (!token) return;
    const nextNickname = nicknameDraft.trim();
    if (!nextNickname) {
      setError(isKo ? "닉네임은 비워둘 수 없습니다." : "Nickname cannot be empty.");
      return;
    }
    setNicknameSaving(true);
    try {
      const res = await fetch(apiUrl("/api/user/profile"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nickname: nextNickname }),
      });
      const j = (await res.json().catch(() => ({}))) as { user?: DashboardUser; message?: string };
      if (res.status === 401) {
        clearPuzzleWebSession();
        setUser?.(null);
        onSessionInvalid?.();
        if (!onSessionInvalid) {
          setError(
            isKo
              ? "로그인이 만료되었습니다. 뒤로 가서 다시 로그인해 주세요."
              : "Your session has expired. Go back and sign in again."
          );
        }
        return;
      }
      if (!res.ok || !j.user) {
        setError(j?.message || `HTTP ${res.status}`);
        return;
      }
      setDashUser(j.user);
      if (setUser && user) {
        const merged = { ...user, ...j.user };
        localStorage.setItem("puzzle_user", JSON.stringify(merged));
        setUser(merged);
      }
    } finally {
      setNicknameSaving(false);
    }
  };

  const enterRoom = async (
    roomId: number,
    roomHint?: {
      imageUrl?: string | null;
      pieceCount?: number;
      difficulty?: string | null;
      hasPassword?: boolean;
      creatorName?: string | null;
      iAmCreator?: boolean;
    }
  ) => {
    // Dashboard already has room metadata. Prefer it over direct Supabase reads,
    // because private rooms can be blocked by RLS on client-side PostgREST.
    const imageUrl = (roomHint?.imageUrl ?? "").toString().trim();
    const pieceCount = Number(roomHint?.pieceCount ?? 0);
    if (!imageUrl || !Number.isFinite(pieceCount) || pieceCount <= 0) {
      setError(isKo ? "방 정보를 불러올 수 없습니다." : "Could not load room.");
      return;
    }
    const hasPassword = roomHint?.hasPassword === true;
    const ok = await ensureRoomPasswordVerified(roomId, hasPassword, isKo, {
      room: {
        id: roomId,
        created_by: roomHint?.iAmCreator ? user?.id : undefined,
        creator_name: roomHint?.creatorName ?? null,
      },
      user: user ? { id: user.id, username: user.username } : null,
    });
    if (!ok) return;
    onJoinRoom(
      roomId,
      imageUrl,
      pieceCount,
      normalizePuzzleDifficulty(roomHint?.difficulty ?? "medium")
    );
  };

  const copyProfileLink = () => {
    const un = dashUser?.username ?? publicUsername ?? "";
    if (!un) return;
    const url = toss ? tossIntossProfileUrl(un) : `${window.location.origin}/u/${encodeURIComponent(un)}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    });
  };

  const profileShareUrl =
    dashUser?.username != null && String(dashUser.username).trim() !== ""
      ? toss
        ? tossIntossProfileUrl(dashUser.username)
        : `${window.location.origin}/u/${encodeURIComponent(dashUser.username)}`
      : "";

  const title =
    mode === "self"
      ? isKo
        ? "내 대시보드"
        : "My dashboard"
      : isKo
        ? `${(dashUser?.nickname ?? dashUser?.username ?? publicUsername ?? "").toString()}님의 프로필`
        : `${(dashUser?.nickname ?? dashUser?.username ?? publicUsername ?? "").toString()}'s profile`;

  const participatedFiltered = participated.filter((r) => {
    if (mode === "public") {
      const hp = profileParticipatedRowHasPassword(r);
      return !hp;
    }
    if (participatedRoomFilter === "hide_created") return !r.iAmCreator;
    if (participatedRoomFilter === "only_created") return r.iAmCreator === true;
    return true;
  });
  const hasMyCreatedInParticipated = participated.some((r) => r.iAmCreator);

  useEffect(() => {
    setParticipatedListPage(1);
  }, [participatedRoomFilter, mode]);

  const participatedTotalPages = Math.max(
    1,
    Math.ceil(participatedFiltered.length / DASHBOARD_PARTICIPATED_PAGE_SIZE),
  );

  useEffect(() => {
    setParticipatedListPage((p) => Math.min(p, participatedTotalPages));
  }, [participatedTotalPages]);

  const participatedPageClamped = Math.min(
    Math.max(1, participatedListPage),
    participatedTotalPages,
  );
  const participatedOffset = (participatedPageClamped - 1) * DASHBOARD_PARTICIPATED_PAGE_SIZE;
  const participatedPageItems = participatedFiltered.slice(
    participatedOffset,
    participatedOffset + DASHBOARD_PARTICIPATED_PAGE_SIZE,
  );

  const skin = toss
    ? {
        page: "min-h-screen bg-[#F4F8FF] text-slate-900",
        header: "sticky top-0 z-10 border-b border-[#D9E8FF] bg-white/95 backdrop-blur-sm",
        backBtn:
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#D9E8FF] bg-white text-[#2F6FE4] hover:bg-[#EAF2FF]",
        title: "min-w-0 flex-1 truncate text-lg font-bold text-slate-900",
        loadingWrap: "flex justify-center py-16 text-[#2F6FE4]",
        errorBox: "rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center text-red-800",
        errorHint: "mt-3 text-sm text-slate-600",
        statCard: "rounded-2xl border border-[#D9E8FF] bg-white p-4 shadow-sm",
        statLabel: "mb-1 flex items-center gap-2 text-slate-600",
        statNum: "text-3xl font-bold text-slate-900",
        profileSection: "rounded-2xl border border-[#D9E8FF] bg-white p-4 shadow-sm",
        profileTitle: "font-semibold text-slate-900",
        profileDesc: "mt-1 text-sm text-slate-600",
        checkbox: "h-5 w-5 rounded border-[#CBD5E1] bg-white text-[#3182F6] focus:ring-[#3182F6]",
        checkboxLabel: "text-sm text-slate-700",
        profileDivTop: "mt-4 flex flex-wrap gap-2 border-t border-[#D9E8FF] pt-4",
        btnOutline:
          "inline-flex items-center gap-2 rounded-xl border border-[#D9E8FF] bg-white px-3 py-2 text-sm text-slate-800 hover:bg-[#F4F8FF]",
        urlHint: "flex items-center gap-1 text-xs text-slate-500",
        h2: "mb-3 flex items-center gap-2 text-base font-bold text-slate-900",
        sectionP: "mb-3 text-sm text-slate-600",
        listLi: "flex gap-3 rounded-2xl border border-[#D9E8FF] bg-white p-3 shadow-sm",
        thumb: "relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-[#EAF2FF]",
        thumbEmpty: "flex h-full items-center justify-center text-slate-400",
        monoCode: "font-mono text-sm text-[#2F6FE4]",
        meta: "text-xs text-slate-600",
        dateSmall: "mt-1 text-[11px] text-slate-500",
        btnSmall: "mt-2 rounded-lg bg-[#3182F6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2563EB]",
        h2Row: "flex min-w-0 flex-1 items-center gap-2 text-base font-bold text-slate-900",
        filterMenuRoot: "relative shrink-0",
        filterMenuTrigger:
          "flex w-[min(100%,10.5rem)] min-w-[8.5rem] items-center justify-between gap-1 rounded-lg border border-[#D9E8FF] bg-white px-2.5 py-2 text-left text-sm text-slate-900 shadow-sm transition-colors hover:bg-[#F4F8FF] focus:border-[#3182F6] focus:outline-none focus:ring-1 focus:ring-[#3182F6]",
        filterMenuPanel:
          "absolute right-0 top-[calc(100%+4px)] z-40 min-w-full overflow-hidden rounded-lg border border-[#D9E8FF] bg-white py-1 shadow-lg",
        filterMenuOption:
          "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-slate-800 transition-colors hover:bg-[#EAF2FF]",
        filterMenuOptionActive: "bg-[#EAF2FF] font-medium text-[#2F6FE4]",
        filterMenuOptionDisabled: "cursor-not-allowed text-slate-400 hover:bg-transparent",
        paginationBar:
          "mt-4 flex flex-col items-center gap-3 border-t border-[#D9E8FF] pt-4",
        paginationInfo: "text-center text-xs text-slate-600",
        paginationNav: "flex items-center justify-center gap-2",
        paginationBtn:
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#D9E8FF] bg-white text-sm text-slate-800 transition-colors hover:bg-[#EAF2FF] disabled:pointer-events-none disabled:opacity-40",
        empty: "text-sm text-slate-500",
        joinedLi: "flex gap-3 rounded-2xl border border-[#D9E8FF] bg-white p-3 shadow-sm",
        joinedGridLi: "flex min-w-0 flex-col gap-2 rounded-2xl border border-[#D9E8FF] bg-white p-2.5 shadow-sm sm:p-3",
        joinedThumb: "relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-[#EAF2FF]",
        joinedGridThumb: "relative h-20 w-full shrink-0 overflow-hidden rounded-lg bg-[#EAF2FF]",
        privateText:
          "flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] text-slate-500",
        roomCode: "font-mono text-sm text-[#2F6FE4]",
        badgeMine: "rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800",
        metaLine: "text-xs text-slate-600",
        progressMeta: "flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500",
        progressMetaPct: "text-slate-400",
        doneBadge:
          "inline-flex shrink-0 items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800",
        progressTrack: "h-1.5 overflow-hidden rounded-full bg-[#EAF2FF]",
        progressFillDone: "h-full rounded-full bg-emerald-500 transition-[width]",
        progressFill: "h-full rounded-full bg-[#2F6FE4]/90 transition-[width]",
        btnEnter: "mt-2 rounded-lg bg-[#3182F6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2563EB]",
      }
    : {
        page: "min-h-screen bg-slate-950 text-slate-100",
        header: "sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm",
        backBtn:
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800",
        title: "min-w-0 flex-1 truncate text-lg font-bold text-white",
        loadingWrap: "flex justify-center py-16 text-slate-400",
        errorBox: "rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-6 text-center text-rose-200",
        errorHint: "mt-3 text-sm text-slate-400",
        statCard: "rounded-2xl border border-slate-800 bg-slate-900/80 p-4",
        statLabel: "mb-1 flex items-center gap-2 text-slate-400",
        statNum: "text-3xl font-bold text-white",
        profileSection: "rounded-2xl border border-slate-800 bg-slate-900/60 p-4",
        profileTitle: "font-semibold text-white",
        profileDesc: "mt-1 text-sm text-slate-400",
        checkbox: "h-5 w-5 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500",
        checkboxLabel: "text-sm text-slate-300",
        profileDivTop: "mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4",
        btnOutline: "inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700",
        urlHint: "flex items-center gap-1 text-xs text-slate-500",
        h2: "mb-3 flex items-center gap-2 text-base font-bold text-white",
        sectionP: "mb-3 text-sm text-slate-400",
        listLi: "flex gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3",
        thumb: "relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-800",
        thumbEmpty: "flex h-full items-center justify-center text-slate-500",
        monoCode: "font-mono text-sm text-sky-300",
        meta: "text-xs text-slate-400",
        dateSmall: "mt-1 text-[11px] text-slate-500",
        btnSmall: "mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700",
        h2Row: "flex min-w-0 flex-1 items-center gap-2 text-base font-bold text-white",
        filterMenuRoot: "relative shrink-0",
        filterMenuTrigger:
          "flex w-[min(100%,10.5rem)] min-w-[8.5rem] items-center justify-between gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-left text-sm text-slate-100 shadow-sm transition-colors hover:bg-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500",
        filterMenuPanel:
          "absolute right-0 top-[calc(100%+4px)] z-40 min-w-full overflow-hidden rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-lg",
        filterMenuOption:
          "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-slate-200 transition-colors hover:bg-slate-800",
        filterMenuOptionActive: "bg-slate-800 font-medium text-indigo-300",
        filterMenuOptionDisabled: "cursor-not-allowed text-slate-500 hover:bg-transparent",
        paginationBar:
          "mt-4 flex flex-col items-center gap-3 border-t border-slate-800 pt-4",
        paginationInfo: "text-center text-xs text-slate-400",
        paginationNav: "flex items-center justify-center gap-2",
        paginationBtn:
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-900 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-40",
        empty: "text-sm text-slate-500",
        joinedLi: "flex gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3",
        joinedGridLi: "flex min-w-0 flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-2.5 sm:p-3",
        joinedThumb: "relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-800",
        joinedGridThumb: "relative h-20 w-full shrink-0 overflow-hidden rounded-lg bg-slate-800",
        privateText:
          "flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] text-slate-500",
        roomCode: "font-mono text-sm text-indigo-300",
        badgeMine: "rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300",
        metaLine: "text-xs text-slate-400",
        progressMeta: "flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400",
        progressMetaPct: "text-slate-500",
        doneBadge:
          "inline-flex shrink-0 items-center gap-0.5 rounded-md bg-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-300",
        progressTrack: "h-1.5 overflow-hidden rounded-full bg-slate-800",
        progressFillDone: "h-full rounded-full bg-emerald-500 transition-[width]",
        progressFill: "h-full rounded-full bg-indigo-500/80 transition-[width]",
        btnEnter: "mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700",
      };

  const headerStyle: CSSProperties | undefined =
    toss && safeAreaTop > 0 ? { paddingTop: safeAreaTop } : undefined;

  return (
    <div className={skin.page}>
      <header className={skin.header} style={headerStyle}>
        <div
          className={`mx-auto flex max-w-3xl items-center px-4 ${toss ? "gap-2 py-2" : "gap-3 py-3"}`}
        >
          {!toss || mode === "public" ? (
            <button
              type="button"
              onClick={onBack}
              className={skin.backBtn}
              aria-label={isKo ? "뒤로" : "Back"}
            >
              <ArrowLeft size={20} />
            </button>
          ) : null}
          <h1 className={skin.title}>{title}</h1>
        </div>
      </header>

      <main className={`mx-auto max-w-3xl space-y-8 px-4 ${toss ? "pb-4 pt-3" : "py-6"}`}>
        {loading ? (
          <div className={skin.loadingWrap}>
            <Loader2 className="h-10 w-10 animate-spin" />
          </div>
        ) : error ? (
          <div className={skin.errorBox}>
            {error}
            {mode === "self" && error.includes("로그인") ? (
              <p className={skin.errorHint}>{isKo ? "로비에서 로그인해 주세요." : "Sign in from the lobby."}</p>
            ) : null}
          </div>
        ) : (
          <>
            <section className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4">
              <div className={`${skin.statCard} min-w-0`}>
                <div className={skin.statLabel}>
                  <Trophy size={18} className="shrink-0 text-amber-400" />
                  <span className="min-w-0 text-[11px] leading-tight sm:text-sm">
                    {isKo ? "완성한 퍼즐" : "Completed puzzles"}
                  </span>
                </div>
                <p className={skin.statNum}>{dashUser?.completed_puzzles ?? 0}</p>
              </div>
              <div className={`${skin.statCard} min-w-0`}>
                <div className={skin.statLabel}>
                  <Grid size={18} className="shrink-0 text-indigo-400" />
                  <span className="min-w-0 text-[11px] leading-tight sm:text-sm">
                    {isKo ? "맞춘 조각(누적)" : "Pieces placed (total)"}
                  </span>
                </div>
                <p className={skin.statNum}>{dashUser?.placed_pieces ?? 0}</p>
              </div>
            </section>

            {mode === "self" ? (
              <section className={skin.profileSection}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Users className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
                    <div>
                      <p className={skin.profileTitle}>{isKo ? "프로필 공개" : "Public profile"}</p>
                      <p className={skin.profileDesc}>
                        {isKo
                          ? toss
                            ? "기본은 공개입니다. 체크를 해제하면 비공개로 전환됩니다. 공개 시 intoss 프로필 링크로 통계·참여 방이 열리며, 직접 업로드한 퍼즐 이미지는 항상 비공개입니다."
                            : "기본은 공개입니다. 체크를 해제하면 비공개로 전환됩니다. 공개 시 /u/아이디 에 통계·참여 방이 보이며, 직접 업로드한 퍼즐 이미지는 항상 비공개입니다."
                          : toss
                            ? "Public by default; uncheck to make your profile private. When public, others can open your stats via the intoss profile link; images you uploaded as room photos stay private."
                            : "Public by default; uncheck to make your profile private. When public, stats and joined rooms appear at /u/username; images you uploaded as room photos stay private."}
                      </p>
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 self-start sm:self-center">
                    <input
                      type="checkbox"
                      className={skin.checkbox}
                      checked={dashUser?.profile_public !== false}
                      disabled={profileSaving}
                      onChange={(e) => void toggleProfilePublic(e.target.checked)}
                    />
                    <span className={skin.checkboxLabel}>
                      {isKo ? "프로필 공개" : "Profile public"}
                    </span>
                  </label>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className={`text-xs ${toss ? "text-slate-600" : "text-slate-400"}`}>
                    {isKo ? "닉네임" : "Nickname"}
                  </label>
                  <input
                    type="text"
                    maxLength={32}
                    value={nicknameDraft}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    className={
                      toss
                        ? "w-full rounded-lg border border-[#D9E8FF] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#3182F6] focus:outline-none"
                        : "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    }
                    placeholder={isKo ? "닉네임 입력" : "Enter nickname"}
                  />
                  <button
                    type="button"
                    disabled={nicknameSaving || nicknameDraft.trim() === ""}
                    onClick={() => void saveNickname()}
                    className={
                      toss
                        ? "rounded-lg bg-[#3182F6] px-3 py-2 text-xs font-medium text-white hover:bg-[#2563EB] disabled:opacity-50"
                        : "rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                    }
                  >
                    {nicknameSaving ? (isKo ? "저장 중..." : "Saving...") : isKo ? "닉네임 저장" : "Save nickname"}
                  </button>
                </div>
                {dashUser?.profile_public !== false ? (
                  <div className={skin.profileDivTop}>
                    <button type="button" onClick={copyProfileLink} className={skin.btnOutline}>
                      {copyOk ? (
                        isKo ? "복사됨" : "Copied"
                      ) : (
                        <>
                          <Copy size={16} />
                          {isKo ? "프로필 링크 복사" : "Copy profile link"}
                        </>
                      )}
                    </button>
                    <span className={`${skin.urlHint} max-w-full break-all`}>
                      <Share2 size={14} className="shrink-0" />
                      {profileShareUrl}
                    </span>
                  </div>
                ) : null}
                {toss && mode === "self" && dashUser?.profile_public !== false && profileQrDataUrl ? (
                  <div className="mt-4 flex flex-col items-center gap-2 border-t border-[#D9E8FF] pt-4">
                    <p className="text-center text-xs text-slate-600">
                      {isKo ? "프로필 공유 QR (토스 앱에서 스캔)" : "Profile QR (scan in Toss)"}
                    </p>
                    <img
                      src={profileQrDataUrl}
                      alt=""
                      width={200}
                      height={200}
                      className="rounded-xl border border-[#D9E8FF] bg-white p-2 shadow-sm"
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            {mode === "self" && myUploads.length > 0 ? (
              <section>
                <h2 className={skin.h2}>
                  <ImageIcon size={20} className="text-sky-400" />
                  {isKo ? "직접 업로드한 사진(방)" : "Rooms from my uploads"}
                </h2>
                <p className={skin.sectionP}>
                  {isKo
                    ? "퍼즐록스에서 제공한 이미지로 만든 방은 제외됩니다. 썸네일은 본인만 볼 수 있어요."
                    : "Rooms created from the built-in image catalog are not listed here. Only you see these thumbnails."}
                </p>
                <ul className="space-y-3">
                  {myUploads.map((r) => (
                    <li key={r.roomId} className={skin.listLi}>
                      <div className={skin.thumb}>
                        {r.imageUrl ? (
                          <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className={skin.thumbEmpty}>
                            <ImageIcon size={28} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={skin.monoCode}>#{r.roomCode}</p>
                        <p className={skin.meta}>
                          {puzzleDifficultyLabel(normalizePuzzleDifficulty(r.difficulty), isKo)} · {r.pieceCount}{" "}
                          {isKo ? "조각" : "pcs"}
                          {r.status ? (
                            <span>
                              {" "}
                              · {r.status}
                            </span>
                          ) : null}
                        </p>
                        {r.createdAt ? (
                          <p className={skin.dateSmall}>
                            {isKo ? "만든 날" : "Created"}: {new Date(r.createdAt).toLocaleString()}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            void enterRoom(r.roomId, {
                              imageUrl: r.imageUrl,
                              pieceCount: r.pieceCount,
                              difficulty: r.difficulty,
                              creatorName: dashUser?.username ?? null,
                              iAmCreator: true,
                            })
                          }
                          className={skin.btnSmall}
                        >
                          {isKo ? "입장" : "Enter"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <div className="mb-3 flex flex-row items-start justify-between gap-2">
                <h2 className={skin.h2Row}>
                  <Users size={20} className="shrink-0 text-emerald-400" />
                  <span className="min-w-0 sm:min-w-[unset]">
                    {isKo ? "참여한 퍼즐방" : "Puzzle rooms joined"}
                  </span>
                </h2>
                {participated.length > 0 && mode === "self" ? (
                  <div className={skin.filterMenuRoot} ref={participatedFilterRef}>
                    <button
                      type="button"
                      className={skin.filterMenuTrigger}
                      aria-expanded={participatedFilterOpen}
                      aria-haspopup="listbox"
                      aria-label={isKo ? "참여한 방 필터" : "Filter joined rooms"}
                      onClick={() => setParticipatedFilterOpen((o) => !o)}
                    >
                      <span className="min-w-0 truncate">
                        {participatedFilterLabel(participatedRoomFilter, isKo)}
                      </span>
                      <ChevronDown
                        size={18}
                        className={`shrink-0 opacity-70 transition-transform ${participatedFilterOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      />
                    </button>
                    {participatedFilterOpen ? (
                      <ul
                        className={skin.filterMenuPanel}
                        role="listbox"
                        aria-label={isKo ? "참여한 방 필터" : "Filter joined rooms"}
                      >
                        {(
                          [
                            "all",
                            "only_created",
                            "hide_created",
                          ] as const satisfies readonly ParticipatedRoomFilter[]
                        ).map((key) => {
                          const disabled = key !== "all" && !hasMyCreatedInParticipated;
                          const selected = participatedRoomFilter === key;
                          return (
                            <li key={key} role="presentation">
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected}
                                disabled={disabled}
                                className={`${skin.filterMenuOption} ${selected ? skin.filterMenuOptionActive : ""} ${disabled ? skin.filterMenuOptionDisabled : ""}`}
                                onClick={() => {
                                  if (disabled) return;
                                  setParticipatedRoomFilter(key);
                                  setParticipatedFilterOpen(false);
                                }}
                              >
                                <span className="min-w-0 flex-1 text-left">
                                  {participatedFilterLabel(key, isKo)}
                                </span>
                                {selected ? <Check size={16} className="shrink-0 opacity-80" aria-hidden /> : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {participated.length === 0 ? (
                <p className={skin.empty}>{isKo ? "아직 기록이 없습니다." : "No history yet."}</p>
              ) : participatedFiltered.length === 0 ? (
                <p className={skin.empty}>
                  {mode === "public"
                    ? isKo
                      ? "표시할 방이 없습니다."
                      : "Nothing to show."
                    : participatedRoomFilter === "only_created" && !hasMyCreatedInParticipated
                      ? isKo
                        ? "참여 목록에 내가 만든 방이 없습니다."
                        : "You have no rooms you created in this list."
                      : isKo
                        ? "필터 조건에 맞는 방이 없습니다."
                        : "No rooms match this filter."}
                </p>
              ) : (
                <>
                <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:gap-3" role="list">
                  {participatedPageItems.map((r) => {
                    const displayTotal =
                      typeof r.totalPieces === "number" && r.totalPieces > 0
                        ? r.totalPieces
                        : Math.max(0, r.pieceCount);
                    const displayLocked = Math.max(0, r.lockedPieces ?? 0);
                    const pctRaw =
                      typeof r.progressPercent === "number"
                        ? r.progressPercent
                        : displayTotal > 0
                          ? Math.min(100, Math.round((displayLocked / displayTotal) * 100))
                          : 0;
                    const done =
                      r.isCompleted === true ||
                      r.status === "completed" ||
                      (displayTotal > 0 && displayLocked >= displayTotal);
                    const barPct = done ? 100 : pctRaw;
                    return (
                      <li key={r.roomId} className={skin.joinedGridLi}>
                        <div className={skin.joinedGridThumb}>
                          {r.imageUrl ? (
                            <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className={skin.privateText}>
                              <Lock size={16} />
                              {isKo ? "이미지 비공개" : "Image private"}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <p className={skin.roomCode}>#{r.roomCode}</p>
                            {r.iAmCreator ? (
                              <span className={skin.badgeMine}>
                                {isKo ? "내 방" : "Mine"}
                              </span>
                            ) : null}
                          </div>
                          <p className={skin.metaLine}>
                            {puzzleDifficultyLabel(normalizePuzzleDifficulty(r.difficulty), isKo)} · {r.pieceCount}{" "}
                            {isKo ? "조각" : "pcs"}
                            {typeof r.scoreInRoom === "number" && r.scoreInRoom > 0 ? (
                              <span>
                                {" "}
                                · {isKo ? "이 방 점수" : "Score"} {r.scoreInRoom}
                              </span>
                            ) : null}
                          </p>
                          {displayTotal > 0 ? (
                            <div className="mt-2 space-y-1">
                              <div className={skin.progressMeta}>
                                <span>
                                  {isKo ? "진행" : "Progress"}: {displayLocked}/{displayTotal}{" "}
                                  {isKo ? "조각" : "pcs"}
                                  <span className={skin.progressMetaPct}>
                                    {" "}
                                    ({done ? 100 : pctRaw}%)
                                  </span>
                                </span>
                                {done ? (
                                  <span className={skin.doneBadge}>
                                    <CheckCircle size={12} className="shrink-0" aria-hidden />
                                    {isKo ? "완료" : "Done"}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={skin.progressTrack}
                                role="progressbar"
                                aria-valuenow={done ? displayTotal : displayLocked}
                                aria-valuemin={0}
                                aria-valuemax={displayTotal}
                                aria-label={isKo ? "퍼즐 진행도" : "Puzzle progress"}
                              >
                                <div
                                  className={done ? skin.progressFillDone : skin.progressFill}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                            </div>
                          ) : null}
                          {r.lastVisitedAt ? (
                            <p className={skin.dateSmall}>
                              {isKo ? "최근 방문" : "Last visit"}: {new Date(r.lastVisitedAt).toLocaleString()}
                            </p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              void enterRoom(r.roomId, {
                                imageUrl: r.imageUrl,
                                pieceCount: r.pieceCount,
                                difficulty: r.difficulty,
                                hasPassword: profileParticipatedRowHasPassword(
                                  r as { hasPassword?: unknown; has_password?: unknown }
                                ),
                                creatorName: r.creatorName ?? null,
                                iAmCreator: r.iAmCreator === true,
                              })
                            }
                            className={`${skin.btnEnter} w-full`}
                          >
                            {isKo ? "입장" : "Enter"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {participatedFiltered.length > DASHBOARD_PARTICIPATED_PAGE_SIZE ? (
                  <div
                    className={skin.paginationBar}
                    role="navigation"
                    aria-label={isKo ? "참여한 퍼즐방 페이지" : "Joined puzzle rooms pagination"}
                  >
                    <p className={skin.paginationInfo}>
                      {isKo
                        ? `${participatedOffset + 1}–${participatedOffset + participatedPageItems.length}번째 · 총 ${participatedFiltered.length}개 · ${participatedPageClamped}/${participatedTotalPages} 페이지`
                        : `Items ${participatedOffset + 1}–${participatedOffset + participatedPageItems.length} of ${participatedFiltered.length} · Page ${participatedPageClamped} / ${participatedTotalPages}`}
                    </p>
                    <div className={skin.paginationNav}>
                      <button
                        type="button"
                        className={skin.paginationBtn}
                        disabled={participatedPageClamped <= 1}
                        aria-label={isKo ? "이전 페이지" : "Previous page"}
                        onClick={() => setParticipatedListPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={skin.paginationBtn}
                        disabled={participatedPageClamped >= participatedTotalPages}
                        aria-label={isKo ? "다음 페이지" : "Next page"}
                        onClick={() =>
                          setParticipatedListPage((p) =>
                            Math.min(participatedTotalPages, p + 1),
                          )
                        }
                      >
                        <ChevronRight size={18} aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : null}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
