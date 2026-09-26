'use client'

import { useSyncExternalStore } from 'react'

const noopSubscribe = () => () => {}

/** False during SSR and hydration, true on the client after — for portals
 *  and anything touching `document`. Unlike a `mounted` flag set in an
 *  effect, this doesn't trigger a second render pass. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}
