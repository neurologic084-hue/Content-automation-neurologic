import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getScriptVoiceover, scriptToSpeech, normalizeVoice, TeleprompterUnavailable } from '@/lib/teleprompter'

// Reads one script aloud for the teleprompter. POST rather than GET because a
// cache miss spends ElevenLabs characters — this should never fire from a
// prefetch or a page load, only from the creator pressing play.
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { voice } = await req.json().catch(() => ({ voice: undefined }))

  const { data: script } = await supabase
    .from('scripts')
    .select('hook, body, cta')
    .eq('id', id)
    .single()
  if (!script) return NextResponse.json({ error: 'Script not found.' }, { status: 404 })

  try {
    const url = await getScriptVoiceover(
      scriptToSpeech(script.hook, script.body, script.cta),
      normalizeVoice(voice),
    )
    return NextResponse.json({ url })
  } catch (e) {
    // TeleprompterUnavailable messages are written for the creator (which key
    // permission to enable, that characters ran out) — pass them through. Any
    // other throw is ours, so keep the detail in the log and stay generic.
    if (e instanceof TeleprompterUnavailable) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('[teleprompter] unexpected failure:', (e as Error).message)
    return NextResponse.json({ error: 'Could not create the voice reading. Please try again.' }, { status: 500 })
  }
}
