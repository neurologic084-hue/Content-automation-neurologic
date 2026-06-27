import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, DM_Sans, Geist_Mono } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700', '800'],
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dmsans',
  weight: ['300', '400', '500', '600'],
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: {
    default: 'Olympus | AI Creator Mode',
    template: '%s | Olympus',
  },
  description: 'Turn any idea into a scroll-stopping short-form script. AI picks the audience, writes the script, learns from every approval.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${dmSans.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
