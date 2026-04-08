/**
 * Illustrator-exported stroke-only jigsaw SVG → game definition (server-side).
 * - One <path> = one movable piece.
 * - Assemblies (2+ puzzles on one image): k-means on piece centroids (k=2 by default when piece count allows).
 * - Neighbors: min distance between flattened polylines in SVG units; edge stores centroid delta for snap hints.
 */

import { XMLParser } from "fast-xml-parser";

export const IRREGULAR_DEFINITION_VERSION = 1 as const;

export interface IrregularPieceDefV1 {
  id: number;
  assemblyIndex: number;
  centroidSvg: { x: number; y: number };
  bboxSvg: { minX: number; minY: number; maxX: number; maxY: number };
  /** Downsampled outline in SVG space (centroid at origin) for client preview / future mesh */
  polylineLocal: { x: number; y: number }[];
}

export interface IrregularEdgeDefV1 {
  assemblyIndex: number;
  a: number;
  b: number;
  /** Solved layout: centroid_b - centroid_a in SVG coordinates (identity rotation, front face). */
  deltaCentroidSvg: { x: number; y: number };
  /** Minimum sampled boundary distance when solved (diagnostic, SVG units). */
  minBoundaryDistSvg: number;
}

export interface IrregularDefinitionV1 {
  version: typeof IRREGULAR_DEFINITION_VERSION;
  viewBox: { x: number; y: number; width: number; height: number };
  assemblyCount: number;
  pieceCount: number;
  /** Default snap tolerance in CSS pixels; client may scale with DPR. */
  snapTolerancePxDefault: number;
  neighborThresholdSvg: number;
  pieces: IrregularPieceDefV1[];
  edges: IrregularEdgeDefV1[];
}

export interface ParseIrregularSvgOptions {
  /** Force cluster count (1 = one puzzle, 2 = dual on one image). When set, overrides auto k. */
  assemblyCountHint?: 1 | 2;
  /** Max assemblies to detect (2 for your dual-puzzle case). */
  maxAssemblies?: number;
  /** Fraction of min(viewBox w,h) for neighbor cutoff if neighborThresholdSvg omitted. */
  neighborThresholdFraction?: number;
  /** Override neighbor cutoff in SVG user units. */
  neighborThresholdSvg?: number;
  snapTolerancePxDefault?: number;
  /** Points sampled per cubic segment when flattening. */
  bezierSteps?: number;
  /** Max points kept per piece outline (uniform subsample). */
  maxPolylinePoints?: number;
}

type Vec2 = { x: number; y: number };

function bboxOfPoints(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function centroidOfPoints(pts: Vec2[]): Vec2 {
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0,
    sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

function cubicPoint(t: number, p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function flattenPathToPoints(d: string, bezierSteps: number): Vec2[] {
  const normalized = d.trim().replace(/,/g, " ");
  const expanded = normalized.replace(/([MmLlHhVvCcSsQqTtAaZz])/g, " $1 ");
  const rawTokens = expanded.split(/\s+/).filter((t) => t.length > 0);
  const tokens: string[] = [];
  for (const t of rawTokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(t)) tokens.push(t);
    else {
      const n = parseFloat(t);
      if (!Number.isFinite(n)) continue;
      tokens.push(String(n));
    }
  }

  let i = 0;
  let x = 0,
    y = 0;
  let sx = 0,
    sy = 0;
  let lastCmd = "M";
  /** Previous cubic second control (for S/s). */
  let lastC2: Vec2 | null = null;
  const out: Vec2[] = [];

  const readNum = () => {
    const v = parseFloat(tokens[i++]);
    return Number.isFinite(v) ? v : 0;
  };

  while (i < tokens.length) {
    let cmd = tokens[i];
    if (/^[MmLlHhVvCcSsZz]$/.test(cmd)) {
      i++;
      lastCmd = cmd;
    } else {
      cmd = lastCmd;
    }
    const up = cmd.toUpperCase();
    const rel = cmd === cmd.toLowerCase();

    if (up === "M") {
      lastC2 = null;
      x = readNum();
      y = readNum();
      if (rel) {
        x += sx;
        y += sy;
      }
      sx = x;
      sy = y;
      out.push({ x, y });
      lastCmd = rel ? "l" : "L";
      while (i < tokens.length && !/^[MmLlHhVvCcZz]$/.test(tokens[i])) {
        const nx = readNum();
        const ny = readNum();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        out.push({ x, y });
      }
      continue;
    }

    if (up === "L") {
      const nx = readNum();
      const ny = readNum();
      x = rel ? x + nx : nx;
      y = rel ? y + ny : ny;
      out.push({ x, y });
      lastC2 = null;
      lastCmd = cmd;
      continue;
    }

    if (up === "H") {
      const nx = readNum();
      x = rel ? x + nx : nx;
      out.push({ x, y });
      lastC2 = null;
      lastCmd = cmd;
      continue;
    }

    if (up === "V") {
      const ny = readNum();
      y = rel ? y + ny : ny;
      out.push({ x, y });
      lastC2 = null;
      lastCmd = cmd;
      continue;
    }

    if (up === "C") {
      const x1 = readNum(),
        y1 = readNum(),
        x2 = readNum(),
        y2 = readNum(),
        x3 = readNum(),
        y3 = readNum();
      const p0 = { x, y };
      const p1 = { x: rel ? x + x1 : x1, y: rel ? y + y1 : y1 };
      const p2 = { x: rel ? x + x2 : x2, y: rel ? y + y2 : y2 };
      const p3 = { x: rel ? x + x3 : x3, y: rel ? y + y3 : y3 };
      const steps = Math.max(2, bezierSteps);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const p = cubicPoint(t, p0, p1, p2, p3);
        out.push(p);
      }
      x = p3.x;
      y = p3.y;
      lastC2 = p2;
      lastCmd = cmd;
      continue;
    }

    if (up === "S") {
      const x2 = readNum(),
        y2 = readNum(),
        x3 = readNum(),
        y3 = readNum();
      const p0 = { x, y };
      const p1 = lastC2
        ? { x: 2 * p0.x - lastC2.x, y: 2 * p0.y - lastC2.y }
        : { ...p0 };
      const p2 = { x: rel ? x + x2 : x2, y: rel ? y + y2 : y2 };
      const p3 = { x: rel ? x + x3 : x3, y: rel ? y + y3 : y3 };
      const steps = Math.max(2, bezierSteps);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        out.push(cubicPoint(t, p0, p1, p2, p3));
      }
      x = p3.x;
      y = p3.y;
      lastC2 = p2;
      lastCmd = cmd;
      continue;
    }

    if (up === "Z") {
      if (out.length > 0 && (x !== sx || y !== sy)) {
        out.push({ x: sx, y: sy });
      }
      x = sx;
      y = sy;
      lastC2 = null;
      lastCmd = "Z";
      continue;
    }

    // Unknown: try to skip a small number of numeric tokens to resync
    if (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) {
      i++;
    } else {
      i++;
    }
  }

  return out;
}

function subsamplePoints(pts: Vec2[], maxN: number): Vec2[] {
  if (pts.length <= maxN) return pts;
  const step = (pts.length - 1) / (maxN - 1);
  const out: Vec2[] = [];
  for (let k = 0; k < maxN; k++) {
    const idx = Math.min(pts.length - 1, Math.round(k * step));
    out.push(pts[idx]!);
  }
  return out;
}

function minDistBetweenPolylines(a: Vec2[], b: Vec2[]): number {
  let m = Infinity;
  for (const p of a) {
    for (const q of b) {
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      m = Math.min(m, Math.hypot(dx, dy));
    }
  }
  return m;
}

function kMeansLabels(centroids: Vec2[], k: number, maxIter = 25): number[] {
  const n = centroids.length;
  if (n === 0 || k <= 1) return centroids.map(() => 0);
  let centers: Vec2[] = [];
  // init: pick k spread centroids
  centers.push({ ...centroids[0]! });
  for (let c = 1; c < k; c++) {
    let bestI = 0,
      bestD = -1;
    for (let i = 0; i < n; i++) {
      let md = Infinity;
      for (const cen of centers) {
        md = Math.min(md, Math.hypot(centroids[i]!.x - cen.x, centroids[i]!.y - cen.y));
      }
      if (md > bestD) {
        bestD = md;
        bestI = i;
      }
    }
    centers.push({ ...centroids[bestI]! });
  }

  let labels = new Array(n).fill(0);
  for (let it = 0; it < maxIter; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0,
        bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = Math.hypot(centroids[i]!.x - centers[c]!.x, centroids[i]!.y - centers[c]!.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      labels[i] = best;
    }
    const sums = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
    for (let i = 0; i < n; i++) {
      const L = labels[i]!;
      sums[L]!.x += centroids[i]!.x;
      sums[L]!.y += centroids[i]!.y;
      sums[L]!.n += 1;
    }
    let moved = false;
    for (let c = 0; c < k; c++) {
      if (sums[c]!.n === 0) continue;
      const nx = sums[c]!.x / sums[c]!.n;
      const ny = sums[c]!.y / sums[c]!.n;
      if (Math.hypot(nx - centers[c]!.x, ny - centers[c]!.y) > 1e-6) moved = true;
      centers[c] = { x: nx, y: ny };
    }
    if (!moved) break;
  }
  return labels;
}

function collectPathDs(obj: unknown, out: string[]): void {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    for (const x of obj) collectPathDs(x, out);
    return;
  }
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    const d = o["@_d"];
    if (typeof d === "string" && d.trim().length > 0) out.push(d);
    for (const v of Object.values(o)) collectPathDs(v, out);
  }
}

function parseViewBox(svgRoot: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  const vb = svgRoot["@_viewBox"];
  if (typeof vb === "string") {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n))) {
      return { x: p[0]!, y: p[1]!, width: p[2]!, height: p[3]! };
    }
  }
  const w = Number(svgRoot["@_width"] ?? 0);
  const h = Number(svgRoot["@_height"] ?? 0);
  return { x: 0, y: 0, width: Number.isFinite(w) && w > 0 ? w : 1024, height: Number.isFinite(h) && h > 0 ? h : 768 };
}

/**
 * Parse raw SVG string into a versioned definition for DB storage and clients.
 */
export function parseIrregularPuzzleSvg(svgXml: string, options: ParseIrregularSvgOptions = {}): IrregularDefinitionV1 {
  const bezierSteps = options.bezierSteps ?? 10;
  const maxPolylinePoints = options.maxPolylinePoints ?? 120;
  const snapTolerancePxDefault = options.snapTolerancePxDefault ?? 12;
  const maxAssemblies = Math.max(1, options.maxAssemblies ?? 2);
  const neighborFrac = options.neighborThresholdFraction ?? 0.012;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  const doc = parser.parse(svgXml) as Record<string, unknown>;
  const svg = doc["svg"] as Record<string, unknown> | undefined;
  if (!svg) {
    throw new Error("Invalid SVG: root <svg> not found.");
  }

  const viewBox = parseViewBox(svg);
  const vbMin = Math.min(viewBox.width, viewBox.height);
  const neighborThresholdSvg =
    options.neighborThresholdSvg ?? Math.max(2.5, vbMin * neighborFrac);

  const pathDs: string[] = [];
  collectPathDs(svg, pathDs);
  if (pathDs.length === 0) {
    throw new Error("No <path d=\"...\"> elements found. Export paths as strokes from Illustrator.");
  }

  const piecePolylines: Vec2[][] = [];
  for (const d of pathDs) {
    const pts = flattenPathToPoints(d, bezierSteps);
    if (pts.length < 2) continue;
    piecePolylines.push(pts);
  }
  if (piecePolylines.length === 0) {
    throw new Error("Paths did not produce drawable geometry.");
  }

  const centroids = piecePolylines.map((pl) => centroidOfPoints(pl));
  const n = centroids.length;
  let k: number;
  if (options.assemblyCountHint === 1) {
    k = 1;
  } else if (options.assemblyCountHint === 2) {
    k = Math.min(2, Math.max(1, n >= 2 ? 2 : 1));
  } else {
    k = n < 8 ? 1 : Math.min(maxAssemblies, 2);
  }
  const labels = kMeansLabels(centroids, k);
  const assemblyCount = k;

  const pieces: IrregularPieceDefV1[] = piecePolylines.map((pl, id) => {
    const bbox = bboxOfPoints(pl);
    const c = centroids[id]!;
    const localFull = pl.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    const polylineLocal = subsamplePoints(localFull, maxPolylinePoints);
    return {
      id,
      assemblyIndex: labels[id] ?? 0,
      centroidSvg: { x: c.x, y: c.y },
      bboxSvg: bbox,
      polylineLocal,
    };
  });

  const edges: IrregularEdgeDefV1[] = [];
  const assemblies = new Set(labels);
  for (const ai of assemblies) {
    const ids = pieces.filter((p) => p.assemblyIndex === ai).map((p) => p.id);
    for (let ii = 0; ii < ids.length; ii++) {
      for (let jj = ii + 1; jj < ids.length; jj++) {
        const a = ids[ii]!;
        const b = ids[jj]!;
        const pla = subsamplePoints(piecePolylines[a]!, 80);
        const plb = subsamplePoints(piecePolylines[b]!, 80);
        const dist = minDistBetweenPolylines(pla, plb);
        if (dist <= neighborThresholdSvg) {
          const ca = centroids[a]!;
          const cb = centroids[b]!;
          edges.push({
            assemblyIndex: ai,
            a,
            b,
            deltaCentroidSvg: { x: cb.x - ca.x, y: cb.y - ca.y },
            minBoundaryDistSvg: dist,
          });
        }
      }
    }
  }

  return {
    version: IRREGULAR_DEFINITION_VERSION,
    viewBox,
    assemblyCount,
    pieceCount: pieces.length,
    snapTolerancePxDefault,
    neighborThresholdSvg,
    pieces,
    edges,
  };
}
