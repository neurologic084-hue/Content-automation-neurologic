import { createClient } from '@/lib/supabase/server'
import { getActiveSlot } from '@/lib/active-profile'
import Link from 'next/link'
import { FolderTabs } from '@/components/folder-tabs'
import { ScriptsHubList, type HubJob } from '@/components/scripts-hub-list'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>
}) {
  const { folder: folderParam } = await searchParams
  const selectedFolderIds = folderParam ? folderParam.split(',').filter(Boolean) : []
  const supabase = await createClient()
  const slot = await getActiveSlot(supabase)

  // Approved scripts for the ACTIVE profile only — switching profiles swaps
  // the whole hub. Falls back to folder-less select if that column is missing.
  let allScripts: { id: string; idea_id: string; hook: string; body: string; cta: string; mood_tag: string | null; approved_at: string | null; folder_id: string | null }[] | null = null
  const { data: withFolder, error: folderColError } = await supabase
    .from('scripts')
    .select('id, idea_id, hook, body, cta, mood_tag, approved_at, folder_id')
    .eq('status', 'approved')
    .eq('profile_slot', slot)
    .order('approved_at', { ascending: false })

  if (folderColError) {
    const { data: withoutFolder } = await supabase
      .from('scripts')
      .select('id, idea_id, hook, body, cta, mood_tag, approved_at')
      .eq('status', 'approved')
      .eq('profile_slot', slot)
      .order('approved_at', { ascending: false })
    allScripts = withoutFolder?.map(s => ({ ...s, folder_id: null })) ?? null
  } else {
    allScripts = withFolder
  }

  // Video pipeline state per script — powers the stage badges and actions
  const jobsByScript: Record<string, HubJob> = {}
  const { data: jobs } = await supabase
    .from('video_jobs')
    .select('id, script_id, status, selected_variant')
    .eq('profile_slot', slot)
  for (const j of jobs ?? []) {
    jobsByScript[j.script_id] = { id: j.id, status: j.status, selected_variant: j.selected_variant }
  }

  const { data: folders } = await supabase.from('folders').select('id, name').order('name')

  const total = allScripts?.length ?? 0
  const unfiledCount = allScripts?.filter(s => !s.folder_id).length ?? 0

  const scripts = selectedFolderIds.length === 0
    ? allScripts
    : allScripts?.filter(s => {
        if (selectedFolderIds.includes('none') && !s.folder_id) return true
        if (s.folder_id && selectedFolderIds.includes(s.folder_id)) return true
        return false
      })

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl w-full mx-auto">

      {/* Header */}
      <div className="mb-6 animate-fadeInUp" style={{ animationDelay: '0ms' }}>
        <h1
          className="text-2xl font-bold text-[#18181B]"
          style={{ fontFamily: 'var(--font-jakarta)' }}
        >
          Scripts
        </h1>
        <p className="mt-1 text-sm text-[#71717A]">
          {total} approved script{total !== 1 ? 's' : ''} — film, edit, and publish from here.
        </p>
      </div>

      {/* Folder tabs — always shown (includes New folder button) */}
      <div className="animate-fadeInUp mb-5" style={{ animationDelay: '60ms' }}>
        <FolderTabs
          folders={(folders ?? []).map(f => ({
            ...f,
            count: allScripts?.filter(s => s.folder_id === f.id).length ?? 0,
          }))}
          total={total}
          unfiledCount={unfiledCount}
        />
      </div>

      {selectedFolderIds.length > 0 && (
        <p className="text-xs text-[#A1A1AA] mb-4 animate-fadeIn">
          {scripts?.length ?? 0} script{(scripts?.length ?? 0) !== 1 ? 's' : ''} in {selectedFolderIds.length} filter{selectedFolderIds.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Scripts hub — stage filter + video status + context actions */}
      {scripts && scripts.length > 0 ? (
        <div className="animate-fadeInUp" style={{ animationDelay: '100ms' }}>
          <ScriptsHubList
            scripts={scripts}
            jobsByScript={jobsByScript}
            folders={folders ?? []}
          />
        </div>
      ) : (
        <div
          className="text-center py-16 bg-white border border-[#E4E4E0] border-dashed rounded-2xl animate-fadeInUp"
          style={{ animationDelay: '80ms' }}
        >
          {selectedFolderIds.length > 0 ? (
            <>
              <p className="font-medium text-[#18181B] mb-1">Nothing here yet</p>
              <p className="text-sm text-[#A1A1AA] mb-4">
                Use the 3-dot menu on any script card to move it to a folder.
              </p>
              <Link href="/library" className="text-sm text-[#FF4F17] hover:underline">
                View all scripts
              </Link>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-2xl bg-[#F4F3F0] flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <p className="font-medium text-[#18181B] mb-1">No scripts yet</p>
              <p className="text-sm text-[#A1A1AA] mb-4">Approved scripts will appear here, ready to film and publish.</p>
              <Link
                href="/ideas/new"
                className="shine-sweep inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold transition-all hover-lift"
                style={{ background: 'linear-gradient(120deg, #FF5C26 0%, #FF4F17 45%, #F03D05 100%)', boxShadow: '0 4px 14px rgba(255,79,23,0.25)' }}
              >
                Create first script
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
