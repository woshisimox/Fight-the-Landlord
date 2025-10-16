// lib/arenaStream.ts
import {
  GreedyMax,
  GreedyMin,
  RandomLegal,
  AllySupport,
  EndgameRush,
} from './doudizhu/engine';

import { MiniNetBot } from './bots/mininet_bot';

import { OpenAIBot } from './bots/openai_bot';
import { GeminiBot } from './bots/gemini_bot';
import { GrokBot }   from './bots/grok_bot';
import { KimiBot }   from './bots/kimi_bot';
import { QwenBot }   from './bots/qwen_bot';
import { DeepseekBot } from './bots/deepseek_bot';
import { HttpBot }   from './bots/http_bot';

// 最小 IBot 类型，避免类型依赖问题
export type IBot = (ctx: any) => any | Promise<any>;

const asBot = (fn: IBot, meta?: { choice?: string; phaseAware?: boolean }): IBot => {
  const wrapped: IBot = (ctx: Parameters<IBot>[0]) => fn(ctx);
  try {
    if (meta?.choice !== undefined) (wrapped as any).choice = meta.choice;
    if (meta?.phaseAware) (wrapped as any).phaseAware = true;
  } catch {}
  return wrapped;
};

export type BotSpec =
  | { kind: 'builtin'; name: 'greedy-max' | 'greedy-min' | 'random-legal' | 'ally-support' | 'endgame-rush' | 'mininet' }
  | { kind: 'ai'; name: 'openai' | 'gemini' | 'grok' | 'kimi' | 'qwen' | 'deepseek'; model?: string; apiKey?: string }
  | { kind: 'http'; baseUrl: string; token?: string };

export function getBot(spec: BotSpec, seatIdx: number): IBot {
  if (spec.kind === 'builtin') {
    if (spec.name === 'greedy-max') return asBot(GreedyMax, { choice: 'built-in:greedy-max' });
    if (spec.name === 'greedy-min') return asBot(GreedyMin, { choice: 'built-in:greedy-min' });
    if (spec.name === 'ally-support') return asBot(AllySupport, { choice: 'built-in:ally-support' });
    if (spec.name === 'endgame-rush') return asBot(EndgameRush, { choice: 'built-in:endgame-rush' });
    if (spec.name === 'mininet') return asBot(MiniNetBot, { choice: 'built-in:mininet', phaseAware: true });
    return asBot(RandomLegal, { choice: 'built-in:random-legal' });
  }

  if (spec.kind === 'ai') {
    const model = (spec.model || '').trim();

    const mark = (name: string, bot: IBot) => asBot(bot, { choice: `ai:${name}`, phaseAware: true });
    if (spec.name === 'openai') {
      return mark('openai', OpenAIBot({ apiKey: spec.apiKey || '', model: model || 'gpt-4o-mini' }));
    }
    if (spec.name === 'gemini') {
      return mark('gemini', GeminiBot({ apiKey: spec.apiKey || '', model: model || 'gemini-1.5-flash' }));
    }
    if (spec.name === 'grok') {
      return mark('grok', GrokBot({ apiKey: spec.apiKey || '', model: model || 'grok-2-latest' }));
    }
    if (spec.name === 'kimi') {
      return mark('kimi', KimiBot({ apiKey: spec.apiKey || '', model: model || 'moonshot-v1-8k' }));
    }
    if (spec.name === 'qwen') {
      return mark('qwen', QwenBot({ apiKey: spec.apiKey || '', model: model || 'qwen-plus' }));
    }
    if (spec.name === 'deepseek') {
      return mark('deepseek', DeepseekBot({ apiKey: spec.apiKey || '', model: model || 'deepseek-chat' }));
    }
  }

  if (spec.kind === 'http') {
    const base = (spec.baseUrl || '').replace(/\/$/, '');
    return asBot(HttpBot({ base, token: spec.token || '' }), { choice: 'http', phaseAware: true });
  }

  return asBot(GreedyMax, { choice: 'built-in:greedy-max' });
}
