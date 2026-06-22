'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ConfirmModal } from '@/components/confirm-modal'

export function DeleteScriptButton({ scriptId, ideaId }: { scriptId: string; ideaId: string }) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setDeleting(true)
    setOpen(false)
    const supabase = createClient()
    await supabase.from('scripts').delete().eq('id', scriptId)
    if (ideaId) await supabase.from('ideas').delete().eq('id', ideaId)
    router.refresh()
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); setOpen(true) }}
        disabled={deleting}
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer disabled:opacity-40"
        style={{ background: '#FEE2E2', color: '#EF4444' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#FECACA' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#FEE2E2' }}
        title="Delete script"
      >
        {deleting ? (
          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        )}
      </button>

      <ConfirmModal
        open={open}
        title="Delete script"
        message="This permanently deletes the script and its idea. Cannot be undone."
        confirmLabel="Yes, delete"
        cancelLabel="No, keep it"
        danger
        onConfirm={handleDelete}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}
