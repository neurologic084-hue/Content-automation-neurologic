import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const { data: brand } = await supabase.from('brand_settings').select('creator_name').eq('is_active', true).single()
  const hasSettings = !!(brand?.creator_name && brand.creator_name.trim().length > 0)

  return (
    <div className="flex min-h-dvh bg-[#FAFAF9]">
      <Sidebar hasSettings={hasSettings} />
      <main className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
