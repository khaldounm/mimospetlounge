import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ThemeRegistry from "@/components/ui/ThemeRegistry";
import { CLINIC } from "@/constants/clinic";
import { COLOR_MODE_COOKIE } from "@/constants/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: CLINIC.name,
  description: `${CLINIC.name} management system`,
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-image-preview": "none",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialMode =
    cookieStore.get(COLOR_MODE_COOKIE)?.value === "dark" ? "dark" : "light";

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ThemeRegistry initialMode={initialMode}>{children}</ThemeRegistry>
        {/* Both are no-ops off Vercel, so local development is unaffected. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
