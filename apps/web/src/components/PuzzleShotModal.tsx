import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, SwitchCamera, X } from "lucide-react";
import {
  PS_BOARD_H,
  PS_BOARD_W,
  PS_COLS,
  PS_PIECE_H,
  PS_PIECE_W,
  PS_ROWS,
  buildPiecePath2D,
  piecePathSvgD,
  puzzleShotPieceIndexList,
} from "../lib/puzzleShotGrid";

type Phase = "camera" | "playback";

/** 미리보기·캔버스 외곽 라운드 — 동일 반지름 유지 */
const BEVEL_CORNER_RATIO = 0.065;

const SHAKE_DELTA_THRESHOLD = 14;
const SHAKE_COOLDOWN_MS = 450;

type PieceFallTarget = { x: number; y: number; rotate: number; duration: number; delay: number };

function requestDeviceMotionPermission(): Promise<boolean> {
  const DM = DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<string>;
  };
  if (typeof DM.requestPermission === "function") {
    return DM.requestPermission().then((s) => s === "granted");
  }
  return Promise.resolve(true);
}

/** PuzzleBoard `pieceGraphics.stroke` + deferred bevel(흰·검 오프셋 블러)에 가깝게 */
function applyPuzzlePieceBevel(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  minX: number,
  minY: number,
  scaleRef: number
) {
  const thin = Math.max(0.75, scaleRef * 0.38);
  ctx.save();
  ctx.translate(-minX, -minY);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = thin;
  ctx.stroke(path);

  ctx.filter = "blur(1px)";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.save();
  ctx.translate(1, 1);
  ctx.stroke(path);
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.save();
  ctx.translate(-1, -1);
  ctx.stroke(path);
  ctx.restore();
  ctx.filter = "none";
  ctx.restore();
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 보드 전체 외곽을 둥글게 클립(직소 결과·탭 끝이 모서리에서 자연스럽게) */
function applyRoundedOuterClipToBoard(board: HTMLCanvasElement) {
  const W = board.width;
  const H = board.height;
  const r = Math.min(W, H) * BEVEL_CORNER_RATIO;
  const ctx = board.getContext("2d");
  if (!ctx || r < 1) return;
  const snap = document.createElement("canvas");
  snap.width = W;
  snap.height = H;
  const sctx = snap.getContext("2d");
  if (!sctx) return;
  sctx.drawImage(board, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, r);
  ctx.clip();
  ctx.drawImage(snap, 0, 0);
  ctx.restore();
}

type VideoBoardParams = {
  u0: number;
  v0: number;
  uw: number;
  uh: number;
  W: number;
  H: number;
};

/**
 * 퍼즐 카드(2:3 뷰포트)와 축이 맞는 비디오 intrinsic 크롭 + 출력 캔버스 크기. (촬영·라이브 합성 공통)
 *
 * - `frameBoxEl`: 화면에 보이는 퍼즐 카드 박스(보통 `puzzleFrameOuterRef` — ResizeObserver와 동일 기준).
 * - 샘플링은 이 박스의 축정렬 bounding rect 전체입니다. 라이브에서는 `border-radius`로 모서리가 가려져 보이지만,
 *   직사각 크롭은 그 네 모서리 “코너 삼각” 픽셀까지 포함한 뒤, `applyRoundedOuterClipToBoard`에서 둥글게 잘라
 *   코너 장면이 결과에 남을 수 있어, 틀 안만 본다고 느낀 것보다 넓게 찍힌 것처럼 느껴질 수 있습니다.
 * - `object-cover` 비디오의 보이는 부분을 역투영해 intrinsic 좌표로 옮긴 뒤, 논리 보드 비(200:300)에 맞게
 *   가로 또는 세로만 한 번 더 잘라 냅니다(측정된 카드 비가 2:3과 미세하게 다를 때).
 */
function getVideoBoardDrawParams(video: HTMLVideoElement, frameBoxEl: Element): VideoBoardParams | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 2 || vh < 2) return null;

  const vRect = video.getBoundingClientRect();
  const fRect = frameBoxEl.getBoundingClientRect();

  const Dw = vRect.width;
  const Dh = vRect.height;
  if (Dw < 2 || Dh < 2) return null;

  const shrink = 0.35;
  const fl = fRect.left + shrink;
  const ft = fRect.top + shrink;
  const fr = fRect.right - shrink;
  const fb = fRect.bottom - shrink;

  const rx = Math.max(0, fl - vRect.left);
  const ry = Math.max(0, ft - vRect.top);
  const rx2 = Math.min(Dw, fr - vRect.left);
  const ry2 = Math.min(Dh, fb - vRect.top);
  const rw = Math.max(0, rx2 - rx);
  const rh = Math.max(0, ry2 - ry);
  if (rw < 2 || rh < 2) return null;

  const ir = vw / vh;
  const er = Dw / Dh;
  let srcX: number;
  let srcY: number;
  let srcW: number;
  let srcH: number;
  if (er > ir) {
    srcH = vh;
    srcW = vh * er;
    srcX = (vw - srcW) / 2;
    srcY = 0;
  } else {
    srcW = vw;
    srcH = vw / er;
    srcX = 0;
    srcY = (vh - srcH) / 2;
  }

  let u0 = srcX + (rx / Dw) * srcW;
  let v0 = srcY + (ry / Dh) * srcH;
  let uw = (rw / Dw) * srcW;
  let uh = (rh / Dh) * srcH;

  const targetR = PS_BOARD_W / PS_BOARD_H;
  const cropR = uw / uh;
  if (cropR > targetR) {
    const nuw = uh * targetR;
    u0 += (uw - nuw) / 2;
    uw = nuw;
  } else if (cropR < targetR) {
    const nuh = uw / targetR;
    v0 += (uh - nuh) / 2;
    uh = nuh;
  }

  u0 = Math.max(0, Math.min(vw - 1, u0));
  v0 = Math.max(0, Math.min(vh - 1, v0));
  uw = Math.min(uw, vw - u0);
  uh = Math.min(uh, vh - v0);
  if (uw < 2 || uh < 2) return null;

  const maxW = 400;
  let W = Math.min(maxW, Math.max(PS_COLS, Math.round(uw)));
  W -= W % PS_COLS;
  if (W < PS_COLS) W = PS_COLS;
  const H = Math.round((W * PS_BOARD_H) / PS_BOARD_W);

  return { u0, v0, uw, uh, W, H };
}

function drawBoardOntoCanvas(video: HTMLVideoElement, params: VideoBoardParams, canvas: HTMLCanvasElement) {
  if (canvas.width !== params.W || canvas.height !== params.H) {
    canvas.width = params.W;
    canvas.height = params.H;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, params.u0, params.v0, params.uw, params.uh, 0, 0, params.W, params.H);
  applyRoundedOuterClipToBoard(canvas);
}

/**
 * 퍼즐 카드(2:3 뷰포트)와 축이 맞는 직사각 영역만 비디오에서 잘라 보드로 그립니다. 모서리는 이후 캔버스에서 라운드.
 */
function captureBoardCanvasFromFrame(video: HTMLVideoElement, frameBoxEl: Element): HTMLCanvasElement | null {
  const p = getVideoBoardDrawParams(video, frameBoxEl);
  if (!p) return null;
  const canvas = document.createElement("canvas");
  canvas.width = p.W;
  canvas.height = p.H;
  drawBoardOntoCanvas(video, p, canvas);
  return canvas;
}

/** `extractPieceImages`와 동일한 클립·베벨로 조각을 합성(배경 검정 = 미리보기와 동일). */
function compositeBeveledPuzzleFromBoard(
  board: HTMLCanvasElement,
  dest: HTMLCanvasElement,
  scratch: HTMLCanvasElement
) {
  const W = board.width;
  const H = board.height;
  if (dest.width !== W || dest.height !== H) {
    dest.width = W;
    dest.height = H;
  }
  const dctx = dest.getContext("2d");
  if (!dctx) return;
  dctx.fillStyle = "#000000";
  dctx.fillRect(0, 0, W, H);

  const sx = W / PS_BOARD_W;
  const sy = H / PS_BOARD_H;
  const tabDepth = Math.min(PS_PIECE_W, PS_PIECE_H) * 0.2 * Math.min(sx, sy);
  const pad = Math.ceil(tabDepth * 1.25);
  const pieceWpx = W / PS_COLS;
  const pieceHpx = H / PS_ROWS;
  const cw = pieceWpx + 2 * pad;
  const ch = pieceHpx + 2 * pad;
  const scaleRef = Math.min(sx, sy);

  if (scratch.width !== cw || scratch.height !== ch) {
    scratch.width = cw;
    scratch.height = ch;
  }

  const sctx = scratch.getContext("2d");
  if (!sctx) return;

  for (const { col, row } of puzzleShotPieceIndexList()) {
    const ox = col * PS_PIECE_W * sx;
    const oy = row * PS_PIECE_H * sy;
    const minX = Math.floor(ox - pad);
    const minY = Math.floor(oy - pad);
    sctx.clearRect(0, 0, cw, ch);
    const path = buildPiecePath2D(col, row, sx, sy);
    sctx.save();
    sctx.translate(-minX, -minY);
    sctx.clip(path);
    sctx.drawImage(board, 0, 0);
    sctx.restore();
    applyPuzzlePieceBevel(sctx, path, minX, minY, scaleRef);
    dctx.drawImage(scratch, col * pieceWpx - pad, row * pieceHpx - pad);
  }
}

type PuzzleShotExtractResult = {
  urls: string[];
  cellW: number;
  cellH: number;
  boardW: number;
  boardH: number;
  pad: number;
  pieceWpx: number;
  pieceHpx: number;
};

function extractPieceImages(board: HTMLCanvasElement): PuzzleShotExtractResult {
  const W = board.width;
  const H = board.height;
  const sx = W / PS_BOARD_W;
  const sy = H / PS_BOARD_H;
  const tabDepth = Math.min(PS_PIECE_W, PS_PIECE_H) * 0.2 * Math.min(sx, sy);
  const pad = Math.ceil(tabDepth * 1.25);
  const pieceW = W / PS_COLS;
  const pieceH = H / PS_ROWS;
  const cw = pieceW + 2 * pad;
  const ch = pieceH + 2 * pad;
  const pieceWpx = pieceW;
  const pieceHpx = pieceH;
  const scaleRef = Math.min(sx, sy);

  const urls: string[] = [];
  for (const { col, row } of puzzleShotPieceIndexList()) {
    const ox = col * PS_PIECE_W * sx;
    const oy = row * PS_PIECE_H * sy;
    const minX = Math.floor(ox - pad);
    const minY = Math.floor(oy - pad);
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) {
      urls.push("");
      continue;
    }
    const path = buildPiecePath2D(col, row, sx, sy);
    ctx.save();
    ctx.translate(-minX, -minY);
    ctx.clip(path);
    ctx.drawImage(board, 0, 0);
    ctx.restore();

    applyPuzzlePieceBevel(ctx, path, minX, minY, scaleRef);

    try {
      urls.push(c.toDataURL("image/webp", 0.92));
    } catch {
      urls.push(c.toDataURL("image/png"));
    }
  }

  return {
    urls,
    cellW: cw,
    cellH: ch,
    boardW: W,
    boardH: H,
    pad,
    pieceWpx,
    pieceHpx,
  };
}

function puzzleShotBoardLayoutFromSize(W: number, H: number) {
  const sx = W / PS_BOARD_W;
  const sy = H / PS_BOARD_H;
  const tabDepth = Math.min(PS_PIECE_W, PS_PIECE_H) * 0.2 * Math.min(sx, sy);
  const pad = Math.ceil(tabDepth * 1.25);
  const pieceWpx = W / PS_COLS;
  const pieceHpx = H / PS_ROWS;
  return {
    boardW: W,
    boardH: H,
    pad,
    pieceWpx,
    pieceHpx,
    cellW: pieceWpx + 2 * pad,
    cellH: pieceHpx + 2 * pad,
  };
}

/** 카메라·결과 동일 표시 크기 (2:3) */
const PUZZLE_VIEWPORT_CLASS =
  "relative shrink-0 w-[min(288px,calc(100vw-3rem))] max-w-[288px] aspect-[2/3]";

function puzzleViewportCornerRadiusPx(w: number, h: number) {
  if (w < 4 || h < 4) return 8;
  return Math.max(6, Math.min(w, h) * BEVEL_CORNER_RATIO);
}

/** 퍼즐 격자: 흰색 틀은 투명(미리보기·카메라에서 비디오만 보이게). 어두운 베벨만 남김. */
function PuzzleShotGridSvgBeveled({ className }: { className?: string }) {
  const reactId = useId();
  const blurId = `psf-blur-${reactId.replace(/:/g, "")}`;
  const pieces = puzzleShotPieceIndexList();

  return (
    <svg
      viewBox={`0 0 ${PS_BOARD_W} ${PS_BOARD_H}`}
      className={className ?? "block h-full w-full"}
      preserveAspectRatio="none"
    >
      <defs>
        <filter id={blurId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.85" />
        </filter>
      </defs>
      {pieces.map(({ col, row }) => {
        const d = piecePathSvgD(col, row);
        return (
          <g key={`g-${col}-${row}`}>
            <path
              d={d}
              fill="none"
              stroke="rgba(0,0,0,0.1)"
              strokeWidth={1.05}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <g filter={`url(#${blurId})`} opacity={0.65}>
              <path
                d={d}
                fill="none"
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={0.85}
                strokeLinejoin="round"
                strokeLinecap="round"
                transform="translate(-1.1, -1.1)"
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export function PuzzleShotModal({
  open,
  onClose,
  isKo,
}: {
  open: boolean;
  onClose: () => void;
  isKo: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** 둥근 클립 뷰포트 — 캡처 기준(화면에 보이는 퍼즐 영역만) */
  const puzzleClipRef = useRef<HTMLDivElement | null>(null);
  const puzzleFrameOuterRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [camError, setCamError] = useState<string | null>(null);
  const [pieceUrls, setPieceUrls] = useState<string[]>([]);
  const [burstKey, setBurstKey] = useState(0);
  const [frameLayout, setFrameLayout] = useState({ w: 288, h: 432 });
  const [facingUser, setFacingUser] = useState(true);
  const [fallStarted, setFallStarted] = useState(false);
  const [fallTargets, setFallTargets] = useState<PieceFallTarget[]>([]);
  const [boardMetrics, setBoardMetrics] = useState({
    boardW: 200,
    boardH: 300,
    pad: 16,
    pieceWpx: 100,
    pieceHpx: 100,
    cellW: 120,
    cellH: 120,
  });

  const fallStartedRef = useRef(false);
  const lastAccelRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastShakeAtRef = useRef(0);
  const liveCameraBoardBufRef = useRef<HTMLCanvasElement | null>(null);
  const liveCameraScratchRef = useRef<HTMLCanvasElement | null>(null);
  const liveCameraCompositeRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraLiveMetrics, setCameraLiveMetrics] = useState<ReturnType<typeof puzzleShotBoardLayoutFromSize> | null>(
    null
  );

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        t.stop();
      }
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!liveCameraBoardBufRef.current) liveCameraBoardBufRef.current = document.createElement("canvas");
    if (!liveCameraScratchRef.current) liveCameraScratchRef.current = document.createElement("canvas");
  }, []);

  useEffect(() => {
    if (!open) setCameraLiveMetrics(null);
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "camera" || camError) return;
    let cancelled = false;
    let raf = 0;
    let lastT = 0;

    const loop = (now: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);
      if (now - lastT < 33) return;
      lastT = now;

      const v = videoRef.current;
      const frameEl = puzzleFrameOuterRef.current ?? puzzleClipRef.current;
      const board = liveCameraBoardBufRef.current;
      const dest = liveCameraCompositeRef.current;
      const scratch = liveCameraScratchRef.current;
      if (!v || !frameEl || !board || !dest || !scratch) return;

      const p = getVideoBoardDrawParams(v, frameEl);
      if (!p) return;

      drawBoardOntoCanvas(v, p, board);
      compositeBeveledPuzzleFromBoard(board, dest, scratch);

      setCameraLiveMetrics((prev) => {
        if (prev?.boardW === p.W && prev?.boardH === p.H) return prev;
        return puzzleShotBoardLayoutFromSize(p.W, p.H);
      });
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [open, phase, camError, facingUser]);

  const buildFallTargets = useCallback((): PieceFallTarget[] => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 700;
    const vw = typeof window !== "undefined" ? window.innerWidth : 400;
    return puzzleShotPieceIndexList().map((_, i) => ({
      x: (Math.random() - 0.5) * Math.min(160, vw * 0.35),
      y: vh * 0.55 + Math.random() * vh * 0.28,
      rotate: (Math.random() - 0.5) * 260,
      duration: 1.0 + (i % 3) * 0.09 + Math.random() * 0.12,
      delay: i * 0.04 + Math.random() * 0.07,
    }));
  }, []);

  const startFall = useCallback(() => {
    if (fallStartedRef.current) return;
    fallStartedRef.current = true;
    const targets = buildFallTargets();
    setFallTargets(targets);
    setFallStarted(true);
  }, [buildFallTargets]);

  useEffect(() => {
    fallStartedRef.current = fallStarted;
  }, [fallStarted]);

  useEffect(() => {
    if (!open || phase !== "playback" || fallStarted) return;
    lastAccelRef.current = null;

    const onMotion = (e: DeviceMotionEvent) => {
      if (fallStartedRef.current) return;
      const a =
        e.acceleration && (e.acceleration.x != null || e.acceleration.y != null)
          ? e.acceleration
          : e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const cur = { x: a.x, y: a.y, z: a.z };
      const prev = lastAccelRef.current;
      lastAccelRef.current = cur;
      if (!prev) return;
      const delta =
        Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) + Math.abs(cur.z - prev.z);
      const now = performance.now();
      if (delta < SHAKE_DELTA_THRESHOLD) return;
      if (now - lastShakeAtRef.current < SHAKE_COOLDOWN_MS) return;
      lastShakeAtRef.current = now;
      startFall();
    };

    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [open, phase, fallStarted, burstKey, startFall]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setPhase("camera");
      setPieceUrls([]);
      setCamError(null);
      setFacingUser(true);
      setFallStarted(false);
      fallStartedRef.current = false;
      setFallTargets([]);
      return;
    }

    let cancelled = false;
    setCamError(null);

    void (async () => {
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingUser ? "user" : "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setCamError(
            isKo
              ? "카메라를 사용할 수 없습니다. 브라우저 권한과 HTTPS 연결을 확인해 주세요."
              : "Camera unavailable. Check permissions and HTTPS."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, isKo, stopStream, facingUser]);

  /** 재촬영·낙하 후 카메라로 돌아올 때 재생 보장 (비디오는 항상 마운트) */
  useEffect(() => {
    if (!open || phase !== "camera") return;
    const v = videoRef.current;
    if (!v?.srcObject) return;
    void v.play().catch(() => undefined);
  }, [open, phase, facingUser]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = puzzleFrameOuterRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        setFrameLayout({ w: r.width, h: r.height });
      }
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    window.addEventListener("resize", read);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [open, phase, burstKey]);

  const clipRadiusPx = useMemo(
    () => puzzleViewportCornerRadiusPx(frameLayout.w, frameLayout.h),
    [frameLayout.w, frameLayout.h]
  );

  const returnToCamera = useCallback(() => {
    setPhase("camera");
    setPieceUrls([]);
    setFallStarted(false);
    fallStartedRef.current = false;
    setFallTargets([]);
  }, []);

  const handleCapture = useCallback(() => {
    if (!videoRef.current) return;
    void requestDeviceMotionPermission();
    void new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }).then(() => {
      const v = videoRef.current;
      const frameBox = puzzleFrameOuterRef.current ?? puzzleClipRef.current;
      if (!v || !frameBox) return;
      const board = captureBoardCanvasFromFrame(v, frameBox);
      if (!board) return;
      const extracted = extractPieceImages(board);
      setBoardMetrics({
        boardW: extracted.boardW,
        boardH: extracted.boardH,
        pad: extracted.pad,
        pieceWpx: extracted.pieceWpx,
        pieceHpx: extracted.pieceHpx,
        cellW: extracted.cellW,
        cellH: extracted.cellH,
      });
      setPieceUrls(extracted.urls);
      setFallStarted(false);
      fallStartedRef.current = false;
      setFallTargets([]);
      setBurstKey((k) => k + 1);
      setPhase("playback");
    });
  }, []);

  const handleRetake = useCallback(() => {
    returnToCamera();
  }, [returnToCamera]);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  const pieces = puzzleShotPieceIndexList();
  const lastIndex = pieces.length - 1;

  if (!open) return null;

  const { boardW, boardH, pad, pieceWpx, pieceHpx, cellW, cellH } = boardMetrics;
  const layoutBoardW =
    phase === "playback" && pieceUrls.length > 0 ? boardW : (cameraLiveMetrics?.boardW ?? 200);
  const layoutBoardH =
    phase === "playback" && pieceUrls.length > 0 ? boardH : (cameraLiveMetrics?.boardH ?? 300);
  const previewScale =
    frameLayout.w > 2 && frameLayout.h > 2
      ? Math.min(frameLayout.w / layoutBoardW, frameLayout.h / layoutBoardH)
      : 1;
  /** scale()은 레이아웃 박스를 안 줄여서 flex·둥근 클립과 그려진 내용이 어긋남 → 바깥은 스케일된 실제 크기 */
  const previewLayoutW = layoutBoardW * previewScale;
  const previewLayoutH = layoutBoardH * previewScale;

  return (
    <div
      className="fixed inset-0 z-[240] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={isKo ? "퍼즐샷" : "Puzzle shot"}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
        <span className="text-sm font-medium opacity-90">{isKo ? "퍼즐샷 (테스트)" : "Puzzle shot (demo)"}</span>
        <button
          type="button"
          onClick={handleClose}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          aria-label={isKo ? "닫기" : "Close"}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 relative min-h-0 flex items-center justify-center p-3">
        {!camError ? (
          <video
            ref={videoRef}
            className="absolute inset-0 z-0 w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />
        ) : null}
        {phase === "playback" ? <div className="absolute inset-0 z-[5] bg-black" aria-hidden /> : null}

        {phase === "camera" && (
          <>
            {camError ? (
              <p className="px-6 text-center text-sm text-amber-200/90 z-10">{camError}</p>
            ) : (
              <div className="relative z-10 pointer-events-none flex items-center justify-center">
                <div ref={puzzleFrameOuterRef} className={PUZZLE_VIEWPORT_CLASS}>
                  <div
                    ref={puzzleClipRef}
                    className="absolute inset-0 overflow-hidden"
                    style={{ borderRadius: clipRadiusPx }}
                  >
                    <div className="absolute inset-0 bg-black" aria-hidden />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="relative shrink-0"
                        style={{ width: previewLayoutW, height: previewLayoutH }}
                      >
                        <div
                          className="absolute left-0 top-0"
                          style={{
                            width: layoutBoardW,
                            height: layoutBoardH,
                            transform: `scale(${previewScale})`,
                            transformOrigin: "top left",
                          }}
                        >
                          <canvas
                            ref={liveCameraCompositeRef}
                            className="block max-w-none select-none"
                            style={{ width: layoutBoardW, height: layoutBoardH }}
                          />
                          <PuzzleShotGridSvgBeveled className="pointer-events-none absolute inset-0 block h-full w-full" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {phase === "playback" && pieceUrls.length > 0 && (
          <div className="relative z-10 flex items-center justify-center">
            {/* 카메라 단계와 동일: 바깥은 비율 박스만, 둥근 클립은 안쪽 레이어에만 */}
            <div ref={puzzleFrameOuterRef} className={PUZZLE_VIEWPORT_CLASS}>
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  borderRadius: clipRadiusPx,
                  overflow: fallStarted ? "visible" : "hidden",
                }}
              >
                <div
                  className="relative shrink-0"
                  style={{ width: previewLayoutW, height: previewLayoutH }}
                >
                  <div
                    className="absolute left-0 top-0"
                    style={{
                      width: layoutBoardW,
                      height: layoutBoardH,
                      transform: `scale(${previewScale})`,
                      transformOrigin: "top left",
                    }}
                  >
                  {pieces.map(({ col, row }, i) => {
                    const href = pieceUrls[i];
                    if (!href) return null;
                    const cx = ((col + 0.5) * PS_PIECE_W) / PS_BOARD_W;
                    const cy = ((row + 0.5) * PS_PIECE_H) / PS_BOARD_H;
                    const t = fallTargets[i];
                    const dropping = Boolean(fallStarted && t);
                    const commonStyle = {
                      transformOrigin: `${cx * 100}% ${cy * 100}%`,
                    } as const;
                    return (
                      <motion.img
                        key={`${burstKey}-${i}`}
                        src={href}
                        alt=""
                        width={cellW}
                        height={cellH}
                        className="absolute select-none block max-w-none will-change-transform"
                        draggable={false}
                        style={{
                          ...commonStyle,
                          left: col * pieceWpx - pad,
                          top: row * pieceHpx - pad,
                          width: cellW,
                          height: cellH,
                        }}
                        initial={false}
                        animate={
                          dropping
                            ? { opacity: 0, x: t!.x, y: t!.y, rotate: t!.rotate }
                            : { opacity: 1, x: 0, y: 0, rotate: 0 }
                        }
                        transition={
                          dropping
                            ? {
                                duration: t!.duration,
                                delay: t!.delay,
                                ease: [0.55, 0.055, 0.675, 0.19],
                              }
                            : { duration: 0 }
                        }
                        onAnimationComplete={() => {
                          if (!dropping || i !== lastIndex) return;
                          window.setTimeout(() => {
                            returnToCamera();
                          }, 280);
                        }}
                      />
                    );
                  })}
                  {!fallStarted ? (
                    <PuzzleShotGridSvgBeveled className="pointer-events-none absolute inset-0 block h-full w-full" />
                  ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {phase === "camera" && !camError ? (
        <div className="p-4 pb-6 flex flex-wrap justify-center items-center gap-3 safe-area-pb">
          <button
            type="button"
            onClick={() => setFacingUser((f) => !f)}
            className="flex items-center gap-2 rounded-full bg-white/15 text-white px-5 py-3 text-sm font-semibold border border-white/25 hover:bg-white/25 active:scale-[0.98] transition-transform"
            aria-label={isKo ? "카메라 전환" : "Switch camera"}
          >
            <SwitchCamera className="w-5 h-5" />
            {isKo ? "전환" : "Flip"}
          </button>
          <button
            type="button"
            onClick={handleCapture}
            className="flex items-center gap-2 rounded-full bg-white text-black px-6 py-3 text-sm font-semibold shadow-lg hover:bg-slate-100 active:scale-[0.98] transition-transform"
          >
            <Camera className="w-5 h-5" />
            {isKo ? "촬영" : "Capture"}
          </button>
        </div>
      ) : null}

      {phase === "playback" ? (
        <div className="pb-5 px-4 flex flex-col items-center gap-3 safe-area-pb">
          {!fallStarted ? (
            <>
              <p className="text-center text-xs text-white/60 max-w-sm">
                {isKo
                  ? "폰을 흔들면 조각이 떨어져요. (PC·센서 없음: 아래 버튼)"
                  : "Shake to drop pieces, or use the button on desktop."}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void requestDeviceMotionPermission();
                    startFall();
                  }}
                  className="rounded-full bg-amber-500/90 text-black px-5 py-2.5 text-sm font-semibold hover:bg-amber-400 active:scale-[0.98] transition-transform"
                >
                  {isKo ? "조각 떨어뜨리기" : "Drop pieces"}
                </button>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="rounded-full bg-white/15 text-white px-5 py-2.5 text-sm font-semibold border border-white/25 hover:bg-white/25 active:scale-[0.98] transition-transform"
                >
                  {isKo ? "다시 찍기" : "Retake"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-center text-xs text-white/45">
              {isKo ? "끝나면 카메라로 돌아갑니다." : "Returning to camera when done."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
