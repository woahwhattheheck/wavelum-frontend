import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { ErrorBoundary } from '@/components/errors';
import { AriaLiveRegion, LocaleSwitcher, SkipLink, ToastProvider, WebVitals } from '@/components/ui';
import { WalletConnector, WalletProvider } from '@/features/wallet';
import { routing } from '@/i18n/routing';
import { ApiClientProvider } from '@/src/providers/ApiClientProvider';
import { QueryProvider } from '@/src/providers/QueryProvider';
import { ThemeProvider } from '@/src/providers/ThemeProvider';
import '../globals.css';

const themeInitScript = `(function(){try{var t='system';var raw=localStorage.getItem('lumina-ui');if(raw){var s=JSON.parse(raw).state;if(s&&s.theme)t=s.theme;}var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.classList.toggle('light',!d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'], display: 'swap', preload: true });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], display: 'swap', preload: true });

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'HomePage' });
  return { title: t('title'), description: t('subtitle') };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SkipLink />
        <AriaLiveRegion />
        <WebVitals />
        <ThemeProvider>
          <QueryProvider>
            <NextIntlClientProvider messages={messages}>
              <ErrorBoundary>
                <ToastProvider>
                  <ApiClientProvider>
                    <WalletProvider>
                      <div className="flex items-center justify-end gap-3 p-4">
                        <LocaleSwitcher />
                        <WalletConnector />
                      </div>
                      {children}
                    </WalletProvider>
                  </ApiClientProvider>
                </ToastProvider>
              </ErrorBoundary>
            </NextIntlClientProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
