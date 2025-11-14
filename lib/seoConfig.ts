export const SEO_CONFIG = {
  siteUrl: 'https://ai-gaming.online',
  defaultTitle: 'Fight the Landlord · AI Battle Platform',
  titleTemplate: '%s | AI Battle Platform',
  description:
    'AI Battle Platform (ai-gaming.online) is an open-source AI competition arena for Fight the Landlord, Mahjong, and more, enabling prompt-driven development and evaluation across models.',
  keywords: [
    'Fight the Landlord AI',
    'AI Battle Platform',
    '斗地主 AI',
    'Mahjong AI',
    'AI gaming',
    'Codex',
  ],
  locale: 'zh_CN',
  author: 'AI Battle Platform Team',
  themeColor: '#0f172a',
  socialImage: 'https://ai-gaming.online/api/og',
};

export type SeoConfig = typeof SEO_CONFIG;

export type PageSeoMeta = {
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];
};

export function buildTitle(title?: string): string {
  if (!title || title === SEO_CONFIG.defaultTitle) {
    return SEO_CONFIG.defaultTitle;
  }
  return SEO_CONFIG.titleTemplate.replace('%s', title);
}
