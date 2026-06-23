import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { VideoStudio } from './video-studio'

export default async function EditScriptPage({
  params,
}: {
  params: Promise<{ scriptId: string }>
}) {
  const { scriptId } = await params
  const supabase = await createClient()

  const { data: script } = await supabase
    .from('scripts')
    .select('id, hook, body, cta, mood_tag')
    .eq('id', scriptId)
    .eq('status', 'approved')
    .single()

  if (!script) notFound()

  const { data: job } = await supabase
    .from('video_jobs')
    .select('id, status')
    .eq('script_id', scriptId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl w-full mx-auto">

      <div className="mb-6 animate-fadeInUp" style={{ animationDelay: '0ms' }}>
        <Link
          href="/edit"
          className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#71717A] transition-colors mb-4"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Video Studio
        </Link>
        <h1
          className="text-2xl font-bold text-[#18181B]"
          style={{ fontFamily: 'var(--font-jakarta)' }}
        >
          Edit footage
        </h1>
        <p className="mt-1 text-sm text-[#71717A]">
          Add your recorded footage and generate 10 variants automatically.
        </p>
      </div>

      <div className="animate-fadeInUp" style={{ animationDelay: '60ms' }}>
        <VideoStudio
          script={script}
          existingJobId={job?.id ?? null}
        />
      </div>
    </div>
  )
}
