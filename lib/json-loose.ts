// Tolerant JSON extraction for LLM responses. Even with JSON mode on, fast
// models occasionally wrap the object in markdown fences or trail extra text —
// which turned a whole B-roll plan into [] once. Strip fences, then extract the
// first balanced JSON object and parse just that.
export function parseJsonLoose<T>(raw: string): T {
  const unfenced = raw.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(unfenced) as T
  } catch { /* fall through to balanced-brace extraction */ }

  const start = unfenced.indexOf('{')
  if (start === -1) throw new Error('no JSON object found in response')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(unfenced.slice(start, i + 1)) as T
    }
  }
  throw new Error('unbalanced JSON object in response')
}
