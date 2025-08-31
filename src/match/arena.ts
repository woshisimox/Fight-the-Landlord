import fs from 'fs';
import path from 'path';
import { Engine } from '../game/engine';
import { DefaultRules, RuleConfig } from '../game/rules';
import { IBot } from '../game/engine';
import { RoundLog } from '../game/types';

export interface ArenaOptions {
  rounds: number;
  seed: number;
  rules: RuleConfig;
  outDir: string;
  bots: IBot[]; // length 3
}

export function runArena(opts: ArenaOptions) {
  const { rounds, seed, rules, outDir, bots } = opts;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const eng = new Engine({ seed, rules });
  const summary: { round: number; landlord: number; winner: string; multiplier: number; b: number; r: number; s: string; score0: number; score1: number; score2: number; }[] = [];
  let totalScores = [0,0,0];

  for (let i=0; i<rounds; i++) {
    // rotate seats per round so each bot plays各位置
    const rot = (idx: number) => bots[(i+idx)%3];
    const trio = [rot(0), rot(1), rot(2)];
    const log = eng.playRound(trio, i);
    if (!log) { i--; continue; } // redeal on all-pass; keep round index
    summary.push({
      round: i+1,
      landlord: log.landlord,
      winner: log.winner,
      multiplier: log.finalMultiplier,
      b: log.bombs,
      r: log.rocket,
      s: log.spring,
      score0: log.scores[0],
      score1: log.scores[1],
      score2: log.scores[2],
    });
    totalScores[0]+=log.scores[0];
    totalScores[1]+=log.scores[1];
    totalScores[2]+=log.scores[2];
    fs.writeFileSync(path.join(outDir, `round_${i+1}.json`), JSON.stringify(log, null, 2), 'utf-8');
  }

  // write summary.csv
  const header = 'round,landlord,winner,multiplier,bombs,rocket,spring,score0,score1,score2\n';
  const rows = summary.map(s=>[s.round,s.landlord,s.winner,s.multiplier,s.b,s.r,s.s,s.score0,s.score1,s.score2].join(','));
  fs.writeFileSync(path.join(outDir, 'summary.csv'), header + rows.join('\n'), 'utf-8');

  // also write totals
  fs.writeFileSync(path.join(outDir, 'totals.json'), JSON.stringify({ totalScores }, null, 2), 'utf-8');
}
