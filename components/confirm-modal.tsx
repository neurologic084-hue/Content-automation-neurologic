'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center animate-fadeIn"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', zIndex: 10000 }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="font-bold text-[#18181B] mb-1.5"
          style={{ fontSize: 16, fontFamily: 'var(--font-jakarta)' }}
        >
          {title}
        </h3>
        <p className="text-[13px] text-[#71717A] leading-relaxed mb-6">{message}</p>
        <div className="flex gap-2.5 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-[13px] font-medium cursor-pointer transition-colors"
            style={{ border: '1px solid #E4E4E0', color: '#5A5A57', background: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#D1D1CE'
              e.currentTarget.style.background = '#F9F9F8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#E4E4E0'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white cursor-pointer transition-all"
            style={{
              background: danger ? '#EF4444' : '#FF4F17',
              boxShadow: danger
                ? '0 4px 12px rgba(239,68,68,0.3)'
                : '0 4px 12px rgba(255,79,23,0.3)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
