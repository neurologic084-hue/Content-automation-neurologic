import Link from 'next/link'
import { VARIANT_DEFINITIONS } from '@/lib/video-pipeline'
import { TourTriggerButton } from '@/components/tour-trigger-button'
import {
  BIG_PICTURE, FAQ, LABELS, PAGE_GUIDES, PROBLEMS, STUDIO_OPTIONS,
  type GuideSectionId, type GuideStep,
} from '@/components/help/guide-content'

export const metadata = { title: 'Guide · Olympus' }

const JUMP: { id: GuideSectionId; label: string }[] = [
  { id: 'start', label: 'How it works' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'review', label: 'Review' },
  { id: 'film', label: 'Filming' },
  { id: 'studio', label: 'Video studio' },
  { id: 'styles', label: 'The six styles' },
  { id: 'options', label: 'Studio options' },
  { id: 'publish', label: 'Publish' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' },
  { id: 'labels', label: 'What labels mean' },
  { id: 'problems', label: 'If something goes wrong' },
  { id: 'faq', label: 'Questions' },
]

// The styles come from the same definitions the studio renders, so a renamed
// or retired style can never leave this page out of date.
const STYLES = VARIANT_DEFINITIONS.filter(v => !v.hidden).sort((a, b) => a.order - b.order)

export default function GuidePage() {
  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl w-full mx-auto">
      <header className="mb-6 animate-fadeInUp">
        <p className="text-[11px] font-bold text-[#FF4F17] uppercase tracking-widest mb-1">Guide</p>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
          How Olympus works
        </h1>
        <p className="mt-1 text-sm text-[#71717A] leading-relaxed">
          Everything in one place, in plain words. Jump to a section below, or read it top to bottom once.
        </p>
        <div className="mt-4">
          <TourTriggerButton />
        </div>
      </header>

      <nav aria-label="Guide sections" className="mb-8 flex flex-wrap gap-2 animate-fadeInUp" style={{ animationDelay: '40ms' }}>
        {JUMP.map(j => (
          <a
            key={j.id}
            href={`#${j.id}`}
            className="rounded-full border border-[#E4E4E0] bg-white px-3 py-1.5 text-xs font-medium text-[#52525B] transition-colors hover:border-[#FFD4C4] hover:text-[#FF4F17]"
          >
            {j.label}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        <Section id="start" eyebrow="Start here" title="The five steps, from idea to posted video">
          <p className="text-sm text-[#52525B] leading-relaxed mb-4">
            Every video goes through the same five steps. You make the decisions; Olympus does the heavy lifting in between.
          </p>
          <ol className="space-y-3">
            {BIG_PICTURE.map((s, i) => (
              <li key={s.step} className="rounded-xl border border-[#F0EFED] bg-[#FAFAF9] p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <NumberBadge n={i + 1} />
                  <p className="text-sm font-semibold text-[#18181B]">{s.step}</p>
                  <span className="ml-auto text-[11px] text-[#A1A1AA]">{s.time}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-[13px] leading-relaxed">
                  <p className="text-[#52525B]"><span className="font-semibold text-[#18181B]">You: </span>{s.you}</p>
                  <p className="text-[#52525B]"><span className="font-semibold text-[#FF4F17]">Olympus: </span>{s.olympus}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <PageSection id="ideas" eyebrow="Step 1" guide={PAGE_GUIDES.ideas} href="/ideas/new" cta="Start a new idea" />

        <PageSection id="review" eyebrow="Step 2" guide={PAGE_GUIDES.reviewDetail} href="/review" cta="Open the review queue">
          <p className="mt-4 text-[13px] text-[#52525B] leading-relaxed">
            <span className="font-semibold text-[#18181B]">Revise vs. reject: </span>
            Revise keeps the idea and asks for a better version based on your notes. Reject throws the script away. Either way, your feedback helps future scripts.
          </p>
        </PageSection>

        <Section id="film" eyebrow="Step 3" title="Filming your script">
          <Steps steps={[
            { title: 'Open the approved script', body: 'Go to Library or Review and open it. Check the filming plan: shot type, setup, and what to wear.' },
            { title: 'Use the teleprompter', body: 'Tap “Read it on camera”. The words scroll by themselves. Use Slower or Faster to match your pace; the space bar pauses.' },
            { title: 'Record in one go', body: 'Stumbles are fine. If you restart a sentence, keep going: Olympus keeps your last take and cuts the earlier one.' },
            { title: 'Upload to Google Drive', body: 'Put the video in Drive and share it as “Anyone with the link”. MP4 works best; very large MOV files can fail.' },
          ]} />
        </Section>

        <PageSection id="studio" eyebrow="Step 4" guide={PAGE_GUIDES.studio} href="/edit" cta="Open the video studio" />

        <Section id="styles" eyebrow="Step 4, continued" title="The six editing styles">
          <p className="text-sm text-[#52525B] leading-relaxed mb-4">
            Each style edits the same recording differently. Styles 1 to 3 are made by the <span className="font-semibold text-[#18181B]">Edit Engine</span>; styles 4 to 6 by Olympus&apos;s own <span className="font-semibold text-[#18181B]">Motion Lab</span>, which adds on-screen graphics. Start only the ones you want.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {STYLES.map((v, i) => (
              <div key={v.id} className="rounded-xl border border-[#F0EFED] bg-[#FAFAF9] p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <NumberBadge n={i + 1} />
                  <p className="text-sm font-semibold text-[#18181B]">{v.name}</p>
                  <span
                    className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={v.tool === 'submagic'
                      ? { background: '#EEF2FF', color: '#6366F1' }
                      : { background: '#FFF3EF', color: '#FF4F17' }}
                  >
                    {v.tool === 'submagic' ? 'Edit Engine' : 'Motion Lab'}
                  </span>
                </div>
                <p className="text-[13px] text-[#52525B] leading-relaxed">{v.description}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="options" eyebrow="Step 4, options" title="The studio options, explained">
          <p className="text-sm text-[#52525B] leading-relaxed mb-4">
            All of these start on <span className="font-semibold text-[#18181B]">Smart</span>, which is the right choice for most videos. They apply to every style you start.
          </p>
          <div className="space-y-4">
            {STUDIO_OPTIONS.map(group => (
              <div key={group.title}>
                <p className="text-sm font-semibold text-[#18181B]">{group.title}</p>
                <p className="text-[13px] text-[#71717A] leading-relaxed mb-2">{group.intro}</p>
                <dl className="space-y-1.5">
                  {group.options.map(o => (
                    <div key={o.name} className="text-[13px] leading-relaxed">
                      <dt className="inline font-semibold text-[#18181B]">{o.name}: </dt>
                      <dd className="inline text-[#52525B]">{o.body}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Section>

        <PageSection id="publish" eyebrow="Step 5" guide={PAGE_GUIDES.publish} href="/publish" cta="Open Publish" />

        <PageSection id="library" eyebrow="Everyday" guide={PAGE_GUIDES.library} href="/library" cta="Open the library" />

        <PageSection id="settings" eyebrow="Set once" guide={PAGE_GUIDES.settings} href="/settings" cta="Open settings" />

        <Section id="labels" eyebrow="Reference" title="What the labels mean">
          <div className="space-y-5">
            {LABELS.map(g => (
              <div key={g.group}>
                <p className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-widest mb-2">{g.group}</p>
                <dl className="space-y-2">
                  {g.items.map(item => (
                    <div key={item.name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                      <dt className="text-[13px] font-semibold text-[#18181B] sm:w-40 sm:flex-shrink-0">{item.name}</dt>
                      <dd className="text-[13px] text-[#52525B] leading-relaxed">{item.body}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Section>

        <Section id="problems" eyebrow="Troubleshooting" title="If something goes wrong">
          <p className="text-sm text-[#52525B] leading-relaxed mb-3">
            Most problems fix themselves or need one small step. Tap a problem to see what to do.
          </p>
          <Disclosures items={PROBLEMS.map(p => ({ q: p.problem, a: p.fix }))} />
        </Section>

        <Section id="faq" eyebrow="Questions" title="Common questions">
          <Disclosures items={FAQ} />
        </Section>
      </div>
    </div>
  )
}

function Section({ id, eyebrow, title, children }: { id: GuideSectionId; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-2xl border border-[#E4E4E0] bg-white p-5 sm:p-6">
      <p className="text-[11px] font-bold text-[#FF4F17] uppercase tracking-widest">{eyebrow}</p>
      <h2 id={`${id}-title`} className="mt-0.5 mb-3 text-lg font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function PageSection({ id, eyebrow, guide, href, cta, children }: {
  id: GuideSectionId
  eyebrow: string
  guide: { title: string; steps: GuideStep[]; tip?: string }
  href: string
  cta: string
  children?: React.ReactNode
}) {
  return (
    <Section id={id} eyebrow={eyebrow} title={guide.title}>
      <Steps steps={guide.steps} />
      {children}
      {guide.tip && (
        <p className="mt-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs leading-relaxed text-[#92400E]">
          <span className="font-semibold">Good to know: </span>{guide.tip}
        </p>
      )}
      <Link href={href} className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-[#FF4F17] hover:underline">
        {cta}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </Section>
  )
}

function Steps({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <NumberBadge n={i + 1} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#18181B]">{s.title}</p>
            <p className="mt-0.5 text-[13px] text-[#52525B] leading-relaxed">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function NumberBadge({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#FF4F17] text-[10px] font-bold text-white">
      {n}
    </span>
  )
}

// Native <details>: works without JavaScript and is keyboard/screen-reader friendly.
function Disclosures({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-[#F0EFED] rounded-xl border border-[#F0EFED]">
      {items.map(item => (
        <details key={item.q} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-start gap-3 text-[13px] font-semibold text-[#18181B]">
            <span className="flex-1 leading-relaxed">{item.q}</span>
            <svg className="mt-0.5 flex-shrink-0 text-[#A1A1AA] transition-transform group-open:rotate-45" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </summary>
          <p className="mt-2 text-[13px] text-[#52525B] leading-relaxed">{item.a}</p>
        </details>
      ))}
    </div>
  )
}
