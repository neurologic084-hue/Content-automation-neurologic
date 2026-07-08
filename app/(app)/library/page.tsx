import { createClient } from '@/lib/supabase/server'
import { getActiveSlot } from '@/lib/active-profile'
import Link from 'next/link'
import { ScriptActionsMenu } from '@/components/script-actions-menu'
import { FolderTabs } from '@/components/folder-tabs'

const MOOD_COLOR: Record<string, string> = {
  calm: '#6366F1',
  energetic: '#FF4F17',
  empathetic: '#EC4899',
  educational: '#0EA5E9',
  bold: '#EF4444',
  'story-driven': '#F59E0B',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

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
  // the whole library. Falls back to folder-less select if that column is missing.
  let allScripts: { id: string; idea_id: string; hook: string; body: string; cta: string; mood_tag: string | null; approved_at: string | null; folder_id: string | null }[] | null = null
  // Scripts and folders are independent — fetch together (one round trip, not two).
  const [scriptsRes, foldersRes] = await Promise.all([
    supabase
      .from('scripts')
      .select('id, idea_id, hook, body, cta, mood_tag, approved_at, folder_id')
      .eq('status', 'approved')
      .eq('profile_slot', slot)
      .order('approved_at', { ascending: false }),
    supabase.from('folders').select('id, name').order('name'),
  ])
  const { data: withFolder, error: folderColError } = scriptsRes

  if (folderColError) {
    // Rare: the folder_id column isn't there yet — retry without it.
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

  const folders = foldersRes.data

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
          Script library
        </h1>
        <p className="mt-1 text-sm text-[#71717A]">
          {total} approved script{total !== 1 ? 's' : ''}
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

      {/* Scripts */}
      {scripts && scripts.length > 0 ? (
        <div className="space-y-3">
          {scripts.map((script, i) => {
            const moodColor = script.mood_tag ? MOOD_COLOR[script.mood_tag] : '#A1A1AA'
            const folder = folders?.find(f => f.id === script.folder_id)

            return (
              <div
                key={script.id}
                className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#D0CCC8] hover:shadow-sm transition-all duration-150 hover-lift"
                style={{ animationDelay: `${Math.min(i, 8) * 40 + 120}ms` }}
              >
                <div className="flex items-start gap-4">
                  <Link href={`/review/${script.id}`} className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2.5">
                      {folder && (
                        <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#FFF3EF] text-[#FF4F17] font-medium">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="#FF4F17">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          {folder.name}
                        </span>
                      )}
                      {script.mood_tag && (
                        <span
                          className="text-xs px-2.5 py-1 rounded-full"
                          style={{ background: `${moodColor}15`, color: moodColor }}
                        >
                          {script.mood_tag}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[#18181B] leading-snug mb-1.5">
                      &ldquo;{script.hook}&rdquo;
                    </p>
                    <p className="text-xs text-[#71717A] line-clamp-2 leading-relaxed">
                      {script.body?.replace(/\n/g, ' ')}
                    </p>
                    {script.approved_at && (
                      <p className="text-xs text-[#A1A1AA] mt-2">
                        Approved {formatDate(script.approved_at)}
                      </p>
                    )}
                  </Link>

                  <div className="flex flex-col items-center flex-shrink-0 -mr-2">
                    <div className="w-8 h-8 rounded-xl bg-[#DCFCE7] flex items-center justify-center mb-1" aria-label="Approved" role="img">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                    <ScriptActionsMenu
                      scriptId={script.id}
                      ideaId={script.idea_id ?? ''}
                      currentFolderId={script.folder_id ?? null}
                    />
                  </div>
                </div>
              </div>
            )
          })}
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
              <p className="font-medium text-[#18181B] mb-1">Library is empty</p>
              <p className="text-sm text-[#A1A1AA] mb-4">Approved scripts will appear here.</p>
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
