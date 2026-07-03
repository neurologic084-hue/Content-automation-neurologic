import { redirect } from 'next/navigation'

// The Video Studio list merged into the Scripts hub — one place to film,
// edit, and publish. Per-script studio pages live at /edit/[scriptId].
export default function EditPage() {
  redirect('/library')
}
