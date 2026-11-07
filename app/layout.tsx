import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaunsa Card: which card should I swipe?",
  description: "Tell it what you're paying for and it picks which of your credit cards gives the most back. Built for Indian cards and UPI.",
  applicationName: "Kaunsa Card",
  appleWebApp: { capable: true, title: "Kaunsa Card", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1311",
};

// Set the theme before first paint so there's no light flash in dark mode.
const themeScript = `(function(){try{var t=JSON.parse(localStorage.getItem('cs.theme')||'"system"');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
