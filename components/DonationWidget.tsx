import { useEffect, useMemo, useState } from 'react';

type DonationProvider = 'afdian' | 'buymeacoffee';

type Props = {
  lang: 'zh' | 'en';
  className?: string;
};

const AFDIAN_URL = process.env.NEXT_PUBLIC_AFDIAN_URL ?? 'https://afdian.net/a/ai-battle';
const BUYMEACOFFEE_URL = process.env.NEXT_PUBLIC_BMC_URL ?? 'https://www.buymeacoffee.com/ai-battle';

function resolveDefaultProvider(): DonationProvider {
  if (typeof window === 'undefined') {
    return 'buymeacoffee';
  }

  try {
    const languages = Array.from(window.navigator.languages || []);
    if (!languages.length && window.navigator.language) {
      languages.push(window.navigator.language);
    }
    const hasChineseLocale = languages.some(lang => /^zh(-|$)/i.test(lang));

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cnTimeZones = new Set([
      'Asia/Shanghai',
      'Asia/Chongqing',
      'Asia/Harbin',
      'Asia/Macau',
      'Asia/Hong_Kong',
      'Asia/Taipei',
      'Asia/Urumqi',
    ]);
    const inChinaTz = timeZone ? cnTimeZones.has(timeZone) : false;

    if (hasChineseLocale || inChinaTz) {
      return 'afdian';
    }
  } catch (err) {
    console.warn('[donation] failed to resolve locale, defaulting to BuyMeACoffee', err);
  }

  return 'buymeacoffee';
}

export default function DonationWidget({ lang, className }: Props) {
  const [provider, setProvider] = useState<DonationProvider>(() => resolveDefaultProvider());

  useEffect(() => {
    // Re-evaluate provider when the component hydrates on the client.
    if (typeof window === 'undefined') {
      return;
    }
    setProvider(resolveDefaultProvider());
  }, []);

  const { href, label } = useMemo(() => {
    if (provider === 'afdian') {
      return {
        href: AFDIAN_URL,
        label: lang === 'zh' ? '爱发电支持' : 'Support on Afdian',
      };
    }
    return {
      href: BUYMEACOFFEE_URL,
      label: lang === 'zh' ? 'BuyMeACoffee 支持' : 'Buy Me a Coffee',
    };
  }, [provider, lang]);

  const message = lang === 'zh'
    ? '所有捐赠均为自愿支持行为，不构成任何付费服务或权益，不可退款。'
    : 'Donations are voluntary and non-refundable. They do not affect gameplay, ranking, or AI access levels.';

  const handleClick = () => {
    if (typeof window === 'undefined') {
      return;
    }
    window.alert(message);
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      style={{
        padding: '6px 16px',
        borderRadius: 999,
        border: '1px solid #10b981',
        background: '#ecfdf5',
        color: '#047857',
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
