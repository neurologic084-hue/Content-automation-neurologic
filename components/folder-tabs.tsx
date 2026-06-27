'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ConfirmModal } from '@/components/confirm-modal'

interface Folder {
  id: string
  name: string
  count: number
}

interface Props {
  folders: Folder[]
  total: number
  unfiledCount: number
}

interface MenuPos {
  top: number
  left: number
}

export function FolderTabs({ folders: initialFolders, total, unfiledCount }: Props) {
  const [folders, setFolders] = useState(initialFolders)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setFolders(initialFolders) }, [initialFolders])

  const raw = searchParams.get('folder') ?? ''
  const selectedIds = raw ? raw.split(',').filter(Boolean) : []
  const isAllActive = selectedIds.length === 0
  const isUnfiledActive = selectedIds.includes('none')

  // Close dropdown on outside click
  const closeMenu = useCallback(() => {
    setOpenMenuId(null)
    setMenuPos(null)
  }, [])

  useEffect(() => {
    if (!openMenuId) return
    function handler(e: MouseEvent) {
      const target = e.target as Element
      if (!target.closest('[data-folder-menu]') && !target.closest('[data-folder-dot]')) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenuId, closeMenu])

  function openMenu(folderId: string, btn: HTMLButtonElement) {
    const rect = btn.getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 6, left: rect.left })
    setOpenMenuId(prev => prev === folderId ? null : folderId)
  }

  function buildUrl(ids: string[]) {
    const next = new URLSearchParams(searchParams.toString())
    if (ids.length === 0) next.delete('folder')
    else next.set('folder', ids.join(','))
    const qs = next.toString()
    return `${pathname}${qs ? `?${qs}` : ''}`
  }

  function toggleFolder(id: string) {
    closeMenu()
    if (selectedIds.includes(id)) {
      router.push(buildUrl(selectedIds.filter(x => x !== id)))
    } else {
      router.push(buildUrl([...selectedIds.filter(x => x !== 'none'), id]))
    }
  }

  function toggleUnfiled() {
    if (isUnfiledActive) {
      router.push(buildUrl(selectedIds.filter(x => x !== 'none')))
    } else {
      router.push(buildUrl([...selectedIds.filter(x => x !== 'none'), 'none']))
    }
  }

  async function createFolder() {
    if (!newName.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('folders')
      .insert({ name: newName.trim(), user_id: user?.id })
      .select('id, name')
      .single()
    setSaving(false)
    if (!error && data) {
      setFolders(f => [...f, { ...data, count: 0 }])
      setNewName('')
      setCreating(false)
      router.refresh()
    }
  }

  async function renameFolder(id: string) {
    if (!renameValue.trim()) { setRenaming(null); return }
    const supabase = createClient()
    const { error } = await supabase.from('folders').update({ name: renameValue.trim() }).eq('id', id)
    if (!error) {
      setFolders(f => f.map(x => x.id === id ? { ...x, name: renameValue.trim() } : x))
      router.refresh()
    }
    setRenaming(null)
  }

  async function deleteFolder() {
    if (!deleteTarget) return
    const supabase = createClient()
    await supabase.from('folders').delete().eq('id', deleteTarget.id)
    setFolders(f => f.filter(x => x.id !== deleteTarget.id))
    if (selectedIds.includes(deleteTarget.id)) {
      router.push(buildUrl(selectedIds.filter(x => x !== deleteTarget.id)))
    } else {
      router.refresh()
    }
    setDeleteTarget(null)
  }

  const activeFolder = folders.find(f => openMenuId === f.id)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">

        {/* All */}
        <button
          onClick={() => router.push(buildUrl([]))}
          className="h-9 px-4 rounded-full text-xs font-semibold cursor-pointer transition-colors"
          style={{
            background: isAllActive ? '#18181B' : '#F0EFED',
            color: isAllActive ? 'white' : '#71717A',
          }}
        >
          All {total}
        </button>

        {/* Folder pills */}
        {folders.map(folder => {
          const isSelected = selectedIds.includes(folder.id)
          const isMenuOpen = openMenuId === folder.id

          if (renaming === folder.id) {
            return (
              <input
                key={folder.id}
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') renameFolder(folder.id)
                  if (e.key === 'Escape') setRenaming(null)
                }}
                onBlur={() => renameFolder(folder.id)}
                className="h-9 px-3 rounded-full text-xs font-semibold border outline-none w-32"
                style={{ borderColor: '#FF4F17', background: '#FFF3EF', color: '#FF4F17' }}
              />
            )
          }

          return (
            <div key={folder.id} className="flex items-center h-9 rounded-full text-xs font-semibold"
              style={{
                background: isSelected ? '#FFF3EF' : '#F0EFED',
                color: isSelected ? '#FF4F17' : '#5A5A57',
                outline: isSelected || isMenuOpen ? '1.5px solid #FF4F17' : 'none',
              }}
            >
              {/* Folder name */}
              <button
                onClick={() => toggleFolder(folder.id)}
                className="flex items-center gap-1.5 h-full pl-3.5 pr-2 cursor-pointer rounded-l-full"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill={isSelected ? '#FF4F17' : '#A1A1AA'}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>{folder.name}</span>
                {folder.count > 0 && <span style={{ opacity: 0.5 }}>{folder.count}</span>}
              </button>

              {/* 3-dot trigger   always visible, uses portal for dropdown */}
              <button
                data-folder-dot
                onClick={e => openMenu(folder.id, e.currentTarget)}
                className="h-full px-3 flex items-center cursor-pointer rounded-r-full"
                style={{ color: isSelected ? '#FF4F17' : '#9A9A96' }}
                title="Folder options"
              >
                <svg width="3" height="13" viewBox="0 0 3 13" fill="currentColor">
                  <circle cx="1.5" cy="1.5" r="1.5" />
                  <circle cx="1.5" cy="6.5" r="1.5" />
                  <circle cx="1.5" cy="11.5" r="1.5" />
                </svg>
              </button>
            </div>
          )
        })}

        {/* Unfiled */}
        {unfiledCount > 0 && (
          <button
            onClick={toggleUnfiled}
            className="h-9 px-4 rounded-full text-xs font-semibold cursor-pointer"
            style={{
              background: isUnfiledActive ? '#F0EFED' : 'transparent',
              color: '#A1A1AA',
              border: '1px dashed #D4D4D0',
            }}
          >
            Unfiled {unfiledCount}
          </button>
        )}

        {/* New folder */}
        {creating ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              placeholder="Folder name..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createFolder()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              className="h-9 px-3.5 rounded-full text-xs border border-[#FF4F17] outline-none"
              style={{ background: '#FFF3EF', color: '#FF4F17', width: 130 }}
            />
            <button
              onClick={createFolder}
              disabled={saving || !newName.trim()}
              className="h-9 px-4 rounded-full text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
              style={{ background: '#FF4F17' }}
            >
              {saving ? '...' : 'Add'}
            </button>
            <button
              onClick={() => { setCreating(false); setNewName('') }}
              className="text-xs text-[#A1A1AA] cursor-pointer px-2"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="h-9 px-4 flex items-center gap-1.5 rounded-full text-xs font-medium cursor-pointer"
            style={{ color: '#A1A1AA', border: '1px dashed #D4D4D0' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New folder
          </button>
        )}
      </div>

      {/* Portal dropdown   renders at body level, never clipped */}
      {mounted && openMenuId && menuPos && activeFolder && createPortal(
        <div
          data-folder-menu
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 9999,
            minWidth: 168,
          }}
          className="bg-white rounded-2xl border border-[#E4E4E0] shadow-2xl py-1 animate-fadeIn"
        >
          <button
            onClick={() => {
              closeMenu()
              setRenaming(activeFolder.id)
              setRenameValue(activeFolder.name)
            }}
            className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[#18181B] hover:bg-[#F9F9F8] active:bg-[#F4F3F0] cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Rename
          </button>
          <div style={{ height: 1, background: '#F0EFED', margin: '0 12px' }} />
          <button
            onClick={() => {
              closeMenu()
              setDeleteTarget(activeFolder)
            }}
            className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[#EF4444] hover:bg-[#FEF2F2] active:bg-[#FEE2E2] cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4h6v2" />
            </svg>
            Delete folder
          </button>
        </div>,
        document.body
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.name}"?`}
        message="Scripts in this folder become unfiled. They will not be deleted."
        confirmLabel="Delete folder"
        cancelLabel="Keep it"
        danger
        onConfirm={deleteFolder}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
