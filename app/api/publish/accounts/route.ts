import { NextResponse } from 'next/server'
import { getAccounts } from '@/lib/blotato'

export async function GET() {
  if (!process.env.BLOTATO_API_KEY) {
    return NextResponse.json({ error: 'BLOTATO_API_KEY not configured.' }, { status: 503 })
  }
  try {
    const accounts = await getAccounts()
    return NextResponse.json({ accounts })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
