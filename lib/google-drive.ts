import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'

function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')

  const credentials = JSON.parse(raw)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  return google.drive({ version: 'v3', auth })
}

// Upload a local MP4 to Drive and return a shareable URL.
// folderId: the Drive folder to upload into (GOOGLE_DRIVE_OUTPUT_FOLDER_ID).
// fileName: what to name the file in Drive (e.g. "bold-abc12345.mp4").
export async function uploadToDrive(
  localPath: string,
  fileName: string,
  folderId: string
): Promise<string> {
  const drive = getDriveClient()

  const { data: file } = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(localPath),
    },
    fields: 'id',
  })

  if (!file.id) throw new Error('Drive upload returned no file ID')

  // Make the file readable by anyone with the link
  await drive.permissions.create({
    fileId: file.id,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return `https://drive.google.com/file/d/${file.id}/view`
}

// Best-effort: upload and return URL, or null on failure.
export async function tryUploadToDrive(
  localPath: string,
  fileName: string
): Promise<string | null> {
  const folderId = process.env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID
  if (!folderId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null

  try {
    return await uploadToDrive(localPath, fileName, folderId)
  } catch (e) {
    console.error('[google-drive] upload failed:', (e as Error).message)
    return null
  }
}

// Build a consistent output file name: "<variantId>-<jobIdPrefix>.mp4"
export function driveFileName(variantId: string, jobId: string, scriptTitle?: string): string {
  const prefix = scriptTitle
    ? scriptTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    : jobId.slice(0, 8)
  return `${variantId}-${prefix}.mp4`
}
