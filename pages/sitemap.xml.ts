import type { GetServerSideProps } from 'next';
import { SEO_CONFIG } from '../lib/seoConfig';

const STATIC_PATHS = [''];

function buildSiteMap(): string {
  const baseUrl = SEO_CONFIG.siteUrl.replace(/\/$/, '');
  const updated = new Date().toISOString();

  const urls = STATIC_PATHS.map((path) => {
    const loc = `${baseUrl}${path ? `/${path}` : ''}`;
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${updated}</lastmod>`,
      '    <changefreq>daily</changefreq>',
      '    <priority>0.7</priority>',
      '  </url>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ].join('\n');
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const siteMap = buildSiteMap();

  res.setHeader('Content-Type', 'text/xml');
  res.write(siteMap);
  res.end();

  return { props: {} };
};

export default function SiteMap() {
  return null;
}
