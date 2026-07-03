import type { SupabaseClient } from '@supabase/supabase-js'

/** The active profile's slot number (1-3). Everything the app shows and
 *  learns from is scoped to this slot — switching the active profile in
 *  Settings swaps the whole workspace. Falls back to 1 when no profile is
 *  marked active (or the column migration hasn't run yet). */
export async function getActiveSlot(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from('brand_settings')
    .select('profile_slot')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return data?.profile_slot ?? 1
}
