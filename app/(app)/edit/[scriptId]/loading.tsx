import { Pulse, HeaderBones, CardGridBones } from '@/components/skeletons'
export default function Loading() {
  return (<Pulse><HeaderBones /><CardGridBones count={6} /></Pulse>)
}
