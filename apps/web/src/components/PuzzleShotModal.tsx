import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

  const maxW = 320;
  const W = Math.min(maxW, Math.max(200, Math.floor(sw)));
  const H = Math.round((W * PS_BOARD_H) / PS_BOARD_W);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);

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

/** 퍼즐판(boardBg)과 비슷한 직사각 테두리 */
const FRAME_BORDER_CLASS =
  "box-border border-[3px] border-black/50 bg-black/[0.12] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]";
/** 촬영 가이드: 고정 CSS 폭만 사용해 뷰포트·주소창 변화에 덜 민감하게 */
const FRAME_CAMERA_BOX_CLASS = `${FRAME_BORDER_CLASS} aspect-[2/3] w-44 sm:w-48 shrink-0`;

function PuzzleShotGridSvg({ className }: { className?: string }) {
  const pieces = puzzleShotPieceIndexList();
  return (
    <svg
      viewBox={`0 0 ${PS_BOARD_W} ${PS_BOARD_H}`}
      className={className ?? "block h-full w-full"}
      preserveAspectRatio="xMidYMid meet"
    >
      {pieces.map(({ col, row }, i) => (
        <path
          key={`o-${i}`}
          d={piecePathSvgD(col, row)}
          fill="none"
          stroke="rgba(255,255,255,0.82)"
          strokeWidth={1.25}
          vectorEffect="nonScalingStroke"
        />
      ))}
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
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [camError, setCamError] = useState<string | null>(null);
  const [pieceUrls, setPieceUrls] = useState<string[]>([]);
  const [burstKey, setBurstKey] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [facingUser, setFacingUser] = useState(true);
  const [boardMetrics, setBoardMetrics] = useState({
    boardW: 200,
    boardH: 300,
    pad: 16,
    pieceWpx: 100,
    pieceHpx: 100,
    cellW: 120,
    cellH: 120,
  });

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
      setFacingUser(true);
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

  const handleCapture = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const board = captureBoardCanvas(v);
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
    setBurstKey((k) => k + 1);
    setPhase("playback");
  }, []);

  const handleRetake = useCallback(() => {
    setPhase("camera");
    setPieceUrls([]);
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  const pieces = puzzleShotPieceIndexList();

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
                <div className="relative z-10 pointer-events-none flex items-center justify-center">
                  <div className={FRAME_CAMERA_BOX_CLASS}>
                    <div className="absolute inset-[3px] overflow-hidden">
                      <PuzzleShotGridSvg />
                    </div>
                  </div>
                </div>
              </>
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
                className="relative"
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
                  return (
                    <img
                      key={`${burstKey}-${i}`}
                      src={href}
                      alt=""
                      width={cellW}
                      height={cellH}
                      className="absolute select-none block max-w-none"
                      draggable={false}
                      style={{
                        left: col * pieceWpx - pad,
                        top: row * pieceHpx - pad,
                        width: cellW,
                        height: cellH,
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
        <div className="pb-5 px-4 flex justify-center safe-area-pb">
          <button
            type="button"
            onClick={handleRetake}
            className="rounded-full bg-white/15 text-white px-6 py-2.5 text-sm font-semibold border border-white/25 hover:bg-white/25 active:scale-[0.98] transition-transform"
          >
            {isKo ? "다시 찍기" : "Retake"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
