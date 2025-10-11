
// Updated UI optimizations for the provided index.tsx

import { createContext, useContext, useEffect, useState } from 'react';

type Lang = 'zh' | 'en';
const LangContext = createContext<Lang>('zh');

// Updated translation and UI settings
const I18N: Record<Lang, Record<string, string>> = {
  zh: {
    Title: '斗地主 · Fight the Landlord',
    Settings: '对局设置',
    Enable: '启用对局',
    Reset: '清空',
    EnableHint: '关闭后不可开始/继续对局；再次勾选即可恢复。',
    LadderTitle: '天梯图（活动积分 ΔR）',
    LadderRange: '范围 ±K（按局面权重加权，当前 K≈{K}；未参赛=历史或0）',
    Pass: '过',
    Play: '出牌',
    Empty: '（空）',
    Upload: '上传',
    Save: '存档',
    FarmerCoop: '农民配合',
    Rounds: '局数',
    InitialScore: '初始分',
    Four2Rule: '4带2规则',
  },
  en: {
    Title: 'Fight the Landlord',
    Settings: 'Match settings',
    Enable: 'Enable match',
    Reset: 'Reset',
    EnableHint: 'Disabled matches cannot start/continue; tick again to restore.',
    LadderTitle: 'Ladder (ΔR)',
    LadderRange: 'Range ±K (weighted by situation, current K≈{K}; no-participation = history or 0)',
    Pass: 'Pass',
    Play: 'Play',
    Empty: '(empty)',
    Upload: 'Upload',
    Save: 'Save',
    FarmerCoop: 'Farmer cooperation',
    Rounds: 'Rounds',
    InitialScore: 'Initial Score',
    Four2Rule: '4-with-2 Rule',
  }
};

function useI18n() {
  const lang = useContext(LangContext);
  const t = (key: string, vars: Record<string, any> = {}) => {
    let s = (I18N[lang]?.[key] ?? I18N.zh[key] ?? key);
    s = s.replace(/\{(\w+)\}/g, (_: any, k: string) => (vars[k] ?? `{${k}}`));
    return s;
  };
  return { lang, t };
}

// Updated component for optimized UI
function SettingsPanel() {
  const { t } = useI18n();

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h3>{t('Settings')}</h3>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>{t('Rounds')}</label>
        <input type="number" placeholder="10" style={{ width: '100px', padding: '5px', fontSize: '14px' }} />
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>{t('InitialScore')}</label>
        <input type="number" placeholder="100" style={{ width: '100px', padding: '5px', fontSize: '14px' }} />
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>{t('Four2Rule')}</label>
        <select style={{ padding: '5px', fontSize: '14px', width: '150px' }}>
          <option>{t('Allowed')}</option>
          <option>{t('Not allowed')}</option>
        </select>
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
          <input type="checkbox" style={{ marginRight: '8px' }} />
          {t('Enable')}
        </label>
        <small>{t('EnableHint')}</small>
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between' }}>
        <button style={buttonStyle}>{t('Save')}</button>
        <button style={buttonStyle}>{t('Upload')}</button>
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: '8px 12px',
  backgroundColor: '#4CAF50',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
};

export default SettingsPanel;
