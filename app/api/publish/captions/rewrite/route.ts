import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { explainAiErrorForCreator } from '@/lib/error-explain'
import { rewriteCaption, getActiveBrand } from '@/lib/caption-writer'

export const maxDuration = 90

export async function POST(req: NextRequest) {
  const { platform, currentCaption, feedback, script } = await req.json() as {
    platform: string
    currentCaption: string
    feedback: string
    script: { hook: string; body: string; cta: string }
  }

  if (!platform || !feedback?.trim()) {
    return NextResponse.json({ error: 'platform and feedback are required.' }, { status: 400 })
  }

  try {
    const brand = await getActiveBrand(await createClient()).catch(() => null)
    const caption = await rewriteCaption({ platform, currentCaption, feedback, script, brand })
    return NextResponse.json({ caption })
  } catch (e) {
    const friendly = explainAiErrorForCreator(e, 'rewriting this caption')
    return NextResponse.json({ error: friendly === (e as Error).message ? `Rewrite failed: ${friendly}` : friendly }, { status: 500 })
  }
}
