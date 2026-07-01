import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('brand_settings')
    .select('id, profile_slot, profile_name, is_active, creator_name, tagline, location, tone_keywords')
    .order('profile_slot', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    profiles: data?.map(p => ({
      slot: p.profile_slot,
      name: p.profile_name,
      active: p.is_active,
      creator: p.creator_name,
      tagline: p.tagline,
      location: p.location,
      tone: p.tone_keywords,
    })),
  })
}
