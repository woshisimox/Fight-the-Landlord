import { useEffect, useMemo, useState } from 'react';

import { WECHAT_QR_DATA_URL } from './wechatQrData';

type DonationProvider = 'wechat' | 'buymeacoffee';

type Props = {
  lang: 'zh' | 'en';
  className?: string;
};

const BUYMEACOFFEE_URL =
  process.env.NEXT_PUBLIC_BMC_URL ?? 'https://buymeacoffee.com/aigamingonline';

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
      return 'wechat';
    }
  } catch (err) {
    console.warn('[donation] failed to resolve locale, defaulting to BuyMeACoffee', err);
  }

  return 'buymeacoffee';
}

export default function DonationWidget({ lang, className }: Props) {
  const [detectedProvider, setDetectedProvider] = useState<DonationProvider>(() => resolveDefaultProvider());

  useEffect(() => {
    // Re-evaluate provider when the component hydrates on the client.
    if (typeof window === 'undefined') {
      return;
    }
    setDetectedProvider(resolveDefaultProvider());
  }, []);

  const provider: DonationProvider = useMemo(
    () => (lang === 'en' ? 'buymeacoffee' : detectedProvider),
    [detectedProvider, lang],
  );

  const { href, label } = useMemo(() => {
    if (provider === 'wechat') {
      return {
        href: null as string | null,
        label: lang === 'zh' ? '微信打赏' : 'WeChat Support',
      };
    }

    return {
      href: BUYMEACOFFEE_URL,
      label: lang === 'zh' ? 'BuyMeACoffee 支持' : 'Buy Me a Coffee',
    };
  }, [lang, provider]);

  const message = lang === 'zh'
    ? '所有捐赠均为自愿支持行为，不构成任何付费服务或权益，不可退款。'
    : 'Donations are voluntary and non-refundable. They do not affect gameplay, ranking, or AI access levels.';

  const [showWechatModal, setShowWechatModal] = useState(false);

  const handleClick = () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (provider === 'wechat') {
      window.setTimeout(() => setShowWechatModal(true), 0);
      return;
    }

    window.alert(message);
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <>
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
      {provider === 'wechat' && showWechatModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="donation-wechat-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setShowWechatModal(false)}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '24px 28px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.2)',
              maxWidth: 360,
              width: '100%',
              textAlign: 'center',
            }}
          >
            <h3
              id="donation-wechat-title"
              style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#047857' }}
            >
              {lang === 'zh' ? '微信捐赠' : 'WeChat Donation'}
            </h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.5, color: '#374151', fontSize: 14 }}>
              {message}
            </p>
            <img
              src={WECHAT_QR_DATA_URL}
              alt={lang === 'zh' ? '微信打赏收款码' : 'WeChat donation QR code'}
              style={{
                display: 'block',
                width: '100%',
                maxWidth: 260,
                margin: '0 auto',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            />
            <button
              type="button"
              onClick={() => setShowWechatModal(false)}
              style={{
                marginTop: 20,
                padding: '6px 16px',
                borderRadius: 999,
                border: '1px solid #10b981',
                background: '#ecfdf5',
                color: '#047857',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {lang === 'zh' ? '关闭' : 'Close'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
