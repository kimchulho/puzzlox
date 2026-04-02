import { supabase } from "./supabaseClient";

/** Records or refreshes last visit time for cross-device "이어하기" (logged-in users only). */
export async function recordUserRoomVisit(userId: string | number, roomId: number): Promise<void> {
  if (userId == null || userId === "" || roomId == null) return;
  const { error } = await supabase.from("pixi_user_room_visits").upsert(
    {
      user_id: userId,
      room_id: roomId,
      last_visited_at: new Date().toISOString(),
    },
    { onConflict: "user_id,room_id" }
  );
  if (error) console.warn("[recordUserRoomVisit]", error.message);
}
