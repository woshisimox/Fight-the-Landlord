import fs from 'fs';

export type FourWithTwoMode = '2singles' | '2pairs' | 'both';

export interface RuleConfig {
  bidding: 'call-score' | 'rob';   // 叫分 or 叫/抢地主
  enableMingPai: 'none' | 'see-bottom-x2' | 'after-call-x3';
  fourWithTwo: FourWithTwoMode;    // 四带二带牌方式
  allowWingsContain2OrJoker: boolean; // 飞机带翅是否允许含2/王（默认 false）
  springRule: 'std';               // 先实现标准 spring/antispring
  robMultiplier: boolean;          // 抢地主是否每抢×2
}

export const DefaultRules: RuleConfig = {
  bidding: 'call-score',
  enableMingPai: 'none',
  fourWithTwo: 'both',
  allowWingsContain2OrJoker: false,
  springRule: 'std',
  robMultiplier: true,
};

export function loadRuleText(path: string): string {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}
