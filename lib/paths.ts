import path from 'path'

// Where render working files and finished videos live on THIS machine.
// - Local dev / long-lived server: public/renders (also served by Next).
// - Vercel functions & Sandbox workers: /tmp/renders — the only writable spot;
//   nothing is served from disk there (finished videos live in R2).
// RENDERS_DIR overrides both for custom hosts.
export function rendersRoot(): string {
  if (process.env.RENDERS_DIR) return process.env.RENDERS_DIR
  if (process.env.VERCEL) return '/tmp/renders'
  return path.join(process.cwd(), 'public', 'renders')
}

export function rendersDir(jobId: string): string {
  return path.join(rendersRoot(), jobId)
}
