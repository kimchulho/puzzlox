export const ROOM_EVENTS = {
  JoinRoom: "join_room",
  PuzzleCompleted: "puzzle_completed",
  SyncTime: "sync_time",
} as const;

export type JoinRoomPayload = number;
export type PuzzleCompletedPayload = number;

export interface SyncTimePayload {
  accumulatedTime: number;
  isRunning: boolean;
}
