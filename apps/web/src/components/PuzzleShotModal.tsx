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

/** 흩어보기 시 조각이 목표 위치로 이동하는 시간(초) */
const SCATTER_MOVE_DURATION_S = 0.55;
const SCATTER_MOVE_EASE: [number, number, number, number] = [0.22, 0.99, 0.36, 1];

type PieceFallTarget = { x: number; y: number; rotate: number; duration: number; delay: number };

type PiecePlayTransform = { x: number; y: number; r: number };

type PuzzleShotTouchDragRef = {
  i: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  tid: number;
  mode: "solo" | "group";
  groupAnchor: number;
};
type PuzzleShotTouchRotateRef = {
  i: number;
  mode: "solo" | "group";
  groupAnchor: number;
  /** 두 손가락 identifier (순서 고정) */
  tidA: number;
  tidB: number;
  ax0: number;
  ay0: number;
  bx0: number;
  by0: number;
  /** 직전 프레임의 (다른 손가락 − 피벗) 방향각(rad), 첫 move 전에는 null */
  prevLineRad: number | null;
  lastNx: number;
  lastNy: number;
  lastNr: number;
  lastPivotSX: number;
  lastPivotSY: number;
  /** 직전 프레임에 A가 피벗이었는지(null이면 아직 없음) */
  prevPivotIsA: boolean | null;
};

type PieceMergeGroup = {
  anchor: number;
  members: number[];
  x: number;
  y: number;
  r: number;
};

type PlaybackFallEntity =
  | { type: "group"; g: PieceMergeGroup }
  | { type: "solo"; i: number };

function touchById(touches: TouchList, id: number): Touch | undefined {
  for (let k = 0; k < touches.length; k++) {
    if (touches[k].identifier === id) return touches[k];
  }
  return undefined;
}

function cloneFallEntitySnapshot(entities: PlaybackFallEntity[]): PlaybackFallEntity[] {
  return entities.map((ent) =>
    ent.type === "group"
      ? {
          type: "group",
          g: {
            anchor: ent.g.anchor,
            members: [...ent.g.members],
            x: ent.g.x,
            y: ent.g.y,
            r: ent.g.r,
          },
        }
      : { type: "solo", i: ent.i }
  );
}

const PUZZLE_SHOT_NEIGHBOR_PAIRS: readonly [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 5],
];

const SNAP_CENTER_ERR_PX = 22;
const SNAP_ROT_DEG = 16;

function unwrapDeg(d: number) {
  let x = d;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function findMergeGroupContaining(groups: PieceMergeGroup[], i: number): PieceMergeGroup | undefined {
  return groups.find((g) => g.members.includes(i));
}

function listPlaybackFallEntities(groups: PieceMergeGroup[], nPiece: number): PlaybackFallEntity[] {
  const used = new Set<number>();
  const out: PlaybackFallEntity[] = [];
  for (const g of groups) {
    out.push({ type: "group", g });
    for (const m of g.members) used.add(m);
  }
  for (let i = 0; i < nPiece; i++) {
    if (!used.has(i)) out.push({ type: "solo", i });
  }
  return out;
}

function worldCenterOfPiece(
  i: number,
  transforms: PiecePlayTransform[],
  groups: PieceMergeGroup[],
  homeLeft: number[],
  homeTop: number[],
  cellW: number,
  cellH: number
): { cx: number; cy: number; r: number } {
  const gr = findMergeGroupContaining(groups, i);
  if (!gr) {
    const t = transforms[i] ?? { x: 0, y: 0, r: 0 };
    return {
      cx: homeLeft[i] + cellW / 2 + t.x,
      cy: homeTop[i] + cellH / 2 + t.y,
      r: t.r,
    };
  }
  const a = gr.anchor;
  const acx = homeLeft[a] + cellW / 2;
  const acy = homeTop[a] + cellH / 2;
  const icx = homeLeft[i] + cellW / 2;
  const icy = homeTop[i] + cellH / 2;
  const vx = icx - acx;
  const vy = icy - acy;
  const rad = (gr.r * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = vx * c - vy * s;
  const ry = vx * s + vy * c;
  return {
    cx: acx + gr.x + rx,
    cy: acy + gr.y + ry,
    r: gr.r,
  };
}

function restCenter(i: number, homeLeft: number[], homeTop: number[], cellW: number, cellH: number) {
  return { cx: homeLeft[i] + cellW / 2, cy: homeTop[i] + cellH / 2 };
}

function trySnapMergeOnePair(
  transforms: PiecePlayTransform[],
  groups: PieceMergeGroup[],
  homeLeft: number[],
  homeTop: number[],
  cellW: number,
  cellH: number
): { transforms: PiecePlayTransform[]; groups: PieceMergeGroup[] } | null {
  const getR = (pi: number) => {
    const g = findMergeGroupContaining(groups, pi);
    return g ? g.r : transforms[pi].r;
  };

  for (const [ia, ib] of PUZZLE_SHOT_NEIGHBOR_PAIRS) {
    const ga = findMergeGroupContaining(groups, ia);
    const gb = findMergeGroupContaining(groups, ib);
    if (ga && gb && ga === gb) continue;

    const Wa = worldCenterOfPiece(ia, transforms, groups, homeLeft, homeTop, cellW, cellH);
    const Wb = worldCenterOfPiece(ib, transforms, groups, homeLeft, homeTop, cellW, cellH);
    const Ca = restCenter(ia, homeLeft, homeTop, cellW, cellH);
    const Cb = restCenter(ib, homeLeft, homeTop, cellW, cellH);
    const dWcx = Wa.cx - Wb.cx;
    const dWcy = Wa.cy - Wb.cy;
    const dCcx = Ca.cx - Cb.cx;
    const dCcy = Ca.cy - Cb.cy;
    const err = Math.hypot(dWcx - dCcx, dWcy - dCcy);
    const ra = getR(ia);
    const rb = getR(ib);
    if (err > SNAP_CENTER_ERR_PX) continue;
    if (Math.abs(unwrapDeg(ra - rb)) > SNAP_ROT_DEG) continue;

    const setA = ga ? [...ga.members] : [ia];
    const setB = gb ? [...gb.members] : [ib];
    const members = [...new Set([...setA, ...setB])].sort((x, y) => x - y);
    const anchor = members[0];
    const rNew = unwrapDeg((ra + rb) / 2);

    let newGroups = groups.filter((g) => g !== ga && g !== gb);

    const WaAnchor = worldCenterOfPiece(anchor, transforms, groups, homeLeft, homeTop, cellW, cellH);
    const nx = WaAnchor.cx - (homeLeft[anchor] + cellW / 2);
    const ny = WaAnchor.cy - (homeTop[anchor] + cellH / 2);

    const newGroup: PieceMergeGroup = { anchor, members, x: nx, y: ny, r: rNew };
    newGroups = [...newGroups, newGroup];

    const newTransforms = transforms.map((t, idx) =>
      members.includes(idx) ? { x: 0, y: 0, r: 0 } : { ...t }
    );

    return { transforms: newTransforms, groups: newGroups };
  }
  return null;
}

function applySnapsUntilStable(
  transforms: PiecePlayTransform[],
  groups: PieceMergeGroup[],
  homeLeft: number[],
  homeTop: number[],
  cellW: number,
  cellH: number
): { transforms: PiecePlayTransform[]; groups: PieceMergeGroup[]; changed: boolean } {
  let t = transforms;
  let g = groups;
  let changed = false;
  for (let k = 0; k < 16; k++) {
    const res = trySnapMergeOnePair(t, g, homeLeft, homeTop, cellW, cellH);
    if (!res) break;
    t = res.transforms;
    g = res.groups;
    changed = true;
  }
  return { transforms: t, groups: g, changed };
}

function entityZKeyForPiece(groups: PieceMergeGroup[], i: number): string {
  const gr = findMergeGroupContaining(groups, i);
  return gr ? `g${gr.anchor}` : `p${i}`;
}

function initialPiecePlayTransforms(): PiecePlayTransform[] {
  return puzzleShotPieceIndexList().map(() => ({ x: 0, y: 0, r: 0 }));
}

function buildScatterTransforms(): PiecePlayTransform[] {
  if (typeof window === "undefined") return initialPiecePlayTransforms();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  return puzzleShotPieceIndexList().map(() => ({
    x: (Math.random() - 0.5) * Math.min(220, vw * 0.44),
    y: (Math.random() - 0.22) * Math.min(260, vh * 0.4),
    r: (Math.random() - 0.5) * 320,
  }));
}

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
  /** 저장(낙하) 시작 시점의 엔티티 목록 — targets 인덱스와 항상 일치 */
  const [fallEntitySnapshot, setFallEntitySnapshot] = useState<PlaybackFallEntity[] | null>(null);
  const [boardMetrics, setBoardMetrics] = useState({
    boardW: 200,
    boardH: 300,
    pad: 16,
    pieceWpx: 100,
    pieceHpx: 100,
    cellW: 120,
    cellH: 120,
  });
  const [scatterMode, setScatterMode] = useState(false);
  /** true면 흩어보기 직후 x/y/r을 부드럽게 보간(이후 드래그는 즉시 반응) */
  const [scatterMoveTween, setScatterMoveTween] = useState(false);
  const [piecePlayTransform, setPiecePlayTransform] = useState<PiecePlayTransform[]>(initialPiecePlayTransforms);
  const [mergeGroups, setMergeGroups] = useState<PieceMergeGroup[]>([]);
  const [entityZMap, setEntityZMap] = useState<Record<string, number>>({});
  const previewScaleRef = useRef(1);
  const pieceTransformRef = useRef<PiecePlayTransform[]>(piecePlayTransform);
  pieceTransformRef.current = piecePlayTransform;
  const mergeGroupsRef = useRef<PieceMergeGroup[]>(mergeGroups);
  mergeGroupsRef.current = mergeGroups;
  const boardMetricsRef = useRef(boardMetrics);
  boardMetricsRef.current = boardMetrics;
  const zSeqRef = useRef(0);
  const scatterMoveEndTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (scatterMoveEndTimerRef.current != null) {
        window.clearTimeout(scatterMoveEndTimerRef.current);
        scatterMoveEndTimerRef.current = null;
      }
      if (fallFallbackTimerRef.current != null) {
        window.clearTimeout(fallFallbackTimerRef.current);
        fallFallbackTimerRef.current = null;
      }
    };
  }, []);

  const touchDragRef = useRef<PuzzleShotTouchDragRef | null>(null);
  const touchRotateRef = useRef<PuzzleShotTouchRotateRef | null>(null);
  const mouseDragRef = useRef<{
    i: number;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    pid: number;
    mode: "solo" | "group";
    groupAnchor: number;
  } | null>(null);

  const fallStartedRef = useRef(false);
  const fallFinishHandledRef = useRef(false);
  const fallFallbackTimerRef = useRef<number | null>(null);
  const returnToCameraRef = useRef<() => void>(() => {});
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

  const trySnapAfterGesture = useCallback(() => {
    const { pieceWpx, pieceHpx, pad, cellW, cellH } = boardMetricsRef.current;
    const plist = puzzleShotPieceIndexList();
    const homeLeft = plist.map(({ col }) => col * pieceWpx - pad);
    const homeTop = plist.map(({ row }) => row * pieceHpx - pad);
    const out = applySnapsUntilStable(
      pieceTransformRef.current,
      mergeGroupsRef.current,
      homeLeft,
      homeTop,
      cellW,
      cellH
    );
    if (out.changed) {
      setPiecePlayTransform(out.transforms);
      setMergeGroups(out.groups);
    }
  }, []);

  const bumpEntityZForPiece = useCallback((pieceIndex: number) => {
    const key = entityZKeyForPiece(mergeGroupsRef.current, pieceIndex);
    zSeqRef.current += 1;
    setEntityZMap((m) => ({ ...m, [key]: zSeqRef.current }));
  }, []);

  const startFall = useCallback(() => {
    if (fallStartedRef.current) return;
    fallStartedRef.current = true;
    fallFinishHandledRef.current = false;
    if (fallFallbackTimerRef.current != null) {
      window.clearTimeout(fallFallbackTimerRef.current);
      fallFallbackTimerRef.current = null;
    }
    const vh = typeof window !== "undefined" ? window.innerHeight : 700;
    const vw = typeof window !== "undefined" ? window.innerWidth : 400;
    const nPiece = puzzleShotPieceIndexList().length;
    const entities = listPlaybackFallEntities(mergeGroupsRef.current, nPiece);
    setFallEntitySnapshot(cloneFallEntitySnapshot(entities));
    const targets = entities.map((_, idx) => ({
      x: (Math.random() - 0.5) * Math.min(160, vw * 0.35),
      y: vh * 0.55 + Math.random() * vh * 0.28,
      rotate: (Math.random() - 0.5) * 260,
      duration: 1.0 + (idx % 3) * 0.09 + Math.random() * 0.12,
      delay: idx * 0.04 + Math.random() * 0.07,
    }));
    setFallTargets(targets);
    setFallStarted(true);
    const maxEndMs =
      targets.reduce((acc, t) => Math.max(acc, (t.delay + t.duration) * 1000), 0) + 900;
    fallFallbackTimerRef.current = window.setTimeout(() => {
      fallFallbackTimerRef.current = null;
      if (fallFinishHandledRef.current) return;
      fallFinishHandledRef.current = true;
      returnToCameraRef.current();
    }, maxEndMs);
  }, []);

  useEffect(() => {
    fallStartedRef.current = fallStarted;
  }, [fallStarted]);

  useEffect(() => {
    if (scatterMoveEndTimerRef.current != null) {
      window.clearTimeout(scatterMoveEndTimerRef.current);
      scatterMoveEndTimerRef.current = null;
    }
    setPiecePlayTransform(initialPiecePlayTransforms());
    setScatterMode(false);
    setScatterMoveTween(false);
    setMergeGroups([]);
    setEntityZMap({});
    setFallEntitySnapshot(null);
    fallFinishHandledRef.current = false;
    if (fallFallbackTimerRef.current != null) {
      window.clearTimeout(fallFallbackTimerRef.current);
      fallFallbackTimerRef.current = null;
    }
  }, [burstKey]);

  const clearScatterMoveTween = useCallback(() => {
    if (scatterMoveEndTimerRef.current != null) {
      window.clearTimeout(scatterMoveEndTimerRef.current);
      scatterMoveEndTimerRef.current = null;
    }
    setScatterMoveTween((v) => (v ? false : v));
  }, []);

  const startScatter = useCallback(() => {
    if (fallStartedRef.current) return;
    if (scatterMoveEndTimerRef.current != null) {
      window.clearTimeout(scatterMoveEndTimerRef.current);
      scatterMoveEndTimerRef.current = null;
    }
    setScatterMoveTween(true);
    setMergeGroups([]);
    setPiecePlayTransform(buildScatterTransforms());
    setScatterMode(true);
    scatterMoveEndTimerRef.current = window.setTimeout(() => {
      scatterMoveEndTimerRef.current = null;
      setScatterMoveTween(false);
    }, Math.round(SCATTER_MOVE_DURATION_S * 1000) + 80);
  }, []);

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
      startScatter();
    };

    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [open, phase, fallStarted, burstKey, startScatter]);

  useEffect(() => {
    if (!open) {
      if (scatterMoveEndTimerRef.current != null) {
        window.clearTimeout(scatterMoveEndTimerRef.current);
        scatterMoveEndTimerRef.current = null;
      }
      if (fallFallbackTimerRef.current != null) {
        window.clearTimeout(fallFallbackTimerRef.current);
        fallFallbackTimerRef.current = null;
      }
      fallFinishHandledRef.current = false;
      setFallEntitySnapshot(null);
      setScatterMoveTween(false);
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
    if (scatterMoveEndTimerRef.current != null) {
      window.clearTimeout(scatterMoveEndTimerRef.current);
      scatterMoveEndTimerRef.current = null;
    }
    if (fallFallbackTimerRef.current != null) {
      window.clearTimeout(fallFallbackTimerRef.current);
      fallFallbackTimerRef.current = null;
    }
    fallFinishHandledRef.current = false;
    setFallEntitySnapshot(null);
    setScatterMoveTween(false);
    setPhase("camera");
    setPieceUrls([]);
    setFallStarted(false);
    fallStartedRef.current = false;
    setFallTargets([]);
    setScatterMode(false);
    setPiecePlayTransform(initialPiecePlayTransforms());
    setMergeGroups([]);
    setEntityZMap({});
  }, []);

  returnToCameraRef.current = returnToCamera;

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
      if (fallFallbackTimerRef.current != null) {
        window.clearTimeout(fallFallbackTimerRef.current);
        fallFallbackTimerRef.current = null;
      }
      fallFinishHandledRef.current = false;
      setFallEntitySnapshot(null);
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

  const onPieceMousePointerDown = useCallback(
    (e: React.PointerEvent, i: number) => {
      if (fallStarted || !scatterMode) return;
      if (e.pointerType === "touch") return;
      e.preventDefault();
      clearScatterMoveTween();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      bumpEntityZForPiece(i);
      const gr = findMergeGroupContaining(mergeGroupsRef.current, i);
      if (gr) {
        mouseDragRef.current = {
          i,
          sx: e.clientX,
          sy: e.clientY,
          ox: gr.x,
          oy: gr.y,
          pid: e.pointerId,
          mode: "group",
          groupAnchor: gr.anchor,
        };
      } else {
        const pt = pieceTransformRef.current[i];
        mouseDragRef.current = {
          i,
          sx: e.clientX,
          sy: e.clientY,
          ox: pt.x,
          oy: pt.y,
          pid: e.pointerId,
          mode: "solo",
          groupAnchor: i,
        };
      }
    },
    [fallStarted, scatterMode, bumpEntityZForPiece, clearScatterMoveTween]
  );

  const onPieceMousePointerMove = useCallback((e: React.PointerEvent, i: number) => {
    const d = mouseDragRef.current;
    if (!d || d.i !== i || d.pid !== e.pointerId) return;
    const s = previewScaleRef.current;
    if (s < 1e-6) return;
    const dx = (e.clientX - d.sx) / s;
    const dy = (e.clientY - d.sy) / s;
    if (d.mode === "group") {
      const a = d.groupAnchor;
      setMergeGroups((gs) =>
        gs.map((g) => (g.anchor === a ? { ...g, x: d.ox + dx, y: d.oy + dy } : g))
      );
    } else {
      setPiecePlayTransform((prev) => {
        const n = [...prev];
        n[i] = { ...n[i], x: d.ox + dx, y: d.oy + dy };
        return n;
      });
    }
  }, []);

  const onPieceMousePointerUp = useCallback(
    (e: React.PointerEvent, i: number) => {
      const d = mouseDragRef.current;
      if (!d || d.i !== i || d.pid !== e.pointerId) return;
      mouseDragRef.current = null;
      trySnapAfterGesture();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [trySnapAfterGesture]
  );

  const onPieceLostPointerCapture = useCallback(
    (e: React.PointerEvent, i: number) => {
      const d = mouseDragRef.current;
      if (d?.i === i && d.pid === e.pointerId) {
        mouseDragRef.current = null;
        trySnapAfterGesture();
      }
    },
    [trySnapAfterGesture]
  );

  const onPieceTouchStart = useCallback(
    (e: React.TouchEvent, i: number) => {
      if (fallStarted || !scatterMode) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        clearScatterMoveTween();
        touchDragRef.current = null;
        bumpEntityZForPiece(i);
        const a = e.touches[0];
        const b = e.touches[1];
        const gr = findMergeGroupContaining(mergeGroupsRef.current, i);
        if (gr) {
          touchRotateRef.current = {
            i,
            mode: "group",
            groupAnchor: gr.anchor,
            tidA: a.identifier,
            tidB: b.identifier,
            ax0: a.clientX,
            ay0: a.clientY,
            bx0: b.clientX,
            by0: b.clientY,
            prevLineRad: null,
            lastNx: gr.x,
            lastNy: gr.y,
            lastNr: gr.r,
            lastPivotSX: a.clientX,
            lastPivotSY: a.clientY,
            prevPivotIsA: null,
          };
        } else {
          const pt = pieceTransformRef.current[i];
          touchRotateRef.current = {
            i,
            mode: "solo",
            groupAnchor: i,
            tidA: a.identifier,
            tidB: b.identifier,
            ax0: a.clientX,
            ay0: a.clientY,
            bx0: b.clientX,
            by0: b.clientY,
            prevLineRad: null,
            lastNx: pt.x,
            lastNy: pt.y,
            lastNr: pt.r,
            lastPivotSX: a.clientX,
            lastPivotSY: a.clientY,
            prevPivotIsA: null,
          };
        }
        return;
      }
      if (e.touches.length === 1) {
        clearScatterMoveTween();
        bumpEntityZForPiece(i);
        const t = e.touches[0];
        const gr = findMergeGroupContaining(mergeGroupsRef.current, i);
        if (gr) {
          touchDragRef.current = {
            i,
            sx: t.clientX,
            sy: t.clientY,
            ox: gr.x,
            oy: gr.y,
            tid: t.identifier,
            mode: "group",
            groupAnchor: gr.anchor,
          };
        } else {
          const pt = pieceTransformRef.current[i];
          touchDragRef.current = {
            i,
            sx: t.clientX,
            sy: t.clientY,
            ox: pt.x,
            oy: pt.y,
            tid: t.identifier,
            mode: "solo",
            groupAnchor: i,
          };
        }
      }
    },
    [fallStarted, scatterMode, bumpEntityZForPiece, clearScatterMoveTween]
  );

  const onPieceTouchMove = useCallback(
    (e: React.TouchEvent, i: number) => {
      if (fallStarted) return;
      const rot = touchRotateRef.current;
      if (rot && rot.i === i && e.touches.length >= 2) {
        e.preventDefault();
        const ta = touchById(e.touches, rot.tidA);
        const tb = touchById(e.touches, rot.tidB);
        if (!ta || !tb) return;
        const d0 = Math.hypot(ta.clientX - rot.ax0, ta.clientY - rot.ay0);
        const d1 = Math.hypot(tb.clientX - rot.bx0, tb.clientY - rot.by0);
        const pivotIsA = d0 <= d1;
        const Px = pivotIsA ? ta.clientX : tb.clientX;
        const Py = pivotIsA ? ta.clientY : tb.clientY;
        const Qx = pivotIsA ? tb.clientX : ta.clientX;
        const Qy = pivotIsA ? tb.clientY : ta.clientY;
        const lineRad = Math.atan2(Qy - Py, Qx - Px);
        const s = previewScaleRef.current;
        if (s < 1e-6) return;
        if (rot.prevLineRad === null) {
          rot.prevLineRad = lineRad;
          rot.lastPivotSX = Px;
          rot.lastPivotSY = Py;
          rot.prevPivotIsA = pivotIsA;
          return;
        }
        if (rot.prevPivotIsA !== null && pivotIsA !== rot.prevPivotIsA) {
          rot.prevLineRad = lineRad;
          rot.prevPivotIsA = pivotIsA;
          rot.lastPivotSX = Px;
          rot.lastPivotSY = Py;
          return;
        }
        rot.prevPivotIsA = pivotIsA;
        let dRad = lineRad - rot.prevLineRad;
        if (dRad > Math.PI) dRad -= 2 * Math.PI;
        if (dRad < -Math.PI) dRad += 2 * Math.PI;
        rot.prevLineRad = lineRad;
        const deltaDeg = (dRad * 180) / Math.PI;
        const nx = rot.lastNx + (Px - rot.lastPivotSX) / s;
        const ny = rot.lastNy + (Py - rot.lastPivotSY) / s;
        const nr = rot.lastNr + deltaDeg;
        rot.lastNx = nx;
        rot.lastNy = ny;
        rot.lastNr = nr;
        rot.lastPivotSX = Px;
        rot.lastPivotSY = Py;
        if (rot.mode === "group") {
          const a = rot.groupAnchor;
          setMergeGroups((gs) =>
            gs.map((g) => (g.anchor === a ? { ...g, x: nx, y: ny, r: nr } : g))
          );
        } else {
          setPiecePlayTransform((prev) => {
            const n = [...prev];
            n[i] = { ...n[i], x: nx, y: ny, r: nr };
            return n;
          });
        }
        return;
      }
      const d = touchDragRef.current;
      if (!d || d.i !== i || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.identifier !== d.tid) return;
      e.preventDefault();
      const s = previewScaleRef.current;
      if (s < 1e-6) return;
      const dx = (t.clientX - d.sx) / s;
      const dy = (t.clientY - d.sy) / s;
      if (d.mode === "group") {
        const a = d.groupAnchor;
        setMergeGroups((gs) =>
          gs.map((g) => (g.anchor === a ? { ...g, x: d.ox + dx, y: d.oy + dy } : g))
        );
      } else {
        setPiecePlayTransform((prev) => {
          const n = [...prev];
          n[i] = { ...n[i], x: d.ox + dx, y: d.oy + dy };
          return n;
        });
      }
    },
    [fallStarted]
  );

  const onPieceTouchEnd = useCallback(
    (e: React.TouchEvent, i: number) => {
      let didEndRotate = false;
      if (touchRotateRef.current?.i === i && e.touches.length < 2) {
        touchRotateRef.current = null;
        didEndRotate = true;
      }
      const d = touchDragRef.current;
      if (d?.i === i && e.touches.length === 0) {
        touchDragRef.current = null;
        trySnapAfterGesture();
      } else if (didEndRotate) {
        trySnapAfterGesture();
      }
    },
    [trySnapAfterGesture]
  );

  const pieces = puzzleShotPieceIndexList();
  const nPieces = pieces.length;
  const playbackHomeLeft = pieces.map(({ col }) => col * boardMetrics.pieceWpx - boardMetrics.pad);
  const playbackHomeTop = pieces.map(({ row }) => row * boardMetrics.pieceHpx - boardMetrics.pad);
  const groupedForPlayback = useMemo(() => {
    const s = new Set<number>();
    for (const gr of mergeGroups) for (const m of gr.members) s.add(m);
    return s;
  }, [mergeGroups]);
  const fallEntityList = useMemo(
    () => listPlaybackFallEntities(mergeGroups, nPieces),
    [mergeGroups, nPieces]
  );
  const fallRenderList = fallEntitySnapshot ?? fallEntityList;
  const lastFallEntityIdx = fallRenderList.length - 1;

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
  previewScaleRef.current = previewScale;

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
                  overflow: fallStarted || scatterMode ? "visible" : "hidden",
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
                  {fallStarted
                    ? fallRenderList.map((ent, fi) => {
                        const t = fallTargets[fi];
                        if (ent.type === "solo") {
                          const i = ent.i;
                          const { col, row } = pieces[i];
                          const href = pieceUrls[i];
                          if (!href) return null;
                          const cx = ((col + 0.5) * PS_PIECE_W) / PS_BOARD_W;
                          const cy = ((row + 0.5) * PS_PIECE_H) / PS_BOARD_H;
                          const dropping = Boolean(t);
                          const pt = piecePlayTransform[i] ?? { x: 0, y: 0, r: 0 };
                          const zk = `p${i}`;
                          const restPose = {
                            opacity: 1,
                            x: pt.x,
                            y: pt.y,
                            rotate: pt.r,
                          } as const;
                          return (
                            <motion.img
                              key={`${burstKey}-fall-s-${i}`}
                              src={href}
                              alt=""
                              width={cellW}
                              height={cellH}
                              className="absolute touch-none select-none block max-w-none will-change-transform"
                              draggable={false}
                              style={{
                                transformOrigin: `${cx * 100}% ${cy * 100}%`,
                                left: playbackHomeLeft[i],
                                top: playbackHomeTop[i],
                                width: cellW,
                                height: cellH,
                                zIndex: 12 + (entityZMap[zk] ?? 0),
                                pointerEvents: "none",
                              }}
                              initial={restPose}
                              animate={
                                dropping && t
                                  ? {
                                      opacity: 0,
                                      x: pt.x + t.x,
                                      y: pt.y + t.y,
                                      rotate: pt.r + t.rotate,
                                    }
                                  : restPose
                              }
                              transition={
                                dropping && t
                                  ? {
                                      duration: t.duration,
                                      delay: t.delay,
                                      ease: [0.55, 0.055, 0.675, 0.19],
                                    }
                                  : { duration: 0 }
                              }
                              onAnimationComplete={() => {
                                if (!dropping || fi !== lastFallEntityIdx) return;
                                if (fallFinishHandledRef.current) return;
                                fallFinishHandledRef.current = true;
                                if (fallFallbackTimerRef.current != null) {
                                  window.clearTimeout(fallFallbackTimerRef.current);
                                  fallFallbackTimerRef.current = null;
                                }
                                window.setTimeout(() => {
                                  returnToCamera();
                                }, 280);
                              }}
                            />
                          );
                        }
                        const g = ent.g;
                        const dropping = Boolean(t);
                        const zk = `g${g.anchor}`;
                        const groupRestPose = {
                          opacity: 1,
                          x: g.x,
                          y: g.y,
                          rotate: g.r,
                        } as const;
                        return (
                          <motion.div
                            key={`${burstKey}-fall-g-${g.anchor}`}
                            className="absolute touch-none select-none will-change-transform"
                            style={{
                              left: playbackHomeLeft[g.anchor],
                              top: playbackHomeTop[g.anchor],
                              transformOrigin: `${cellW / 2}px ${cellH / 2}px`,
                              zIndex: 12 + (entityZMap[zk] ?? 0),
                              overflow: "visible",
                              pointerEvents: "none",
                            }}
                            initial={groupRestPose}
                            animate={
                              dropping && t
                                ? {
                                    opacity: 0,
                                    x: g.x + t.x,
                                    y: g.y + t.y,
                                    rotate: g.r + t.rotate,
                                  }
                                : groupRestPose
                            }
                            transition={
                              dropping && t
                                ? {
                                    duration: t.duration,
                                    delay: t.delay,
                                    ease: [0.55, 0.055, 0.675, 0.19],
                                  }
                                : { duration: 0 }
                            }
                            onAnimationComplete={() => {
                              if (!dropping || fi !== lastFallEntityIdx) return;
                              if (fallFinishHandledRef.current) return;
                              fallFinishHandledRef.current = true;
                              if (fallFallbackTimerRef.current != null) {
                                window.clearTimeout(fallFallbackTimerRef.current);
                                fallFallbackTimerRef.current = null;
                              }
                              window.setTimeout(() => {
                                returnToCamera();
                              }, 280);
                            }}
                          >
                            {g.members.map((m) => {
                              const { col, row } = pieces[m];
                              const href = pieceUrls[m];
                              if (!href) return null;
                              const cx = ((col + 0.5) * PS_PIECE_W) / PS_BOARD_W;
                              const cy = ((row + 0.5) * PS_PIECE_H) / PS_BOARD_H;
                              return (
                                <img
                                  key={`${burstKey}-fall-g${g.anchor}-m${m}`}
                                  src={href}
                                  alt=""
                                  width={cellW}
                                  height={cellH}
                                  className="absolute block max-w-none select-none pointer-events-none"
                                  draggable={false}
                                  style={{
                                    transformOrigin: `${cx * 100}% ${cy * 100}%`,
                                    left: playbackHomeLeft[m] - playbackHomeLeft[g.anchor],
                                    top: playbackHomeTop[m] - playbackHomeTop[g.anchor],
                                    width: cellW,
                                    height: cellH,
                                  }}
                                />
                              );
                            })}
                          </motion.div>
                        );
                      })
                    : (
                      <>
                        {mergeGroups.map((g) => {
                          const zk = `g${g.anchor}`;
                          return (
                            <motion.div
                              key={`${burstKey}-grp-${g.anchor}`}
                              className="absolute touch-none select-none will-change-transform"
                              style={{
                                left: playbackHomeLeft[g.anchor],
                                top: playbackHomeTop[g.anchor],
                                transformOrigin: `${cellW / 2}px ${cellH / 2}px`,
                                zIndex: 12 + (entityZMap[zk] ?? 0),
                                overflow: "visible",
                                pointerEvents: "none",
                              }}
                              initial={false}
                              animate={{ x: g.x, y: g.y, rotate: g.r }}
                              transition={
                                scatterMoveTween
                                  ? { duration: SCATTER_MOVE_DURATION_S, ease: SCATTER_MOVE_EASE }
                                  : { duration: 0 }
                              }
                            >
                              {g.members.map((m) => {
                                const { col, row } = pieces[m];
                                const href = pieceUrls[m];
                                if (!href) return null;
                                const cx = ((col + 0.5) * PS_PIECE_W) / PS_BOARD_W;
                                const cy = ((row + 0.5) * PS_PIECE_H) / PS_BOARD_H;
                                return (
                                  <motion.img
                                    key={`${burstKey}-gm-${g.anchor}-${m}`}
                                    src={href}
                                    alt=""
                                    width={cellW}
                                    height={cellH}
                                    className="absolute touch-none select-none block max-w-none will-change-transform"
                                    draggable={false}
                                    style={{
                                      transformOrigin: `${cx * 100}% ${cy * 100}%`,
                                      left: playbackHomeLeft[m] - playbackHomeLeft[g.anchor],
                                      top: playbackHomeTop[m] - playbackHomeTop[g.anchor],
                                      width: cellW,
                                      height: cellH,
                                      pointerEvents: scatterMode ? "auto" : "none",
                                      cursor: scatterMode ? "grab" : undefined,
                                    }}
                                    initial={false}
                                    animate={{ opacity: 1 }}
                                    transition={{ duration: 0 }}
                                    onPointerDown={(e) => onPieceMousePointerDown(e, m)}
                                    onPointerMove={(e) => onPieceMousePointerMove(e, m)}
                                    onPointerUp={(e) => onPieceMousePointerUp(e, m)}
                                    onPointerCancel={(e) => onPieceMousePointerUp(e, m)}
                                    onLostPointerCapture={(e) => onPieceLostPointerCapture(e, m)}
                                    onTouchStart={(e) => onPieceTouchStart(e, m)}
                                    onTouchMove={(e) => onPieceTouchMove(e, m)}
                                    onTouchEnd={(e) => onPieceTouchEnd(e, m)}
                                  />
                                );
                              })}
                            </motion.div>
                          );
                        })}
                        {pieces.map(({ col, row }, i) => {
                          if (groupedForPlayback.has(i)) return null;
                          const href = pieceUrls[i];
                          if (!href) return null;
                          const cx = ((col + 0.5) * PS_PIECE_W) / PS_BOARD_W;
                          const cy = ((row + 0.5) * PS_PIECE_H) / PS_BOARD_H;
                          const pt = piecePlayTransform[i] ?? { x: 0, y: 0, r: 0 };
                          const zk = `p${i}`;
                          return (
                            <motion.img
                              key={`${burstKey}-solo-${i}`}
                              src={href}
                              alt=""
                              width={cellW}
                              height={cellH}
                              className="absolute touch-none select-none block max-w-none will-change-transform"
                              draggable={false}
                              style={{
                                transformOrigin: `${cx * 100}% ${cy * 100}%`,
                                left: playbackHomeLeft[i],
                                top: playbackHomeTop[i],
                                width: cellW,
                                height: cellH,
                                zIndex: 12 + (entityZMap[zk] ?? 0),
                                cursor: scatterMode ? "grab" : undefined,
                              }}
                              initial={false}
                              animate={{ opacity: 1, x: pt.x, y: pt.y, rotate: pt.r }}
                              transition={
                                scatterMoveTween
                                  ? { duration: SCATTER_MOVE_DURATION_S, ease: SCATTER_MOVE_EASE }
                                  : { duration: 0 }
                              }
                              onPointerDown={(e) => onPieceMousePointerDown(e, i)}
                              onPointerMove={(e) => onPieceMousePointerMove(e, i)}
                              onPointerUp={(e) => onPieceMousePointerUp(e, i)}
                              onPointerCancel={(e) => onPieceMousePointerUp(e, i)}
                              onLostPointerCapture={(e) => onPieceLostPointerCapture(e, i)}
                              onTouchStart={(e) => onPieceTouchStart(e, i)}
                              onTouchMove={(e) => onPieceTouchMove(e, i)}
                              onTouchEnd={(e) => onPieceTouchEnd(e, i)}
                            />
                          );
                        })}
                      </>
                    )}
                  {!fallStarted && !scatterMode ? (
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
                  ? "폰을 흔들면 조각이 흩어집니다. 한 손가락으로 이동, 두 손가락으로는 덜 움직이는 손가락을 축으로 다른 손가락 방향으로 회전·이동할 수 있습니다. 맞닿는 조각은 위치·각도가 가까우면 붙습니다. 저장은 떨어지는 연출만 합니다(파일 저장 없음)."
                  : "Shake to scatter. One finger drags; with two fingers, the finger that moves less acts as the pivot while the other rotates around it (with pan). Neighbors snap when aligned. Save plays the drop animation only (no file saved)."}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void requestDeviceMotionPermission();
                    startScatter();
                  }}
                  className="rounded-full bg-amber-500/90 text-black px-5 py-2.5 text-sm font-semibold hover:bg-amber-400 active:scale-[0.98] transition-transform"
                >
                  {isKo ? "흩어보기" : "Scatter"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void requestDeviceMotionPermission();
                    startFall();
                  }}
                  className="rounded-full bg-white text-black px-5 py-2.5 text-sm font-semibold hover:bg-slate-100 active:scale-[0.98] transition-transform"
                >
                  {isKo ? "저장" : "Save"}
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
