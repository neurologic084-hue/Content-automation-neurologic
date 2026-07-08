import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
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

export async function uploadToStorage(localPath: string, fileName: string, jobId: string, folder?: string): Promise<string> {
  const fileBuffer = fs.readFileSync(localPath)
  const storagePath = folder ? `${folder}/${jobId}/${fileName}` : `${jobId}/${fileName}`
  console.log(`[storage] uploading ${storagePath} (${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`)

  // Flaky links corrupt long TLS streams mid-upload ("SSL alert bad record
  // mac"), so:
  // - multipart with 8MB parts: each part is a short-lived request, and a
  //   corrupted part retries alone instead of restarting the whole file
  // - a FRESH client per attempt: a poisoned keep-alive connection in the
  //   pool otherwise makes every retry fail identically
  const maxAttempts = 4
  let lastError: string | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = r2Client()
    try {
      const upload = new Upload({
        client,
        params: {
          Bucket: BUCKET,
          Key: storagePath,
          Body: fileBuffer,
          ContentType: 'video/mp4',
        },
        partSize: 8 * 1024 * 1024,
        queueSize: 2,
        leavePartsOnError: false,
      })
      await upload.done()
      const publicUrl = `${PUBLIC_URL}/${storagePath}`
      console.log(`[storage] uploaded ${storagePath}: ${publicUrl}`)
      return publicUrl
    } catch (e) {
      lastError = (e as Error).message
      console.warn(`[storage] upload ${storagePath} attempt ${attempt}/${maxAttempts} failed: ${lastError}`)
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 2500))
      }
    } finally {
      client.destroy()
    }
  }

  throw new Error(`Storage upload failed after ${maxAttempts} attempts: ${lastError}`)
}

export async function tryUploadToStorage(localPath: string, fileName: string, jobId: string, folder?: string): Promise<string | null> {
  try {
    return await uploadToStorage(localPath, fileName, jobId, folder)
  } catch (e) {
    console.warn(`[storage] upload skipped/failed for ${jobId}/${fileName}: ${(e as Error).message}`)
    return null
  }
}

async function listAllKeys(client: S3Client, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
  const keys: { key: string; lastModified?: Date }[] = []
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const o of res.Contents ?? []) {
      if (o.Key) keys.push({ key: o.Key, lastModified: o.LastModified })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return keys
}

async function deleteKeys(client: S3Client, keys: string[]): Promise<number> {
  let deleted = 0
  // DeleteObjects accepts at most 1000 keys per call
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }))
    deleted += batch.length
  }
  return deleted
}

/** Best-effort: delete every object under the given prefixes. Never throws —
 *  storage cleanup must not break the operation that triggered it. */
export async function deleteStoragePrefixes(prefixes: string[]): Promise<number> {
  try {
    const client = r2Client()
    const keys: string[] = []
    for (const prefix of prefixes) {
      // Refuse empty/blank prefixes — an empty prefix would list the whole bucket.
      if (!prefix || prefix === '/') continue
      keys.push(...(await listAllKeys(client, prefix)).map((k) => k.key))
    }
    if (keys.length === 0) return 0
    const deleted = await deleteKeys(client, keys)
    console.log(`[storage] deleted ${deleted} object(s) under ${prefixes.join(', ')}`)
    return deleted
  } catch (e) {
    console.warn(`[storage] cleanup failed for ${prefixes.join(', ')}: ${(e as Error).message}`)
    return 0
  }
}

/** Best-effort: delete a single object by key. Never throws. */
export async function deleteStorageKey(key: string): Promise<void> {
  try {
    if (!key) return
    const client = r2Client()
    await deleteKeys(client, [key])
    console.log(`[storage] deleted ${key}`)
  } catch (e) {
    console.warn(`[storage] delete failed for ${key}: ${(e as Error).message}`)
  }
}

/** Everything R2 holds for a video job: finished renders under
 *  finished/{jobId}/ plus working files (compressed source, publish
 *  fallback uploads) under {jobId}/. */
export async function deleteJobStorage(jobId: string): Promise<number> {
  if (!jobId || !/^[a-zA-Z0-9-]+$/.test(jobId)) return 0
  return deleteStoragePrefixes([`finished/${jobId}/`, `${jobId}/`])
}

/** Best-effort: delete objects under a prefix older than maxAgeHours.
 *  Used to sweep one-shot outputs (audio-clean) that are only needed
 *  briefly but were previously kept forever. Never throws. */
export async function sweepStoragePrefix(prefix: string, maxAgeHours: number): Promise<number> {
  try {
    if (!prefix || prefix === '/') return 0
    const client = r2Client()
    const cutoff = Date.now() - maxAgeHours * 3600_000
    const stale = (await listAllKeys(client, prefix))
      .filter((k) => k.lastModified && k.lastModified.getTime() < cutoff)
      .map((k) => k.key)
    if (stale.length === 0) return 0
    const deleted = await deleteKeys(client, stale)
    console.log(`[storage] swept ${deleted} stale object(s) under ${prefix}`)
    return deleted
  } catch (e) {
    console.warn(`[storage] sweep failed for ${prefix}: ${(e as Error).message}`)
    return 0
  }
}
