/** Optional metadata when entering a puzzle room (URL sync + lobby). */

export type PuzzleKind = "regular" | "irregular";

export type JoinRoomMeta = {
  puzzleKind?: PuzzleKind;
  irregularTemplateId?: number | null;
};
