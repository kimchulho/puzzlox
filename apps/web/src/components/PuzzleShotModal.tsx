import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, SwitchCamera, X } from "lucide-react";
import {
  PS_BOARD_H,
  PS_BOARD_W,
  PS_PIECE_H,
  PS_PIECE_W,
  buildPiecePath2D,
  piecePathSvgD,
  puzzleShotPieceIndexList,
} from "../lib/puzzleShotGrid";

type Phase = "camera" | "playback";

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

/**
 * 화면에 보이는 퍼즐 프레임(내부 2:3 영역)과 동일한 구간을 비디오에서 잘라 보드로 그립니다.
 * `frameEl`은 프레임 안쪽(테두리 안 퍼즐 홀) DOM 요소.
 */
function captureBoardCanvasFromFrame(video: HTMLVideoElement, frameEl: HTMLElement): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 2 || vh < 2) return null;

  const vRect = video.getBoundingClientRect();
  const fRect = frameEl.getBoundingClientRect();

  const ix = Math.max(fRect.left, vRect.left);
  const iy = Math.max(fRect.top, vRect.top);
  const ix2 = Math.min(fRect.right, vRect.right);
  const iy2 = Math.min(fRect.bottom, vRect.bottom);
  const rw = Math.max(0, ix2 - ix);
  const rh = Math.max(0, iy2 - iy);
  if (rw < 2 || rh < 2) return null;

  const rx = ix - vRect.left;
  const ry = iy - vRect.top;
  const Dw = vRect.width;
  const Dh = vRect.height;
  if (Dw < 2 || Dh < 2) return null;

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

  const maxW = 400;
  const W = Math.min(maxW, Math.max(160, Math.round(uw)));
  const H = Math.round((W * PS_BOARD_H) / PS_BOARD_W);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, u0, v0, uw, uh, 0, 0, W, H);
  return canvas;
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
  const pieceW = Math.ceil(PS_PIECE_W * sx);
  const pieceH = Math.ceil(PS_PIECE_H * sy);
  const cw = pieceW + 2 * pad;
  const ch = pieceH + 2 * pad;
  const pieceWpx = (PS_PIECE_W * W) / PS_BOARD_W;
  const pieceHpx = (PS_PIECE_H * H) / PS_BOARD_H;
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

const FRAME_BORDER_CLASS =
  "box-border border-[3px] border-black/50 bg-black/[0.12] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]";
/** 1.5× (w-44→264px, sm:w-48→288px) */
const FRAME_CAMERA_BOX_CLASS = `${FRAME_BORDER_CLASS} aspect-[2/3] w-[264px] sm:w-[288px] shrink-0`;

/** 촬영 화면 격자 — 확인 화면 베벨과 같은 구조를 SVG로 */
function PuzzleShotGridSvgBeveled({ className }: { className?: string }) {
  const reactId = useId();
  const blurId = `psf-blur-${reactId.replace(/:/g, "")}`;
  const pieces = puzzleShotPieceIndexList();

  return (
    <svg
      viewBox={`0 0 ${PS_BOARD_W} ${PS_BOARD_H}`}
      className={className ?? "block h-full w-full"}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={blurId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.85" />
        </filter>
      </defs>
      {pieces.map(({ col, row }, i) => {
        const d = piecePathSvgD(col, row);
        return (
          <g key={`g-${i}`}>
            <path
              d={d}
              fill="none"
              stroke="rgba(0,0,0,0.22)"
              strokeWidth={1.15}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <g filter={`url(#${blurId})`} opacity={0.88}>
              <path
                d={d}
                fill="none"
                stroke="rgba(255,255,255,0.58)"
                strokeWidth={0.95}
                strokeLinejoin="round"
                strokeLinecap="round"
                transform="translate(1.15, 1.15)"
              />
              <path
                d={d}
                fill="none"
                stroke="rgba(0,0,0,0.58)"
                strokeWidth={0.95}
                strokeLinejoin="round"
                strokeLinecap="round"
                transform="translate(-1.15, -1.15)"
              />
            </g>
            <path
              d={d}
              fill="none"
              stroke="rgba(255,255,255,0.78)"
              strokeWidth={0.65}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="nonScalingStroke"
            />
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
  const puzzleHoleRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [camError, setCamError] = useState<string | null>(null);
  const [pieceUrls, setPieceUrls] = useState<string[]>([]);
  const [burstKey, setBurstKey] = useState(0);
  const [fitScale, setFitScale] = useState(1);
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

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        t.stop();
      }
      streamRef.current = null;
    }
  }, []);

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
    if (!open || phase !== "playback") return;
    const { boardW, boardH } = boardMetrics;
    const ro = () => {
      const vw = window.innerWidth * 0.88;
      const vh = window.innerHeight * 0.62;
      setFitScale(Math.min(1, vw / Math.max(1, boardW), vh / Math.max(1, boardH)));
    };
    ro();
    window.addEventListener("resize", ro);
    return () => window.removeEventListener("resize", ro);
  }, [open, phase, boardMetrics.boardW, boardMetrics.boardH, burstKey]);

  const returnToCamera = useCallback(() => {
    setPhase("camera");
    setPieceUrls([]);
    setFallStarted(false);
    fallStartedRef.current = false;
    setFallTargets([]);
  }, []);

  const handleCapture = useCallback(() => {
    const v = videoRef.current;
    const hole = puzzleHoleRef.current;
    if (!v) return;
    void requestDeviceMotionPermission();
    const board = hole ? captureBoardCanvasFromFrame(v, hole) : null;
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
                <div className={FRAME_CAMERA_BOX_CLASS}>
                  <div ref={puzzleHoleRef} className="absolute inset-[3px] overflow-hidden">
                    <PuzzleShotGridSvgBeveled />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {phase === "playback" && pieceUrls.length > 0 && (
          <div className="relative z-10 flex items-center justify-center">
            <div
              className={`${FRAME_BORDER_CLASS} overflow-hidden shrink-0`}
              style={{
                width: boardW * fitScale + 6,
                height: boardH * fitScale + 6,
              }}
            >
              <div
                className="relative overflow-visible"
                style={{
                  width: boardW,
                  height: boardH,
                  transform: `scale(${fitScale})`,
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
