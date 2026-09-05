import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'Trip Tracker',
  description: 'Share your live location with the people you are travelling with — on your terms.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111624' },
  ],
  width: 'device-width',
  initialScale: 1,
  // The map is a full-height surface; let it use the whole screen on mobile.
  viewportFit: 'cover',
};

/**
 * Applies the stored theme before first paint. Without this the page renders in the
 * system theme and then flips, which is very visible on a full-screen dark map.
 */
const themeScript = `(function(){try{var t=localStorage.getItem('trip-tracker.theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-surface-subtle text-fg antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
