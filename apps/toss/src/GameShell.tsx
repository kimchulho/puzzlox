import { closeView, graniteEvent, setDeviceOrientation } from "@apps-in-toss/web-framework";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthUser } from "@contracts/auth";
import type { JoinRoomMeta } from "@contracts/roomJoin";
import Admin from "@web/components/Admin";
import Lobby from "@web/components/Lobby";
import PuzzleBoard from "@web/components/PuzzleBoard";
import TermsOfService from "@web/components/TermsOfService";
import UserDashboard from "@web/components/UserDashboard";
import {
  decodeRoomId,
  parseRoomCodeFromPathname,
  roomCodeFromLocation,
  roomPath,
} from "@web/lib/roomCode";
import { ensureRoomPasswordVerified, ROOM_PUBLIC_COLUMNS } from "@web/lib/roomAccess";
import { normalizePuzzleDifficulty, type PuzzleDifficulty } from "@web/lib/puzzleDifficulty";
import { supabase } from "@web/lib/supabaseClient";
import { clearSession } from "./lib/tossSession";
import { LeavePuzzleConfirmDialog } from "./LeavePuzzleConfirmDialog";
import { useTossHostChromePadding } from "./useTossHostChromePadding";
import { useTossSafeAreaInsets } from "./useTossSafeAreaInsets";

function roomRowToShellRoom(data: Record<string, unknown>) {
  return {
    id: Number(data.id),
    imageUrl: String(data.image_url ?? ""),
    pieceCount: Number(data.piece_count ?? 0),
    difficulty: normalizePuzzleDifficulty(String(data.difficulty ?? "medium")),
  };
}

function tossShellIsKo() {
  try {
    return localStorage.getItem("webpuzzle_locale") !== "en";
  } catch {
    return true;
  }
}

export default function GameShell({
  user,
  setUser,
  onLoggedOut,
  onRequestTossLogin,
  tossLoginBusy = false,
}: {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  onLoggedOut: () => void;
  onRequestTossLogin: () => void | Promise<void>;
  tossLoginBusy?: boolean;
}) {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [currentRoom, setCurrentRoom] = useState<{
    id: number;
    imageUrl: string;
    pieceCount: number;
    difficulty: PuzzleDifficulty;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  const tossHostPadding = useTossHostChromePadding();
  const tossSafeArea = useTossSafeAreaInsets();

  const [showLeavePuzzleModal, setShowLeavePuzzleModal] = useState(false);
  const currentRoomRef = useRef<typeof currentRoom>(null);
  const showAdminRef = useRef(false);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    showAdminRef.current = showAdmin;
  }, [showAdmin]);

  /**
   * `setDeviceOrientation` 은 기기 자이로를 강제로 돌리는 API가 아니라,
   * 미니앱(WebView) 쪽에 **가로·세로 표시 방향을 요청**하는 Toss 프레임워크 네이티브 연동입니다.
   * 퍼즐 보드의 CSS 와이드 모드(`rotate(-90deg)`)와는 별개이며, 상단 툴의 "화면 회전"이 이 API를 씁니다.
   * 가로로 전환한 뒤 로비(세로 UI)로 돌아올 때만 세로로 맞춥니다.
   */
  const tossOrientationRef = useRef<"portrait" | "landscape">("portrait");

  const handleTossToggleOrientation = async () => {
    const next = tossOrientationRef.current === "portrait" ? "landscape" : "portrait";
    try {
      await setDeviceOrientation({ type: next });
      tossOrientationRef.current = next;
    } catch (e) {
      console.warn("[toss] setDeviceOrientation failed", e);
    }
  };

  /** 로비·약관·관리자: 세로 모드 (퍼즐에서 네이티브 가로를 썼다면 로비 복귀 시 세로로 복원) */
  useEffect(() => {
    if (currentRoom) return;
    tossOrientationRef.current = "portrait";
    void setDeviceOrientation({ type: "portrait" }).catch(() => {});
  }, [currentRoom, pathname, showAdmin]);

  const exitPuzzleToLobby = useCallback(() => {
    setShowLeavePuzzleModal(false);
    setCurrentRoom(null);
    const st = window.history.state as { layer?: string } | null;
    if (st?.layer === "puzzle-top") {
      window.history.go(-2);
    } else {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  /**
   * 상단바 앱 이름(제목) 또는 홈 버튼 탭 시 기본 동작은 초기 화면으로 새로고침이에요.
   * 퍼즐 진행 중에는 뒤로가기와 동일하게 확인 모달을 띄웁니다. (구독 시 네이티브 기본 동작은 대체됨)
   * @see https://developers-apps-in-toss.toss.im/bedrock/reference/framework/이벤트
   */
  useEffect(() => {
    if (!currentRoom) return;
    const cleanup = graniteEvent.addEventListener("homeEvent", {
      onEvent: () => {
        setShowLeavePuzzleModal(true);
      },
      onError: () => {},
    });
    return cleanup;
  }, [currentRoom]);

  const navigateToPath = (path: string) => {
    window.history.pushState({}, "", path);
    setPathname(path);
  };

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /**
   * 로비에서 뒤로 가기 → 히스토리만 타면 약관 등 이전 화면으로 돌아가 혼동될 수 있어,
   * `/` 두 단(base/top)을 쌓고, base로 pop 되면 미니앱을 닫습니다.
   */
  useEffect(() => {
    if (loading || currentRoom || showAdmin) return;
    /** 퍼즐 퇴장 직후 히스토리 정리와 첫 페인트가 겹치면 WebView에서 로비가 한 번 깜빡일 수 있어 한 프레임 뒤로 미룸 */
    const raf = requestAnimationFrame(() => {
      const locPath = window.location.pathname;
      if (locPath !== "/" && locPath !== "") return;
      if (parseRoomCodeFromPathname(locPath)) return;
      if (new URLSearchParams(window.location.search).get("room")) return;

      const st = window.history.state as { tossLobbyGuard?: string } | null;
      if (st?.tossLobbyGuard === "top") return;
      if (st?.tossLobbyGuard === "base") {
        window.history.pushState({ tossLobbyGuard: "top" }, "", "/");
        return;
      }
      window.history.replaceState({ tossLobbyGuard: "base" }, "", "/");
      window.history.pushState({ tossLobbyGuard: "top" }, "", "/");
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, currentRoom, pathname, showAdmin]);

  useEffect(() => {
    const gateUser = user ? { id: user.id, username: user.username } : null;
    async function loadRoomRowWithPasswordGate(roomId: number): Promise<Record<string, unknown> | null> {
      const { data, error } = await supabase
        .from("rooms")
        .select(ROOM_PUBLIC_COLUMNS)
        .eq("id", roomId)
        .maybeSingle();
      if (!data || error) return null;
      const hasPw = (data as { has_password?: boolean }).has_password === true;
      const row = data as {
        id: unknown;
        created_by?: unknown;
        creator_name?: string | null;
      };
      const ok = await ensureRoomPasswordVerified(roomId, hasPw, tossShellIsKo(), {
        room: {
          id: Number(row.id),
          created_by: row.created_by,
          creator_name: row.creator_name ?? null,
        },
        user: gateUser,
      });
      return ok ? (data as Record<string, unknown>) : null;
    }

    const roomParam = roomCodeFromLocation();

    if (roomParam) {
      const isNumeric = /^\d+$/.test(roomParam);
      const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);

      if (decodedId) {
        void loadRoomRowWithPasswordGate(decodedId).then((data) => {
          if (data) {
            const url = `${window.location.pathname}${window.location.search}`;
            // 스택에 로비(/)가 없으면 뒤로가기·go(-2)로 로비 복귀가 불가능해 한 번 깔아 둡니다.
            window.history.replaceState({ layer: "lobby" }, "", "/");
            window.history.pushState({ layer: "puzzle" }, "", url);
            window.history.pushState({ layer: "puzzle-top" }, "", url);
            setCurrentRoom(roomRowToShellRoom(data));
          } else {
            window.history.replaceState({}, "", "/");
          }
          setLoading(false);
        });
      } else {
        window.history.replaceState({}, "", "/");
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    const handlePopState = () => {
      const roomParamPop = roomCodeFromLocation();
      const path = window.location.pathname;
      const st = window.history.state as { layer?: string; tossLobbyGuard?: string } | null;

      if (roomParamPop && st?.layer === "puzzle" && currentRoomRef.current) {
        setShowLeavePuzzleModal(true);
        window.history.pushState({ layer: "puzzle-top" }, "", window.location.href);
        return;
      }

      if (!roomParamPop) {
        setCurrentRoom(null);
        setShowLeavePuzzleModal(false);
        if (path === "/" && st?.tossLobbyGuard === "base") {
          if (showAdminRef.current) {
            setShowAdmin(false);
            window.history.pushState({ tossLobbyGuard: "top" }, "", "/");
          } else {
            void closeView().catch(() => {});
          }
        }
        return;
      }

      const isNumeric = /^\d+$/.test(roomParamPop);
      const decodedId = isNumeric ? parseInt(roomParamPop, 10) : decodeRoomId(roomParamPop);
      if (decodedId) {
        void loadRoomRowWithPasswordGate(decodedId).then((data) => {
          if (data) {
            setCurrentRoom(roomRowToShellRoom(data));
          }
        });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [user]);

  const handleJoinRoom = (
    roomId: number,
    imageUrl: string,
    pieceCount: number,
    difficulty: PuzzleDifficulty = "medium",
    _meta?: JoinRoomMeta
  ) => {
    const url = roomPath(roomId);
    window.history.pushState({ layer: "puzzle" }, "", url);
    window.history.pushState({ layer: "puzzle-top" }, "", url);
    setCurrentRoom({
      id: roomId,
      imageUrl,
      pieceCount,
      difficulty,
    });
  };

  const handleLeaveRoom = () => {
    exitPuzzleToLobby();
  };

  const handleLogout = () => {
    clearSession();
    setShowAdmin(false);
    onLoggedOut();
  };

  const leavePuzzleModal = (
    <LeavePuzzleConfirmDialog
      open={showLeavePuzzleModal}
      onCancel={() => setShowLeavePuzzleModal(false)}
      onConfirm={exitPuzzleToLobby}
    />
  );

  if (loading) {
    return (
      <>
        <div
          className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white box-border"
          style={{
            paddingTop: tossSafeArea.top,
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <div className="text-2xl font-bold animate-pulse">Loading...</div>
        </div>
      </>
    );
  }

  if (pathname === "/terms") {
    return (
      <>
        <div
          className="min-h-screen box-border bg-slate-950"
          style={{
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <TermsOfService
            safeAreaTop={tossSafeArea.top}
            onBack={() => {
              window.history.back();
            }}
          />
        </div>
      </>
    );
  }

  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    return (
      <>
        <div
          className="min-h-screen box-border bg-[#F4F8FF]"
          style={{
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <UserDashboard
            mode="self"
            visualVariant="toss"
            safeAreaTop={tossSafeArea.top}
            onBack={() => navigateToPath("/")}
            onJoinRoom={handleJoinRoom}
            locale="ko"
            user={user ?? undefined}
            setUser={setUser}
            onReauthWithToss={onRequestTossLogin}
            onSessionInvalid={() => {
              onLoggedOut();
              navigateToPath("/");
            }}
          />
        </div>
      </>
    );
  }

  const tossProfileMatch = pathname.match(/^\/u\/([^/]+)\/?$/);
  if (tossProfileMatch) {
    const un = decodeURIComponent(tossProfileMatch[1]);
    return (
      <>
        <div
          className="min-h-screen box-border bg-[#F4F8FF]"
          style={{
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <UserDashboard
            mode="public"
            visualVariant="toss"
            safeAreaTop={tossSafeArea.top}
            publicUsername={un}
            onBack={() => navigateToPath("/")}
            onJoinRoom={handleJoinRoom}
            locale="ko"
          />
        </div>
      </>
    );
  }

  if (showAdmin && user?.role === "admin") {
    return (
      <>
        <div
          className="min-h-screen box-border bg-slate-950"
          style={{
            paddingTop: tossSafeArea.top,
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <Admin onBack={() => setShowAdmin(false)} />
        </div>
      </>
    );
  }

  if (currentRoom) {
    return (
      <>
        <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
          <PuzzleBoard
            key={currentRoom.id}
            roomId={currentRoom.id}
            imageUrl={currentRoom.imageUrl}
            pieceCount={currentRoom.pieceCount}
            difficulty={currentRoom.difficulty}
            onBack={handleLeaveRoom}
            user={user}
            setUser={setUser as (u: unknown) => void}
            onToggleOrientation={handleTossToggleOrientation}
            hostWebViewPadding={tossHostPadding}
            locale="ko"
          />
        </div>
        {leavePuzzleModal}
      </>
    );
  }

  return (
    <>
      <Lobby
        onJoinRoom={handleJoinRoom}
        user={user}
        onLogout={handleLogout}
        onAdmin={() => setShowAdmin(true)}
        onLoginClick={onRequestTossLogin}
        onOpenDashboard={() => navigateToPath("/dashboard")}
        onOpenTerms={() => {
          navigateToPath("/terms");
        }}
        tossUi={{
          safeArea: tossSafeArea,
          tossLoginBusy,
        }}
        locale="ko"
      />
    </>
  );
}

