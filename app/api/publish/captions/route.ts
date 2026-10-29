import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { explainAiErrorForCreator } from '@/lib/error-explain'
import { writeCaptions, getActiveBrand } from '@/lib/caption-writer'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const { hook, body, cta, platforms } = await req.json() as {
    hook: string
    body: string
    cta: string
    platforms: string[]
  }

  if (!platforms?.length) {
    return NextResponse.json({ error: 'No platforms specified.' }, { status: 400 })
  }

  try {
    const brand = await getActiveBrand(await createClient()).catch(() => null)
    const captions = await writeCaptions({ script: { hook, body, cta }, platforms, brand })
    return NextResponse.json({ captions })
  } catch (e) {
    const msg = (e as Error).message
    const friendly = explainAiErrorForCreator(e, 'writing captions')
    return NextResponse.json({
      error: friendly === msg
        ? `Caption generation failed: ${msg}`
        : `${friendly} You can still type your captions in the boxes below and publish.`,
    }, { status: 500 })
  }
}
