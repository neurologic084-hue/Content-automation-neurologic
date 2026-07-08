// Shared skeleton kit for route-level loading.tsx files. App Router streams
// a route's loading.tsx instantly while its server component fetches data, so
// every route gets an immediate paint that mirrors its real layout instead of
// a blank screen. Keep the shapes cheap and close to the real page.

// One "bone" — a pulsing gray block. w/h via className.
export function Bone({ className = '' }: { className?: string }) {
  return <div className={`rounded-lg bg-[#ECEAE6] ${className}`} />
}

// Wraps a skeleton tree in the pulse animation + the page's outer padding.
export function Pulse({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-pulse p-6 md:p-10 max-w-6xl w-full mx-auto" aria-hidden="true">
      {children}
    </div>
  )
}

// A page header: big title + subtitle line.
export function HeaderBones() {
  return (
    <div className="mb-8 space-y-3">
      <Bone className="h-8 w-64" />
      <Bone className="h-4 w-96 max-w-full" />
    </div>
  )
}

// A responsive grid of card bones — for library, publish job lists, studios.
export function CardGridBones({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[#E4E4E0] bg-white p-5 space-y-3">
          <Bone className="h-40 w-full" />
          <Bone className="h-5 w-3/4" />
          <Bone className="h-4 w-full" />
          <Bone className="h-9 w-full mt-2" />
        </div>
      ))}
    </div>
  )
}

// A vertical list of row bones — for feeds, script lists, published items.
export function ListBones({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[#E4E4E0] bg-white p-4 flex items-center gap-4">
          <Bone className="h-12 w-12 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-4 w-1/2" />
            <Bone className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

// A form: stacked label + input bones — for settings, new idea.
export function FormBones({ fields = 6 }: { fields?: number }) {
  return (
    <div className="max-w-2xl space-y-6">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Bone className="h-3.5 w-32" />
          <Bone className="h-11 w-full" />
        </div>
      ))}
      <Bone className="h-11 w-40" />
    </div>
  )
}
