/** 2×3 퍼즐샷 POC — 보드 논리 단위 (참고 레이아웃과 맞춘 고정 탭) */
export const PS_COLS = 2;
export const PS_ROWS = 3;
export const PS_PIECE_W = 100;
export const PS_PIECE_H = 100;
export const PS_BOARD_W = PS_PIECE_W * PS_COLS;
export const PS_BOARD_H = PS_PIECE_H * PS_ROWS;

/** row 경계 r ↔ r+1, 각 col */
export const PS_HORIZONTAL_TABS: number[][] = [
  [-1, 1],
  [-1, 1],
];

/** col 경계 c ↔ c+1, 각 row */
export const PS_VERTICAL_TABS: number[][] = [[1], [1], [1]];

function appendEdgePath2D(
  path: Path2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tabType: number,
  tabDepth: number
) {
  if (tabType === 0) {
    path.lineTo(x2, y2);
    return;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return;
  const nx = dy / len;
  const ny = -dx / len;
  const pt = (t: number, d: number) => {
    const px = x1 + t * dx + tabType * (d / 0.2) * tabDepth * nx;
    const py = y1 + t * dy + tabType * (d / 0.2) * tabDepth * ny;
    return { x: px, y: py };
  };
  const b = (t1: number, d1: number, t2: number, d2: number, t3: number, d3: number) => {
    const p1 = pt(t1, d1);
    const p2 = pt(t2, d2);
    const p3 = pt(t3, d3);
    path.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  };
  b(0.193, 0, 0.39, -0.127, 0.393, -0.045);
  b(0.396, 0.038, 0.329, 0.066, 0.329, 0.118);
  b(0.329, 0.171, 0.373, 0.195, 0.5, 0.195);
  b(0.627, 0.195, 0.671, 0.171, 0.671, 0.118);
  b(0.671, 0.066, 0.604, 0.038, 0.607, -0.045);
  b(0.61, -0.127, 0.807, 0, 1.0, 0);
}

export function buildPiecePath2D(col: number, row: number, sx: number, sy: number): Path2D {
  const pw = PS_PIECE_W * sx;
  const ph = PS_PIECE_H * sy;
  const ox = col * PS_PIECE_W * sx;
  const oy = row * PS_PIECE_H * sy;
  const tabDepth = Math.min(PS_PIECE_W, PS_PIECE_H) * 0.2 * Math.min(sx, sy);
  const topTab = row === 0 ? 0 : -PS_HORIZONTAL_TABS[row - 1]![col]!;
  const rightTab = col === PS_COLS - 1 ? 0 : PS_VERTICAL_TABS[row]![col]!;
  const bottomTab = row === PS_ROWS - 1 ? 0 : PS_HORIZONTAL_TABS[row]![col]!;
  const leftTab = col === 0 ? 0 : -PS_VERTICAL_TABS[row]![col - 1]!;

  const path = new Path2D();
  path.moveTo(ox, oy);
  appendEdgePath2D(path, ox, oy, ox + pw, oy, topTab, tabDepth);
  appendEdgePath2D(path, ox + pw, oy, ox + pw, oy + ph, rightTab, tabDepth);
  appendEdgePath2D(path, ox + pw, oy + ph, ox, oy + ph, bottomTab, tabDepth);
  appendEdgePath2D(path, ox, oy + ph, ox, oy, leftTab, tabDepth);
  path.closePath();
  return path;
}

function appendEdgeSvg(
  parts: string[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tabType: number,
  tabDepth: number,
  move: boolean
) {
  if (tabType === 0) {
    if (move) parts.push(`M ${x1} ${y1}`);
    parts.push(`L ${x2} ${y2}`);
    return;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return;
  const nx = dy / len;
  const ny = -dx / len;
  const pt = (t: number, d: number) => {
    const px = x1 + t * dx + tabType * (d / 0.2) * tabDepth * nx;
    const py = y1 + t * dy + tabType * (d / 0.2) * tabDepth * ny;
    return `${px} ${py}`;
  };
  if (move) parts.push(`M ${x1} ${y1}`);
  parts.push(`C ${pt(0.193, 0)} ${pt(0.39, -0.127)} ${pt(0.393, -0.045)}`);
  parts.push(`C ${pt(0.396, 0.038)} ${pt(0.329, 0.066)} ${pt(0.329, 0.118)}`);
  parts.push(`C ${pt(0.329, 0.171)} ${pt(0.373, 0.195)} ${pt(0.5, 0.195)}`);
  parts.push(`C ${pt(0.627, 0.195)} ${pt(0.671, 0.171)} ${pt(0.671, 0.118)}`);
  parts.push(`C ${pt(0.671, 0.066)} ${pt(0.604, 0.038)} ${pt(0.607, -0.045)}`);
  parts.push(`C ${pt(0.61, -0.127)} ${pt(0.807, 0)} ${pt(1.0, 0)}`);
}

/** SVG 오버레이용 조각 윤곽 (보드 좌표 0…200 × 0…300) */
export function piecePathSvgD(col: number, row: number): string {
  const pw = PS_PIECE_W;
  const ph = PS_PIECE_H;
  const ox = col * pw;
  const oy = row * ph;
  const tabDepth = Math.min(pw, ph) * 0.2;
  const topTab = row === 0 ? 0 : -PS_HORIZONTAL_TABS[row - 1]![col]!;
  const rightTab = col === PS_COLS - 1 ? 0 : PS_VERTICAL_TABS[row]![col]!;
  const bottomTab = row === PS_ROWS - 1 ? 0 : PS_HORIZONTAL_TABS[row]![col]!;
  const leftTab = col === 0 ? 0 : -PS_VERTICAL_TABS[row]![col - 1]!;

  const parts: string[] = [];
  appendEdgeSvg(parts, ox, oy, ox + pw, oy, topTab, tabDepth, true);
  appendEdgeSvg(parts, ox + pw, oy, ox + pw, oy + ph, rightTab, tabDepth, false);
  appendEdgeSvg(parts, ox + pw, oy + ph, ox, oy + ph, bottomTab, tabDepth, false);
  appendEdgeSvg(parts, ox, oy + ph, ox, oy, leftTab, tabDepth, false);
  parts.push("Z");
  return parts.join(" ");
}

export function puzzleShotPieceIndexList(): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < PS_ROWS; row++) {
    for (let col = 0; col < PS_COLS; col++) {
      out.push({ col, row });
    }
  }
  return out;
}
