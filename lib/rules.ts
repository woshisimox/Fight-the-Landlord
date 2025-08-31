export type FourWithTwoMode = '2singles'|'2pairs'|'both';
export interface RuleConfig {
  bidding: 'call-score'|'rob';
  enableMingPai: 'none'|'see-bottom-x2'|'after-call-x3';
  fourWithTwo: FourWithTwoMode;
  allowWingsContain2OrJoker: boolean;
  springRule: 'std';
  robMultiplier: boolean;
}
export const DefaultRules: RuleConfig = {
  bidding: 'call-score', enableMingPai: 'none',
  fourWithTwo: 'both', allowWingsContain2OrJoker: false,
  springRule: 'std', robMultiplier: true,
};
