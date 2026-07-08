import { Pulse, HeaderBones, Bone, CardGridBones } from '@/components/skeletons'
export default function Loading() {
  return (
    <Pulse>
      <HeaderBones />
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-8 w-24" />)}
      </div>
      <CardGridBones count={6} />
    </Pulse>
  )
}
