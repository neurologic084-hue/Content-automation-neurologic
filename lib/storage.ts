import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BUCKET = 'renders'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Upload a local MP4 to Supabase Storage and return its public URL.
// Path inside the bucket: renders/<jobId>/<fileName>
export async function uploadToStorage(localPath: string, fileName: string, jobId: string): Promise<string> {
  const storage = supabaseAdmin().storage
  const objectPath = `${jobId}/${fileName}`
  const body = fs.readFileSync(localPath)

  const { error } = await storage.from(BUCKET).upload(objectPath, body, {
    contentType: 'video/mp4',
    upsert: true,
  })

  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`)

  const { data } = storage.from(BUCKET).getPublicUrl(objectPath)
  return data.publicUrl
}

// Best-effort version — returns null instead of throwing.
export async function tryUploadToStorage(localPath: string, fileName: string, jobId: string): Promise<string | null> {
  try {
    return await uploadToStorage(localPath, fileName, jobId)
  } catch (e) {
    console.error('[storage] upload failed:', (e as Error).message)
    return null
  }
}

export function storageFileName(variantId: string): string {
  return `${variantId}.mp4`
}
