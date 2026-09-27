import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, JetBrains_Mono, Outfit, Space_Grotesk } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
// The ABB UI fonts are SELF-HOSTED via next/font (downloaded at build time and
// served from this origin) instead of a runtime Google Fonts @import: no
// render-blocking third-party request, and the UI renders correctly on an
// air-gapped plant network.
const outfit = Outfit({ variable: '--font-outfit', subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800'] })
const spaceGrotesk = Space_Grotesk({ variable: '--font-space-grotesk', subsets: ['latin'], weight: ['300', '400', '500', '600', '700'] })
const jetbrainsMono = JetBrains_Mono({ variable: '--font-jetbrains-mono', subsets: ['latin'], weight: ['300', '400', '500', '600', '700'] })
const fontVars = [geistSans, geistMono, outfit, spaceGrotesk, jetbrainsMono].map((f) => f.variable).join(' ')

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
    // Stage UI-2: root flipped to the LIGHT ABB control-system surface. Home/Login
    // already paint their own opaque .abb-page (light), so they're unaffected.
    // Restyled dashboards (Plant) inherit this light base; Field/Technician keep
    // their own dark body styling (set on their page roots) until their passes.
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <head>
        {/* Runs before first paint — prevents flash of wrong theme on reload. */}
        <Script
          id="theme-initializer"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nexops_theme');var d=document.documentElement;if(t==='dark'){d.classList.add('dark');}else if(t==='light'){d.classList.add('light');}else if(window.matchMedia('(prefers-color-scheme:dark)').matches){d.classList.add('dark');}}catch(e){}})();`
          }}
        />
      </head>
      <body
        className="font-sans antialiased"
        style={{ background: 'var(--abb-surface-0)', color: 'var(--abb-ink-1)' }}
        suppressHydrationWarning
      >
        <div style={{ minHeight: '100vh', background: 'var(--abb-surface-0)', color: 'var(--abb-ink-1)' }}>
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
        </div>
        {/* Vercel Analytics only exists on Vercel; elsewhere its script 404s. */}
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
