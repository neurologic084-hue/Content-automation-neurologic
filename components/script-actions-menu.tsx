'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ConfirmModal } from '@/components/confirm-modal'

interface Folder {
  id: string
  name: string
}

interface Props {
  scriptId: string
  ideaId: string
  currentFolderId?: string | null
}

interface MenuPos {
  top: number
  right: number
}

export function ScriptActionsMenu({ scriptId, ideaId, currentFolderId }: Props) {
  const [mounted, setMounted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId ?? null)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => { setMounted(true) }, [])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setMenuPos(null)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      const target = e.target as Element
      if (!target.closest('[data-script-menu]') && !target.closest('[data-script-dot]')) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, closeMenu])

  function openMenu(btn: HTMLButtonElement) {
    const rect = btn.getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    setMenuOpen(o => !o)
  }

  async function openFolderModal() {
    closeMenu()
    const supabase = createClient()
    const { data } = await supabase.from('folders').select('id, name').order('name')
    setFolders(data ?? [])
    setSelectedFolderId(currentFolderId ?? null)
    setNewFolderName('')
    setCreatingFolder(false)
    setError(null)
    setShowFolderModal(true)
  }

  async function handleSaveFolder() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    let folderId: string | null = selectedFolderId

    if (newFolderName.trim()) {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: folder, error: insertError } = await supabase
        .from('folders')
        .insert({ name: newFolderName.trim(), user_id: user?.id })
        .select('id')
        .single()
      if (insertError) {
        setError(insertError.message || 'Could not create folder.')
        setSaving(false)
        return
      }
      folderId = folder?.id ?? null
    }

    const { error: updateError } = await supabase
      .from('scripts')
      .update({ folder_id: folderId })
      .eq('id', scriptId)

    if (updateError) {
      setError(updateError.message || 'Could not save.')
      setSaving(false)
      return
    }

    setSaving(false)
    setShowFolderModal(false)
    router.refresh()
  }

  async function handleDelete() {
    setDeleting(true)
    setShowDelete(false)
    const supabase = createClient()
    await supabase.from('scripts').delete().eq('id', scriptId)
    if (ideaId) await supabase.from('ideas').delete().eq('id', ideaId)
    router.refresh()
  }

  const saveDisabled = saving || (!newFolderName.trim() && selectedFolderId === (currentFolderId ?? null))

  return (
    <>
      <button
        data-script-dot
        onClick={e => { e.preventDefault(); openMenu(e.currentTarget) }}
        disabled={deleting}
        aria-label="Script options"
        aria-expanded={menuOpen}
        className="w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40"
        style={{
          background: menuOpen ? '#F0EFED' : 'transparent',
          color: '#A1A1AA',
          touchAction: 'manipulation',
        }}
      >
        {deleting ? (
          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg width="3" height="15" viewBox="0 0 3 15" fill="currentColor" aria-hidden="true">
            <circle cx="1.5" cy="1.5" r="1.5" />
            <circle cx="1.5" cy="7.5" r="1.5" />
            <circle cx="1.5" cy="13.5" r="1.5" />
          </svg>
        )}
      </button>

      {/* Dropdown   portaled to body so it escapes card stacking context */}
      {mounted && menuOpen && menuPos && createPortal(
        <div
          data-script-menu
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            zIndex: 9999,
            minWidth: 192,
          }}
          className="bg-white rounded-2xl border border-[#E4E4E0] shadow-2xl py-1 animate-fadeIn"
        >
          <button
            onClick={openFolderModal}
            className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[#18181B] hover:bg-[#F9F9F8] active:bg-[#F4F3F0] cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Move to folder
          </button>
          {currentFolderId && (
            <>
              <div style={{ height: 1, background: '#F0EFED', margin: '0 12px' }} />
              <button
                onClick={async () => {
                  closeMenu()
                  const supabase = createClient()
                  await supabase.from('scripts').update({ folder_id: null }).eq('id', scriptId)
                  router.refresh()
                }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[#71717A] hover:bg-[#F9F9F8] active:bg-[#F4F3F0] cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="17" y1="14" x2="11" y2="14" />
                </svg>
                Remove from folder
              </button>
            </>
          )}
          <div style={{ height: 1, background: '#F0EFED', margin: '0 12px' }} />
          <button
            onClick={() => { closeMenu(); setShowDelete(true) }}
            className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[#EF4444] hover:bg-[#FEF2F2] active:bg-[#FEE2E2] cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4h6v2" />
            </svg>
            Delete script
          </button>
        </div>,
        document.body
      )}

      {/* Folder picker   portaled to body */}
      {mounted && showFolderModal && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center p-4 animate-fadeIn"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', zIndex: 10000 }}
          onClick={() => setShowFolderModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-scaleIn"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4">
              <h3
                className="font-bold text-[#18181B] mb-1"
                style={{ fontSize: 16, fontFamily: 'var(--font-jakarta)' }}
              >
                Move to folder
              </h3>
              <p className="text-[13px] text-[#71717A] mb-4">
                {folders.length > 0 ? 'Pick a folder or create a new one.' : 'No folders yet. Create one below.'}
              </p>

              {folders.length > 0 && (
                <div className="space-y-0.5 mb-3 max-h-48 overflow-y-auto">
                  <button
                    onClick={() => { setSelectedFolderId(null); setCreatingFolder(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] text-left cursor-pointer"
                    style={{
                      background: selectedFolderId === null && !creatingFolder ? '#F4F3F0' : 'transparent',
                      color: '#71717A',
                      fontWeight: selectedFolderId === null && !creatingFolder ? 600 : 400,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                    No folder
                  </button>
                  {folders.map(f => (
                    <button
                      key={f.id}
                      onClick={() => { setSelectedFolderId(f.id); setCreatingFolder(false); setNewFolderName('') }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] text-left cursor-pointer"
                      style={{
                        background: selectedFolderId === f.id && !creatingFolder ? '#FFF3EF' : 'transparent',
                        color: selectedFolderId === f.id && !creatingFolder ? '#FF4F17' : '#18181B',
                        fontWeight: selectedFolderId === f.id && !creatingFolder ? 600 : 400,
                      }}
                    >
                      <svg
                        width="13" height="13" viewBox="0 0 24 24"
                        fill={selectedFolderId === f.id && !creatingFolder ? '#FF4F17' : 'none'}
                        stroke={selectedFolderId === f.id && !creatingFolder ? '#FF4F17' : 'currentColor'}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      {f.name}
                    </button>
                  ))}
                </div>
              )}

              {error && <p className="text-[12px] text-[#EF4444] mt-2 mb-1">{error}</p>}

              <div className="mt-1">
                {!creatingFolder ? (
                  <button
                    onClick={() => { setCreatingFolder(true); setSelectedFolderId(null) }}
                    className="flex items-center gap-2 text-[13px] text-[#FF4F17] font-medium cursor-pointer hover:opacity-75 transition-opacity"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New folder
                  </button>
                ) : (
                  <input
                    autoFocus
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newFolderName.trim()) handleSaveFolder()
                      if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                    }}
                    className="w-full px-3 py-2 text-[13px] rounded-xl border border-[#E4E4E0] outline-none"
                    style={{ background: '#FAFAFA' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#FF4F17' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#E4E4E0' }}
                  />
                )}
              </div>
            </div>

            <div style={{ height: 1, background: '#F0EFED' }} />

            <div className="px-5 py-3.5 flex justify-end gap-2.5">
              <button
                onClick={() => setShowFolderModal(false)}
                className="px-4 py-2 rounded-xl text-[13px] font-medium cursor-pointer border"
                style={{ borderColor: '#E4E4E0', color: '#5A5A57' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFolder}
                disabled={saveDisabled}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white cursor-pointer disabled:opacity-40"
                style={{ background: '#FF4F17', boxShadow: '0 4px 12px rgba(255,79,23,0.3)' }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmModal
        open={showDelete}
        title="Delete script"
        message="This permanently deletes the script and its idea. Cannot be undone."
        confirmLabel="Yes, delete"
        cancelLabel="No, keep it"
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
    </>
  )
}
