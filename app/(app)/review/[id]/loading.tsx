import { Pulse, Bone } from '@/components/skeletons'
export default function Loading() {
  return (
    <Pulse>
      <Bone className="h-8 w-3/4 mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => <Bone key={i} className="h-4 w-full" />)}
      </div>
    </Pulse>
  )
}
