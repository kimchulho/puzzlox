import {
  closeView,
  graniteEvent,
  partner,
  setDeviceOrientation,
  tdsEvent,
} from "@apps-in-toss/web-framework";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal, Text } from "@toss/tds-mobile";
import type { AuthUser } from "@contracts/auth";
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
import { normalizePuzzleDifficulty, type PuzzleDifficulty } from "@web/lib/puzzleDifficulty";
import { supabase } from "@web/lib/supabaseClient";
import { clearSession } from "./lib/tossSession";
import { LeavePuzzleConfirmDialog } from "./LeavePuzzleConfirmDialog";
import {
  TOSS_APP_DISPLAY_NAME,
  TOSS_BRAND_ICON_URL,
  TOSS_LEADERBOARD_NAV_ACCESSORY_ID,
} from "./tossNavAccessory";
import { useTossHostChromePadding } from "./useTossHostChromePadding";
import { useTossSafeAreaInsets } from "./useTossSafeAreaInsets";

export default function GameShell({
  user,
  setUser,
  onLoggedOut,
  onRequestTossLogin,
}: {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  onLoggedOut: () => void;
  onRequestTossLogin: () => void;
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

  const [showNavLoginModal, setShowNavLoginModal] = useState(false);
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

  useEffect(() => {
    const cleanup = tdsEvent.addEventListener("navigationAccessoryEvent", {
      onEvent: ({ id }) => {
        if (id === TOSS_LEADERBOARD_NAV_ACCESSORY_ID) setShowNavLoginModal(true);
      },
    });
    return cleanup;
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

  useEffect(() => {
    // defineConfig 반영이 늦거나 누락되는 경우를 대비해 런타임에서도 액세서리 버튼을 보장합니다.
    void partner
      .addAccessoryButton({
        id: TOSS_LEADERBOARD_NAV_ACCESSORY_ID,
        title: "로그인",
        icon: { name: "icon-heart-mono" },
      })
      .catch(() => {});
    return () => {
      void partner.removeAccessoryButton().catch(() => {});
    };
  }, []);

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
  }, [loading, currentRoom, pathname, showAdmin]);

  useEffect(() => {
    const roomParam = roomCodeFromLocation();

    if (roomParam) {
      const isNumeric = /^\d+$/.test(roomParam);
      const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);

      if (decodedId) {
        supabase
          .from("rooms")
          .select("*")
          .eq("id", decodedId)
          .single()
          .then(({ data, error }) => {
            if (data && !error) {
              const url = `${window.location.pathname}${window.location.search}`;
              // 스택에 로비(/)가 없으면 뒤로가기·go(-2)로 로비 복귀가 불가능해 한 번 깔아 둡니다.
              window.history.replaceState({ layer: "lobby" }, "", "/");
              window.history.pushState({ layer: "puzzle" }, "", url);
              window.history.pushState({ layer: "puzzle-top" }, "", url);
              setCurrentRoom({
                id: data.id,
                imageUrl: data.image_url,
                pieceCount: data.piece_count,
                difficulty: normalizePuzzleDifficulty((data as { difficulty?: string }).difficulty),
              });
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
        supabase
          .from("rooms")
          .select("*")
          .eq("id", decodedId)
          .single()
          .then(({ data, error }) => {
            if (data && !error) {
              setCurrentRoom({
                id: data.id,
                imageUrl: data.image_url,
                pieceCount: data.piece_count,
                difficulty: normalizePuzzleDifficulty((data as { difficulty?: string }).difficulty),
              });
            }
          });
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleJoinRoom = (
    roomId: number,
    imageUrl: string,
    pieceCount: number,
    difficulty: PuzzleDifficulty = "medium"
  ) => {
    const url = roomPath(roomId);
    window.history.pushState({ layer: "puzzle" }, "", url);
    window.history.pushState({ layer: "puzzle-top" }, "", url);
    setCurrentRoom({ id: roomId, imageUrl, pieceCount, difficulty });
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

  const navLoginModal = (
    <Modal open={showNavLoginModal} onOpenChange={setShowNavLoginModal}>
      <Modal.Overlay />
      <Modal.Content title="로그인" onClick={() => setShowNavLoginModal(false)}>
        <Text display="block" typography="t6" color="adaptive.grey800">
          로그인하면 전적과 기록을 안전하게 저장할 수 있어요.
        </Text>
        <div style={{ marginTop: 20 }}>
          <Button
            color="primary"
            variant="fill"
            display="full"
            size="large"
            onClick={() => {
              setShowNavLoginModal(false);
              onRequestTossLogin();
            }}
          >
            로그인
          </Button>
        </div>
      </Modal.Content>
    </Modal>
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
        {navLoginModal}
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
        {navLoginModal}
      </>
    );
  }

  if (pathname === "/dashboard" || pathname === "/dashboard/") {
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
          <UserDashboard
            mode="self"
            onBack={() => navigateToPath("/")}
            onJoinRoom={handleJoinRoom}
            locale="ko"
            user={user ?? undefined}
            setUser={(u) => setUser(u as AuthUser)}
          />
        </div>
        {navLoginModal}
      </>
    );
  }

  const tossProfileMatch = pathname.match(/^\/u\/([^/]+)\/?$/);
  if (tossProfileMatch) {
    const un = decodeURIComponent(tossProfileMatch[1]);
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
          <UserDashboard
            mode="public"
            publicUsername={un}
            onBack={() => navigateToPath("/")}
            onJoinRoom={handleJoinRoom}
            locale="ko"
          />
        </div>
        {navLoginModal}
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
        {navLoginModal}
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
        {navLoginModal}
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
          brandTitle: TOSS_APP_DISPLAY_NAME,
          brandIconUrl: TOSS_BRAND_ICON_URL,
        }}
        locale="ko"
      />
      {navLoginModal}
    </>
  );
}

