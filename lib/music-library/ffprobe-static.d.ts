// ffprobe-static ships no types; we only use its `.path`.
declare module 'ffprobe-static' {
  const ffprobe: { path: string }
  export default ffprobe
}
