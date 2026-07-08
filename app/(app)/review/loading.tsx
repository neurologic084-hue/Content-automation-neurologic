import { Pulse, HeaderBones, ListBones } from '@/components/skeletons'
export default function Loading() {
  return (<Pulse><HeaderBones /><ListBones count={5} /></Pulse>)
}
