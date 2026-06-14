import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'NexOps',
  description: 'The control room intelligence layer — AI-prioritized alarms, automated dispatch, and institutional memory.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} bg-[#0a0b0d]`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-[#0a0b0d] text-[#e2e8f0]" suppressHydrationWarning>
        <div className="min-h-screen bg-[#0a0b0d] text-[#e2e8f0]">
          {/* Grid background */}
          <div className="fixed inset-0 z-0 pointer-events-none bg-[#0a0b0d] bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:44px_44px]" />
          
          {/* Red glow effect */}
          <div
            className="fixed pointer-events-none z-0"
            style={{
              bottom: '-100px',
              right: '-100px',
              width: '480px',
              height: '480px',
              background: 'radial-gradient(circle, rgba(185,28,28,0.18) 0%, transparent 70%)',
            }}
          />
          
          <div className="relative z-10">
            {children}
          </div>
        </div>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
