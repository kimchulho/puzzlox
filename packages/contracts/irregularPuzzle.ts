/** Shared types for irregular (SVG-defined) puzzles — mirrors `lib/irregularSvgParse.ts` output. */

export const IRREGULAR_DEFINITION_VERSION = 1 as const;

export interface IrregularPieceDefV1 {
  id: number;
  assemblyIndex: number;
  centroidSvg: { x: number; y: number };
  bboxSvg: { minX: number; minY: number; maxX: number; maxY: number };
  polylineLocal: { x: number; y: number }[];
}

export interface IrregularEdgeDefV1 {
  assemblyIndex: number;
  a: number;
  b: number;
  deltaCentroidSvg: { x: number; y: number };
  minBoundaryDistSvg: number;
}

export interface IrregularDefinitionV1 {
  version: typeof IRREGULAR_DEFINITION_VERSION;
  viewBox: { x: number; y: number; width: number; height: number };
  assemblyCount: number;
  pieceCount: number;
  snapTolerancePxDefault: number;
  neighborThresholdSvg: number;
  pieces: IrregularPieceDefV1[];
  edges: IrregularEdgeDefV1[];
}

export interface IrregularTemplateListItem {
  id: number;
  name: string;
  cut_kind: string;
  piece_count: number;
  assembly_count: number;
  svg_url: string;
}
