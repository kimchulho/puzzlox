import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, X } from "lucide-react";
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

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function captureBoardCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 2 || vh < 2) return null;

  const targetRatio = PS_BOARD_W / PS_BOARD_H;
  let sx: number;
  let sy: number;
  let sw: number;
  let sh: number;
  if (vw / vh > targetRatio) {
    sh = vh;
    sw = sh * targetRatio;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    sw = vw;
    sh = sw / targetRatio;
    sx = 0;
    sy = (vh - sh) / 2;
  }

  const maxW = 420;
  const W = Math.min(maxW, Math.max(200, Math.floor(sw)));
  const H = Math.round((W * PS_BOARD_H) / PS_BOARD_W);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const r = Math.min(W, H) * 0.045;
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, r);
  ctx.clip();
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
  ctx.restore();

  return canvas;
}

function extractPieceImages(board: HTMLCanvasElement): { urls: string[]; cellW: number; cellH: number } {
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

    ctx.save();
    ctx.translate(-minX, -minY);
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = Math.max(1.2, Math.min(sx, sy) * 1.8);
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = Math.max(1, Math.min(sx, sy) * 1.1);
    ctx.stroke(path);
    ctx.restore();

    try {
      urls.push(c.toDataURL("image/webp", 0.92));
    } catch {
      urls.push(c.toDataURL("image/png"));
    }
  }

  return { urls, cellW: cw, cellH: ch };
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
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [camError, setCamError] = useState<string | null>(null);
  const [pieceUrls, setPieceUrls] = useState<string[]>([]);
  const [cellSize, setCellSize] = useState({ w: 120, h: 120 });
  const [burstKey, setBurstKey] = useState(0);
  const [fitScale, setFitScale] = useState(1);

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
    if (!open) {
      stopStream();
      setPhase("camera");
      setPieceUrls([]);
      setCamError(null);
      return;
    }

    let cancelled = false;
    setCamError(null);

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
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
  }, [open, isKo, stopStream]);

  useLayoutEffect(() => {
    if (!open || phase !== "playback") return;
    const gap = 4;
    const tw = cellSize.w * 2 + gap;
    const th = cellSize.h * 3 + gap * 2;
    const ro = () => {
      const vw = window.innerWidth * 0.9;
      const vh = window.innerHeight * 0.72;
      setFitScale(Math.min(1, vw / Math.max(1, tw), vh / Math.max(1, th)));
    };
    ro();
    window.addEventListener("resize", ro);
    return () => window.removeEventListener("resize", ro);
  }, [open, phase, cellSize, burstKey]);

  const handleCapture = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const board = captureBoardCanvas(v);
    if (!board) return;
    const { urls, cellW, cellH } = extractPieceImages(board);
    setCellSize({ w: cellW, h: cellH });
    setPieceUrls(urls);
    setBurstKey((k) => k + 1);
    setPhase("playback");
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  const pieces = puzzleShotPieceIndexList();
  const lastIndex = pieces.length - 1;

  if (!open) return null;

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

      <div className="flex-1 relative min-h-0 flex items-center justify-center">
        {phase === "camera" && (
          <>
            {camError ? (
              <p className="px-6 text-center text-sm text-amber-200/90">{camError}</p>
            ) : (
              <>
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover"
                  playsInline
                  muted
                  autoPlay
                />
                <div className="relative z-10 w-[min(88vw,calc(88vh*2/3))] aspect-[2/3] pointer-events-none">
                  <svg
                    viewBox={`0 0 ${PS_BOARD_W} ${PS_BOARD_H}`}
                    className="w-full h-full drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {pieces.map(({ col, row }, i) => (
                      <path
                        key={`o-${i}`}
                        d={piecePathSvgD(col, row)}
                        fill="none"
                        stroke="rgba(255,255,255,0.88)"
                        strokeWidth={1.4}
                        vectorEffect="nonScalingStroke"
                      />
                    ))}
                  </svg>
                </div>
              </>
            )}
          </>
        )}

        {phase === "playback" && pieceUrls.length > 0 && (
          <div
            className="relative z-10 flex justify-center items-center w-full h-full px-2"
            style={{ perspective: "900px" }}
          >
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(2, ${cellSize.w}px)`,
                transform: `scale(${fitScale})`,
                transformOrigin: "center center",
              }}
            >
              {pieces.map(({ col, row }, i) => {
                const href = pieceUrls[i];
                if (!href) return null;
                const cx = ((col + 0.5) * PS_PIECE_W) / PS_BOARD_W;
                const cy = ((row + 0.5) * PS_PIECE_H) / PS_BOARD_H;
                return (
                  <motion.img
                    key={`${burstKey}-${i}`}
                    src={href}
                    alt=""
                    width={cellSize.w}
                    height={cellSize.h}
                    className="block select-none rounded-sm"
                    style={{
                      transformOrigin: `${cx * 100}% ${cy * 100}%`,
                      filter:
                        "drop-shadow(0 6px 14px rgba(0,0,0,0.55)) drop-shadow(0 0 2px rgba(255,255,255,0.25))",
                    }}
                    initial={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }}
                    animate={{
                      opacity: 0,
                      rotateX: 68,
                      y: 220,
                      scale: 0.92,
                    }}
                    transition={{
                      duration: 1.15,
                      delay: i * 0.06,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    onAnimationComplete={() => {
                      if (i === lastIndex) {
                        window.setTimeout(() => {
                          setPhase("camera");
                          setPieceUrls([]);
                        }, 350);
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {phase === "camera" && !camError ? (
        <div className="p-4 pb-6 flex justify-center safe-area-pb">
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
        <p className="text-center text-xs text-white/50 pb-3 px-4">
          {isKo ? "조각이 떨어지면 카메라로 돌아갑니다." : "Pieces fall away, then the camera returns."}
        </p>
      ) : null}
    </div>
  );
}
