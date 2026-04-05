export type PuzzleDifficulty = "easy" | "medium" | "hard";

export const DEFAULT_PUZZLE_DIFFICULTY: PuzzleDifficulty = "medium";

export const PUZZLE_DIFFICULTIES: PuzzleDifficulty[] = ["easy", "medium", "hard"];

export const isPuzzleDifficulty = (value: unknown): value is PuzzleDifficulty =>
  value === "easy" || value === "medium" || value === "hard";

export const normalizePuzzleDifficulty = (value: unknown): PuzzleDifficulty => {
  if (isPuzzleDifficulty(value)) return value;
  return DEFAULT_PUZZLE_DIFFICULTY;
};

export const puzzleDifficultyLabel = (difficulty: PuzzleDifficulty, isKo: boolean): string => {
  if (isKo) {
    if (difficulty === "easy") return "초급";
    if (difficulty === "medium") return "중급";
    return "고급";
  }
  if (difficulty === "easy") return "Easy";
  if (difficulty === "medium") return "Medium";
  return "Hard";
};

const isBorderPiece = (pieceId: number, cols: number, rows: number) => {
  const col = pieceId % cols;
  const row = Math.floor(pieceId / cols);
  return col === 0 || col === cols - 1 || row === 0 || row === rows - 1;
};

export const canClusterLockOnBoard = (
  difficulty: PuzzleDifficulty,
  cluster: Set<number>,
  lockedPieceIds: Set<number>,
  cols: number,
  rows: number
) => {
  if (difficulty !== "hard") return true;
  if (cluster.size === 0) return false;
  for (const id of cluster) {
    if (isBorderPiece(id, cols, rows)) return true;
  }

  // Allow locking when this cluster is connected to an already locked chain.
  const offsets = [-1, 1, -cols, cols];
  for (const id of cluster) {
    const col = id % cols;
    const row = Math.floor(id / cols);
    for (const d of offsets) {
      const next = id + d;
      if (next < 0 || next >= cols * rows) continue;
      const nCol = next % cols;
      const nRow = Math.floor(next / cols);
      if (Math.abs(nCol - col) + Math.abs(nRow - row) !== 1) continue;
      if (cluster.has(next)) continue;
      if (lockedPieceIds.has(next)) return true;
    }
  }
  return false;
};
