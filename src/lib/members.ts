import { supabase } from "./supabase";

export type Member = { user_id: string; name: string; active: boolean };

export async function loadMembers(householdId: string, me: string): Promise<Member[]> {
  const { data, error } = await supabase().from("household_members")
    .select("user_id, left_at, profiles(display_name)").eq("household_id", householdId);
  if (error) throw error;
  return ((data ?? []) as unknown as { user_id: string; left_at: string | null; profiles: { display_name: string } | null }[])
    .map((m) => ({ user_id: m.user_id, name: m.profiles?.display_name ?? "?", active: !m.left_at }))
    .sort((a, b) => (a.user_id === me ? -1 : b.user_id === me ? 1 : a.name.localeCompare(b.name)));
}
