export type BiddingMode = 'call-score'|'rob';
export type FourWithTwo = 'both'|'2singles'|'2pairs';

export interface RuleConfig {
  bidding: BiddingMode;
  fourWithTwo: FourWithTwo;
}

export const DefaultRules: RuleConfig = {
  bidding: 'call-score',
  fourWithTwo: 'both',
};
