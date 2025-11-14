import Head from 'next/head';
import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { SEO_CONFIG, PageSeoMeta, buildTitle } from '../lib/seoConfig';

const DebugDock = dynamic(() => import('../components/DebugDock'), { ssr: false });

type PageWithSeo = AppProps['Component'] & PageSeoMeta;

export default function App({ Component, pageProps }: AppProps) {
  const PageComponent = Component as PageWithSeo;
  const router = useRouter();

  const title = buildTitle(PageComponent.seoTitle ?? SEO_CONFIG.defaultTitle);
  const description = PageComponent.seoDescription ?? SEO_CONFIG.description;
  const keywords = (PageComponent.seoKeywords && PageComponent.seoKeywords.length
    ? PageComponent.seoKeywords
    : SEO_CONFIG.keywords
  ).join(', ');

  const canonicalUrl = (() => {
    try {
      const path = router.asPath?.split('#')[0]?.split('?')[0] ?? '';
      return new URL(path || '/', SEO_CONFIG.siteUrl).toString();
    } catch {
      return SEO_CONFIG.siteUrl;
    }
  })();

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <meta name="keywords" content={keywords} />
        <meta name="author" content={SEO_CONFIG.author} />
        <meta name="robots" content="index,follow" />
        <meta name="theme-color" content={SEO_CONFIG.themeColor} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SEO_CONFIG.defaultTitle} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:locale" content={SEO_CONFIG.locale} />
        <meta property="og:image" content={SEO_CONFIG.socialImage} />
        <link rel="canonical" href={canonicalUrl} />
      </Head>
      <PageComponent {...pageProps} />
      <DebugDock />
    </>
  );
}
