import fs from 'fs'

// Storage is local-only for now.
// Processed videos are served directly from /renders/<jobId>/<fileName>
// via Next.js's public folder (vid-app/public/renders/...).

export async function uploadToStorage(_localPath: string, _fileName: string, _jobId: string): Promise<string> {
  throw new Error('No remote storage configured')
}

export async function tryUploadToStorage(_localPath: string, _fileName: string, _jobId: string): Promise<string | null> {
  return null
}

export function storageFileName(variantId: string): string {
  return `${variantId}.mp4`
}
