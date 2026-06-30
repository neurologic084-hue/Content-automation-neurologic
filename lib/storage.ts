import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'

const BUCKET = process.env.R2_BUCKET!
const PUBLIC_URL = process.env.R2_PUBLIC_URL!

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function uploadToStorage(localPath: string, fileName: string, jobId: string): Promise<string> {
  const client = r2Client()
  const fileBuffer = fs.readFileSync(localPath)
  const storagePath = `${jobId}/${fileName}`
  console.log(`[storage] uploading ${storagePath} (${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`)

  // Large files on a slow connection occasionally hit a transient network error
  // mid-upload. Retry a few times with backoff before giving up.
  const maxAttempts = 3
  let lastError: string | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: storagePath,
        Body: fileBuffer,
        ContentType: 'video/mp4',
      }))
      const publicUrl = `${PUBLIC_URL}/${storagePath}`
      console.log(`[storage] uploaded ${storagePath}: ${publicUrl}`)
      return publicUrl
    } catch (e) {
      lastError = (e as Error).message
      console.warn(`[storage] upload ${storagePath} attempt ${attempt}/${maxAttempts} failed: ${lastError}`)
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 1500))
      }
    }
  }

  throw new Error(`Storage upload failed after ${maxAttempts} attempts: ${lastError}`)
}

export async function tryUploadToStorage(localPath: string, fileName: string, jobId: string): Promise<string | null> {
  try {
    return await uploadToStorage(localPath, fileName, jobId)
  } catch (e) {
    console.warn(`[storage] upload skipped/failed for ${jobId}/${fileName}: ${(e as Error).message}`)
    return null
  }
}
