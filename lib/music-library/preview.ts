// ── Music selection preview ───────────────────────────────────────────────────
// Shows which track the selector picks for different kinds of videos WITHOUT
// rendering. Prints the chosen track and its mood category.
//
// Run it:
//   npm run music:preview

import { MUSIC_CATALOG } from './catalog'
import { MUSIC_CATEGORIES } from './types'
import { selectTrack } from './select'
import type { MusicSelectionContext } from './types'

const SAMPLES: { label: string; ctx: MusicSelectionContext }[] = [
  { label: 'Med-spa / educational (calm)', ctx: { hook: 'Here is what most people get wrong about Botox aftercare', moodTag: 'calm', scriptFormat: 'educational' } },
  { label: 'Personal / emotional story', ctx: { hook: 'I almost gave up on my clinic last year', moodTag: 'emotional', scriptFormat: 'story' } },
  { label: 'Motivational push', ctx: { hook: 'Stop waiting for the perfect moment. Start today.', moodTag: 'motivational', scriptFormat: 'motivational' } },
  { label: 'Sales / punchy hook', ctx: { hook: 'Stop scrolling. This changes how you book clients.', moodTag: 'energetic', scriptFormat: 'sales' } },
  { label: 'Funny / light', ctx: { hook: 'POV: your first day at the gym', moodTag: 'funny', scriptFormat: 'skit' } },
]

async function main() {
  const byCat: Record<string, number> = {}
  for (const t of MUSIC_CATALOG) for (const c of t.categories) byCat[c] = (byCat[c] ?? 0) + 1
  console.log(`\nLibrary: ${MUSIC_CATALOG.length} tracks across ${MUSIC_CATEGORIES.length} categories`)
  console.log(`Counts: ${JSON.stringify(byCat)}\n`)

  for (const { label, ctx } of SAMPLES) {
    const track = await selectTrack(ctx)
    if (!track) { console.log(`• ${label}\n    → (no track — library empty)\n`); continue }
    console.log(`• ${label}`)
    console.log(`    → "${track.title}"  [${track.categories.join('/')}]\n`)
  }
}

main().catch((e) => { console.error('[preview] failed:', e); process.exit(1) })
