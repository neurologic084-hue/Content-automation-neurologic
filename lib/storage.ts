import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BUCKET = 'renders'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function uploadToStorage(localPath: string, fileName: string, jobId: string): Promise<string> {
  const supabase = serviceClient()
  const fileBuffer = fs.readFileSync(localPath)
  const storagePath = `${jobId}/${fileName}`

  // Large files on a slow connection occasionally hit a transient "fetch failed"
  // mid-upload. Retry a few times with backoff before giving up.
  const maxAttempts = 3
  let lastError: string | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: 'video/mp4', upsert: true })

    if (!error) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
      return data.publicUrl
    }

    lastError = error.message
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }

  throw new Error(`Storage upload failed after ${maxAttempts} attempts: ${lastError}`)
}

export async function tryUploadToStorage(localPath: string, fileName: string, jobId: string): Promise<string | null> {
  try {
    return await uploadToStorage(localPath, fileName, jobId)
  } catch {
    return null
  }
}

export function storageFileName(variantId: string): string {
  return `${variantId}.mp4`
}
