import { Suspense } from "react";

import { ConditionalSiteHeader } from "@/components/layouts/conditional-site-header";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { stackClientApp } from "../stack/client";
import { ThemeProvider } from "@/components/providers";
import { TailwindIndicator } from "@/components/tailwind-indicator";
import { UploadThingSSR } from "@/components/uploadthing-ssr";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

import "@/styles/globals.css";

import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Toaster } from "@/components/ui/sonner";
import { fontMono, fontSans, feijoaDisplay, obviouslyRegular, obviouslySemiBold } from "@/lib/fonts";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "nextjs",
    "react",
    "event management",
    "attendance tracking",
    "community membership",
    "kairos london",
  ],
  authors: [
    {
      name: "Kairos London",
      url: "https://kairos.london",
    },
  ],
  creator: "Kairos London",
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [`${siteConfig.url}/og.jpg`],
  },
  icons: {
    icon: "/icon.png",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default function RootLayout({ children }: React.PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable,
          fontMono.variable,
          feijoaDisplay.variable,
          obviouslyRegular.variable,
          obviouslySemiBold.variable,
        )}
      >
        <StackProvider app={stackClientApp}>
          <StackTheme>
            <Suspense>
              <UploadThingSSR />
            </Suspense>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <div className="relative flex min-h-screen flex-col">
                <ConditionalSiteHeader />
                <main className="flex-1">{children}</main>
              </div>
              <TailwindIndicator />
            </ThemeProvider>
            <Toaster />
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
