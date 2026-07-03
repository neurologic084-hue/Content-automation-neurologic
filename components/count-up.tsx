'use client'

import { useEffect, useRef, useState } from 'react'

/** Animated number that counts from 0 to `value` with an ease-out curve.
 *  Respects prefers-reduced-motion (renders the final value immediately). */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number>(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || value === 0) {
      setDisplay(value)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      // easeOutExpo — fast start, gentle landing
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setDisplay(Math.round(eased * value))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])

  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{display}</span>
}
