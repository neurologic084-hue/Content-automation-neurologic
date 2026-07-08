import { Pulse, HeaderBones, Bone } from '@/components/skeletons'
export default function Loading() {
  return (
    <Pulse>
      <HeaderBones />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[#E4E4E0] bg-white p-5 space-y-3">
            <Bone className="h-4 w-24" /><Bone className="h-9 w-16" />
          </div>
        ))}
      </div>
      <Bone className="h-5 w-40 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-16 w-full" />)}
      </div>
    </Pulse>
  )
}
