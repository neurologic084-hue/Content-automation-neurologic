import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { MobileHeader } from '@/components/layout/mobile-header'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  // Try active profile first; fall back to any row with a name if the is_active
  // column doesn't exist yet or no row is marked active (graceful degradation).
  const { data: activeBrand } = await supabase
    .from('brand_settings')
    .select('creator_name')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  let hasSettings = !!(activeBrand?.creator_name?.trim())

  if (!hasSettings) {
    const { data: anyBrand } = await supabase
      .from('brand_settings')
      .select('creator_name')
      .neq('creator_name', '')
      .limit(1)
      .maybeSingle()
    hasSettings = !!(anyBrand?.creator_name?.trim())
  }

  return (
    <div className="flex min-h-dvh bg-[#FAFAF9]">
      <Sidebar hasSettings={hasSettings} />
      <main className="flex-1 flex flex-col min-w-0 pb-nav md:pb-0">
        <MobileHeader />
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
