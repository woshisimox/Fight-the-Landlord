import type { NextApiRequest, NextApiResponse } from 'next';

import type { BotSpec } from '../../lib/arenaStream';
import { runTripleElimination, type ParticipantEntry, type TournamentOptions } from '../../lib/elimination';
import { defaultConfig } from '../../lib/trueskill';

const OK_METHOD = 'POST';

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:mininet'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type ParticipantPayload = {
  id?: string;
  label?: string;
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  httpBase?: string;
  httpToken?: string;
};

type RequestBody = {
  participants?: ParticipantPayload[];
  gamesPerRound?: number;
  seed?: number;
  config?: Partial<{
    mu: number;
    sigma: number;
    beta: number;
    tau: number;
  }>;
};

type ErrorResponse = { ok: false; error: string };
type SuccessResponse = { ok: true; result: Awaited<ReturnType<typeof runTripleElimination>> };
type ApiResponse = ErrorResponse | SuccessResponse;

function defaultLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max': return 'Greedy Max';
    case 'built-in:greedy-min': return 'Greedy Min';
    case 'built-in:random-legal': return 'Random Legal';
    case 'built-in:mininet': return 'MiniNet';
    case 'built-in:ally-support': return 'AllySupport';
    case 'built-in:endgame-rush': return 'EndgameRush';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok': return 'Grok';
    case 'ai:kimi': return 'Kimi';
    case 'ai:qwen': return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
    case 'http': return 'HTTP';
    default: return choice;
  }
}

function specFromChoice(payload: ParticipantPayload): BotSpec | null {
  const { choice } = payload;
  switch (choice) {
    case 'built-in:greedy-max': return { kind: 'builtin', name: 'greedy-max' };
    case 'built-in:greedy-min': return { kind: 'builtin', name: 'greedy-min' };
    case 'built-in:random-legal': return { kind: 'builtin', name: 'random-legal' };
    case 'built-in:mininet': return { kind: 'builtin', name: 'mininet' };
    case 'built-in:ally-support': return { kind: 'builtin', name: 'ally-support' };
    case 'built-in:endgame-rush': return { kind: 'builtin', name: 'endgame-rush' };
    case 'ai:openai': return { kind: 'ai', name: 'openai', model: payload.model, apiKey: payload.apiKey };
    case 'ai:gemini': return { kind: 'ai', name: 'gemini', model: payload.model, apiKey: payload.apiKey };
    case 'ai:grok': return { kind: 'ai', name: 'grok', model: payload.model, apiKey: payload.apiKey };
    case 'ai:kimi': return { kind: 'ai', name: 'kimi', model: payload.model, apiKey: payload.apiKey };
    case 'ai:qwen': return { kind: 'ai', name: 'qwen', model: payload.model, apiKey: payload.apiKey };
    case 'ai:deepseek': return { kind: 'ai', name: 'deepseek', model: payload.model, apiKey: payload.apiKey };
    case 'http':
      return { kind: 'http', baseUrl: payload.httpBase || '', token: payload.httpToken };
    default:
      return null;
  }
}

function sanitizeId(base: string | undefined, fallback: string, index: number): string {
  const trimmed = (base || '').trim();
  if (trimmed) return trimmed;
  return `${fallback}-${index + 1}`;
}

function sanitizeLabel(label: string | undefined, choice: BotChoice): string {
  const trimmed = (label || '').trim();
  if (trimmed) return trimmed;
  return defaultLabel(choice);
}

function parseBody(req: NextApiRequest): RequestBody {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return (req.body ?? {}) as RequestBody;
}

function buildOptions(body: RequestBody): TournamentOptions {
  const opts: TournamentOptions = {};
  if (body.gamesPerRound != null && Number.isFinite(Number(body.gamesPerRound))) {
    const n = Math.max(1, Math.floor(Number(body.gamesPerRound)));
    opts.gamesPerRound = n;
  }
  if (body.seed != null && Number.isFinite(Number(body.seed))) {
    opts.seed = Number(body.seed);
  }
  if (body.config) {
    const base = defaultConfig();
    const cfg: TournamentOptions['config'] = {
      ...base,
      mu: 1000,
      sigma: 1000 / 3,
      beta: 1000 / 6,
      tau: 1000 / 300,
    };
    let touched = false;
    if (body.config.mu != null && Number.isFinite(Number(body.config.mu))) {
      cfg.mu = Number(body.config.mu);
      touched = true;
    }
    if (body.config.sigma != null && Number.isFinite(Number(body.config.sigma))) {
      cfg.sigma = Number(body.config.sigma);
      touched = true;
    }
    if (body.config.beta != null && Number.isFinite(Number(body.config.beta))) {
      cfg.beta = Number(body.config.beta);
      touched = true;
    }
    if (body.config.tau != null && Number.isFinite(Number(body.config.tau))) {
      cfg.tau = Number(body.config.tau);
      touched = true;
    }
    if (touched) {
      opts.config = cfg;
    }
  }
  return opts;
}

function isParticipantEntry(value: ParticipantEntry | null): value is ParticipantEntry {
  return value != null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
): Promise<void> {
  if (req.method !== OK_METHOD) {
    res.setHeader('Allow', OK_METHOD);
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const body = parseBody(req);
    const rawParticipants = Array.isArray(body.participants) ? body.participants : [];

    const entries = rawParticipants
      .map((payload, index): ParticipantEntry | null => {
        if (!payload || typeof payload.choice !== 'string') return null;
        const spec = specFromChoice(payload);
        if (!spec) return null;
        const id = sanitizeId(payload.id, payload.choice, index);
        const label = sanitizeLabel(payload.label, payload.choice);
        return {
          id,
          label,
          spec,
          ui: {
            choice: payload.choice,
            model: payload.model,
            apiKey: payload.apiKey,
            httpBase: payload.httpBase,
            httpToken: payload.httpToken,
          },
        };
      })
      .filter(isParticipantEntry);

    if (entries.length < 3) {
      res.status(400).json({ ok: false, error: 'At least three participants are required.' });
      return;
    }

    const options = buildOptions(body);
    const result = await runTripleElimination(entries, options);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, result });
  } catch (error: any) {
    console.error('[elimination] failed', error);
    const message = error?.message ? String(error.message) : 'Internal error';
    res.status(500).json({ ok: false, error: message });
  }
}
