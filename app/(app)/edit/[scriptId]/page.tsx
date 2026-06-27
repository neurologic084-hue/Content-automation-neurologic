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
    .select('id, hook, body, cta, mood_tag, filming_plan')
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
          href={`/review/${scriptId}`}
          className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#71717A] transition-colors mb-4"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to script
        </Link>
        <h1
          className="text-2xl font-bold text-[#18181B]"
          style={{ fontFamily: 'var(--font-jakarta)' }}
        >
          Upload footage
        </h1>
        <p className="mt-1 text-sm text-[#71717A]">
          Record the script below, upload to Google Drive, then paste the link.
        </p>
      </div>

      {/* Filming guide — visible before uploading */}
      {(script.filming_plan?.shot_type || script.filming_plan?.setup || script.filming_plan?.wardrobe) && (
        <div className="animate-fadeInUp bg-[#FFF4F1] border border-[#FFCAB8] rounded-2xl p-5 mb-4" style={{ animationDelay: '40ms' }}>
          <p className="text-[11px] font-bold text-[#FF4F17] uppercase tracking-widest mb-3">Filming guide</p>
          <div className="space-y-2">
            {[
              { label: 'Shot', value: script.filming_plan?.shot_type },
              { label: 'Setup', value: script.filming_plan?.setup || script.filming_plan?.setup_notes || script.filming_plan?.location },
              { label: 'Wardrobe', value: script.filming_plan?.wardrobe },
            ].filter(i => i.value).map(item => (
              <div key={item.label} className="flex gap-3">
                <span className="text-xs font-semibold text-[#FF4F17] w-16 flex-shrink-0 pt-0.5">{item.label}</span>
                <span className="text-sm text-[#18181B]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="animate-fadeInUp" style={{ animationDelay: '80ms' }}>
        <VideoStudio
          script={script}
          existingJobId={job?.id ?? null}
        />
      </div>
    </div>
  )
}
