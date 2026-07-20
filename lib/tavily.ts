export interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
}

export interface TavilyResponse {
  answer?: string
  results: TavilyResult[]
  query: string
}

export async function searchWeb(query: string): Promise<TavilyResponse | null> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 8,
        include_domains: [
          'pubmed.ncbi.nlm.nih.gov',
          'healthline.com',
          'medicalnewstoday.com',
          'psychologytoday.com',
          'mindbodygreen.com',
          'functionalmedicineuniversity.com',
          'ifm.org',
          'nih.gov',
        ],
        exclude_domains: ['reddit.com', 'quora.com'],
      }),
    })

    if (!res.ok) {
      console.warn(`[tavily] search failed (${res.status}) — falling back to OpenRouter web search`)
      return openRouterWebSearch(query)
    }
    return await res.json()
  } catch {
    return openRouterWebSearch(query)
  }
}

// Backup researcher for when Tavily is down or out of credits: OpenRouter's
// web plugin, shaped into the same TavilyResponse the callers already consume.
// Costs an LLM call instead of a Tavily credit, so it is strictly a fallback —
// never the first choice while Tavily works.
async function openRouterWebSearch(query: string): Promise<TavilyResponse | null> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini:online',
        temperature: 0.2,
        messages: [{
          role: 'user',
          content:
            `Research this topic on the web and return ONLY JSON shaped as ` +
            `{"answer": string, "results": [{"title": string, "url": string, "content": string}]} ` +
            `with up to 6 results. Prefer medical/health sources (NIH, PubMed, Healthline). Topic: ${query}`,
        }],
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return null
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = body.choices?.[0]?.message?.content ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> }
    console.log('[tavily] OpenRouter web fallback answered')
    return {
      answer: parsed.answer,
      query,
      results: (parsed.results ?? [])
        .filter(r => r.title && r.content)
        .map(r => ({ title: r.title!, url: r.url ?? '', content: r.content!, score: 0.5 })),
    }
  } catch (e) {
    console.warn('[tavily] OpenRouter web fallback failed too:', (e as Error).message)
    return null
  }
}

// Run two targeted searches in parallel: research + viral angle
export async function searchWebEnhanced(idea: string, lane: string): Promise<TavilyResponse | null> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return null

  const laneContext: Record<string, string> = {
    adhd_parents: 'ADHD children nervous system functional medicine dopamine dysregulation',
    sympathetic_overdrive: 'anxiety nervous system dysregulation sympathetic overdrive cortisol functional medicine',
    burnout_professionals: 'burnout adrenal fatigue high performer nervous system recovery',
  }

  const context = laneContext[lane] || 'wellness functional medicine'

  const [researchRes, viralRes, redditRes] = await Promise.allSettled([
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${idea} ${context} research science mechanism 2024 2025`,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5,
        include_domains: ['pubmed.ncbi.nlm.nih.gov', 'healthline.com', 'nih.gov', 'medicalnewstoday.com', 'psychologytoday.com'],
      }),
    }),
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `viral short form video content "${idea}" trending health wellness creator hook`,
        search_depth: 'basic',
        include_answer: false,
        max_results: 3,
        exclude_domains: ['reddit.com', 'quora.com'],
      }),
    }),
    // Reddit: authentic community language   real words real people use about this problem
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${idea} ${context}`,
        search_depth: 'basic',
        include_answer: false,
        max_results: 4,
        include_domains: ['reddit.com'],
      }),
    }),
  ])

  const results: TavilyResult[] = []
  let answer: string | undefined

  if (researchRes.status === 'fulfilled' && researchRes.value.ok) {
    const data: TavilyResponse = await researchRes.value.json()
    if (data.answer) answer = data.answer
    results.push(...data.results)
  }

  if (viralRes.status === 'fulfilled' && viralRes.value.ok) {
    const data: TavilyResponse = await viralRes.value.json()
    results.push(...data.results)
  }

  if (redditRes.status === 'fulfilled' && redditRes.value.ok) {
    const data: TavilyResponse = await redditRes.value.json()
    results.push(...data.results.map(r => ({ ...r, title: `[Reddit] ${r.title}` })))
  }

  // All three Tavily calls came back empty or failed (down, or out of
  // credits) — fall through to the OpenRouter web fallback rather than
  // generating a script with zero research behind it.
  if (!results.length) {
    console.warn('[tavily] all enhanced searches empty — trying the OpenRouter web fallback')
    return openRouterWebSearch(`${idea} ${context} research mechanism`)
  }

  return { query: idea, answer, results }
}

// Recent news search for idea generation   pulls from niche-specific news sources
export async function searchNicheNews(topics: string): Promise<{ title: string; snippet: string }[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${topics} latest research study 2025`,
        search_depth: 'basic',
        topic: 'news',
        max_results: 8,
        include_answer: false,
        exclude_domains: ['reddit.com', 'quora.com', 'youtube.com'],
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).slice(0, 8).map((r: any) => ({
      title: r.title as string,
      snippet: ((r.content as string) || '').slice(0, 220),
    }))
  } catch {
    return []
  }
}

export function buildSearchQuery(idea: string, lane: string): string {
  const laneContext: Record<string, string> = {
    adhd_parents: 'ADHD children nervous system functional medicine',
    sympathetic_overdrive: 'anxiety nervous system regulation functional medicine',
    burnout_professionals: 'burnout nervous system recovery high performers',
  }
  const context = laneContext[lane] || 'wellness health'
  return `${idea} ${context} 2025`
}

export function formatSearchContext(response: TavilyResponse | null): string {
  if (!response) return ''

  const lines: string[] = []

  if (response.answer) {
    lines.push(`Key finding: ${response.answer}`)
    lines.push('')
  }

  response.results.slice(0, 5).forEach((r, i) => {
    lines.push(`[${i + 1}] ${r.title}`)
    lines.push(r.content.slice(0, 400))
    lines.push('')
  })

  return lines.join('\n').trim()
}
