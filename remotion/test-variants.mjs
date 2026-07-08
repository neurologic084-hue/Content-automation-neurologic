// ── Local render smoke test for the v4-v6 Remotion variants ──────────────────
// Renders a short clip of every ShortEdit variant identity (eubank/v4,
// viral/v5, koe/v6, plus the base) against a synthetic source, WITHOUT touching
// Submagic, Drive, or production. Proves the composition renders end-to-end —
// caption paths, graphics, matte, and (the recent fix) OffthreadVideo frame
// extraction with tone mapping off.
//
//   cd remotion && node test-variants.mjs [variantKey]
//   variantKey: v4 | v5 | v6 | base | all (default: all)
//
// Exits non-zero if any variant fails, so it doubles as a CI gate.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_CACHE = path.join(DIR, 'public', 'edit-cache')
const OUT = path.join(DIR, '.test-out')
const SRC_NAME = 'edit-cache/_test-src.mp4'
const SRC_PATH = path.join(DIR, 'public', SRC_NAME)
const MATTE_NAME = 'edit-cache/_test-matte.mov'
const MATTE_PATH = path.join(DIR, 'public', MATTE_NAME)

const FPS = 30
const DUR = 4 // seconds of test timeline

// A caption page every ~1.3s so the caption renderer actually draws text.
function pages() {
  const sample = [
    [{ t: 'this', accent: false }, { t: 'actually', accent: true, tone: 'good' }, { t: 'works', accent: false }],
    [{ t: 'no', accent: false }, { t: 'busy', accent: true, tone: 'bad' }, { t: 'work', accent: false }],
    [{ t: 'ship', accent: true, tone: 'gold' }, { t: 'it', accent: false }],
  ]
  return sample.map((words, i) => ({
    start: i * 1.3,
    end: i * 1.3 + 1.2,
    position: i % 2 ? 'low' : 'mid',
    words,
    accentRange: [1, 1],
    accentFont: 'serif',
    accentColor: 'gold',
  }))
}

const segments = [
  { srcStart: 0, duration: DUR / 2, zoom: 'in' },
  { srcStart: DUR / 2, duration: DUR / 2, zoom: 'none' },
]

const VARIANTS = {
  base: { captionStyle: 'serif', grade: 'none' },
  v4: { captionStyle: 'eubank', grade: 'cinematic', graphics: [{ start: 0.5, duration: 2.5, kind: 'notes', title: 'the plan', items: ['step one', 'step two'] }] },
  v5: { captionStyle: 'viral', grade: 'none', matte: { file: MATTE_NAME, durationSec: 2 }, pagesBehind: true },
  v6: { captionStyle: 'koe', grade: 'cinematic', graphics: [{ start: 0.5, duration: 2.5, kind: 'title', title: 'the point' }] },
}

function baseProps(v) {
  const p = pages()
  if (v.pagesBehind) p[0].behind = true
  return {
    videoFile: SRC_NAME,
    width: 1080, height: 1920, fps: FPS,
    segments,
    pages: p,
    broll: [],
    transitionStyle: 'flash',
    captionStyle: v.captionStyle,
    grade: v.grade,
    hookSpotlight: false,
    handheld: true,
    splits: [],
    ...(v.matte ? { matte: v.matte } : {}),
    ...(v.graphics ? { graphics: v.graphics } : {}),
  }
}

function sh(cmd, args) {
  execFileSync(cmd, args, { cwd: DIR, stdio: 'inherit' })
}

function setup() {
  mkdirSync(PUBLIC_CACHE, { recursive: true })
  mkdirSync(OUT, { recursive: true })
  // Synthetic SDR source — the exact case tone mapping should leave untouched.
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
    `testsrc=size=1080x1920:rate=${FPS}:duration=${DUR}`, '-pix_fmt', 'yuv420p', SRC_PATH])
  // Transparent matte clip for v5's textBehindHook path (ProRes 4444 alpha).
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
    `color=c=black@0.0:size=1080x1920:rate=${FPS}:duration=2,format=yuva444p`,
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', MATTE_PATH])
}

function cleanup() {
  for (const f of [SRC_PATH, MATTE_PATH]) { try { rmSync(f) } catch {} }
}

function renderOne(key) {
  const propsPath = path.join(OUT, `${key}.props.json`)
  const outPath = path.join(OUT, `${key}.mp4`)
  writeFileSync(propsPath, JSON.stringify(baseProps(VARIANTS[key])))
  process.stdout.write(`\n── rendering ${key} (${VARIANTS[key].captionStyle}) ──\n`)
  // Local bin directly — npx runs a network preflight that can spuriously
  // fail on a DNS hiccup before the render even starts.
  const bin = path.join(DIR, 'node_modules', '.bin', 'remotion')
  sh(bin, ['render', 'src/Root.tsx', 'ShortEdit', outPath,
    `--props=${propsPath}`, '--codec=h264', `--frames=0-${DUR * FPS - 1}`, '--timeout=120000'])
  if (!existsSync(outPath)) throw new Error(`${key}: no output produced`)
  return outPath
}

const arg = process.argv[2] ?? 'all'
const keys = arg === 'all' ? Object.keys(VARIANTS) : [arg]
const results = []
try {
  setup()
  for (const k of keys) {
    try { results.push([k, 'PASS', renderOne(k)]) }
    catch (e) { results.push([k, 'FAIL', String(e).slice(0, 200)]) }
  }
} finally {
  cleanup()
}

console.log('\n===== variant render results =====')
for (const [k, status, detail] of results) console.log(`${status === 'PASS' ? '✅' : '❌'} ${k}: ${status}${status === 'FAIL' ? ' — ' + detail : ''}`)
process.exit(results.some(r => r[1] === 'FAIL') ? 1 : 0)
