// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * 可选：关闭 Next 的响应大小限制，保留 bodyParser
 */
export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
    responseLimit: false,
  },
};

// ====== 类型与工具 ======
type ProviderKind = 'builtin' | 'openai' | 'gemini' | 'kimi' | 'grok' | 'http';

interface SeatProvider {
  kind: ProviderKind;
  name?: string;   // 内置 bot 名称（如 GreedyMax/GreedyMin/RandomLegal）
  model?: string;  // 外部模型名（可选）
}

interface SeatKeys {
  openai?: string;
  gemini?: string;
  kimi?: string;
  grok?: string;
  httpBase?: string;   // 自建 HTTP provider 的 base URL
  httpToken?: string;  // 自建 HTTP provider 的 Bearer token
}

interface StartBody {
  config?: any;                 // 传给引擎的原始配置（不改）
  seatProviders?: SeatProvider[]; // 每座位 provider 选择（长 3 或 4）
  seatKeys?: SeatKeys[];          // 每座位对应的 key（可选：也支持 apiKeys 统一下发）
  apiKeys?: SeatKeys;             // 若未按座位拆分，也可统一下发 provider keys
  meta?: Record<string, any>;     // 其他前端附带元数据
}

const USE_REMOTE_FOR_MOVES = false; // 默认仅做“连通性＋reason记录”，不改变对局决策

const maskKey = (k?: string) => {
  if (!k) return '';
  const head = k.slice(0, 3);
  const tail = k.slice(-4);
  return `${head}…${tail}`;
};

const nowISO = () => new Date().toISOString();

function writeNDJSON(res: NextApiResponse, obj: any) {
  try {
    res.write(JSON.stringify(obj) + '\n');
  } catch {
    // 忽略写入错误（客户端断开等）
  }
}

function okReasonOrFallback(text?: string, fallback = 'ok'): string {
  const t = (text || '').trim();
  if (t) return t.slice(0, 2000); // 控制单条日志体量
  return fallback;
}

// ====== 外部 AI 统一调用 ======
async function callOpenAI(key: string, prompt: string, model = 'gpt-4o-mini') {
  const url = 'https://api.openai.com/v1/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      stream: false,
    }),
  });
  const j: any = await r.json();
  const reason = j?.choices?.[0]?.message?.content ?? '';
  return okReasonOrFallback(reason, 'OPENAI: received');
}

async function callGemini(key: string, prompt: string, model = 'gemini-1.5-flash') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    }),
  });
  const j: any = await r.json();
  const reason =
    j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join(' ') ?? '';
  return okReasonOrFallback(reason, 'GEMINI: received');
}

async function callKimi(key: string, prompt: string, model = 'moonshot-v1-8k') {
  const url = 'https://api.moonshot.cn/v1/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  });
  const j: any = await r.json();
  const reason = j?.choices?.[0]?.message?.content ?? '';
  return okReasonOrFallback(reason, 'KIMI: received');
}

async function callGrok(key: string, prompt: string, model = 'grok-2-latest') {
  const url = 'https://api.x.ai/v1/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  });
  const j: any = await r.json();
  const reason = j?.choices?.[0]?.message?.content ?? '';
  return okReasonOrFallback(reason, 'GROK: received');
}

/**
 * 通用 HTTP Provider
 * 约定：POST { prompt, seat } 至 httpBase
 * - 若需要鉴权，请在 httpToken 里带入 Bearer Token
 * - 返回可为 { reason?: string } 或 { message?: string }，否则取文本
 */
async function callHTTP(base: string, token: string | undefined, prompt: string, seat: string) {
  const url = base; // 你也可以在前端传完整 endpoint；这里不强行拼 /aiPlay
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, seat }),
  });

  const contentType = r.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const j: any = await r.json();
    const reason = j?.reason ?? j?.message ?? JSON.stringify(j);
    return okReasonOrFallback(reason, 'HTTP: received');
  } else {
    const text = await r.text();
    return okReasonOrFallback(text, 'HTTP: received');
  }
}

async function callProviderOnce(
  provider: SeatProvider,
  keys: SeatKeys,
  seatLabel: string,
  write: (obj: any) => void
) {
  const prompt = `You are an AI playing a card/mahjong game (seat ${seatLabel}). 
Return a short explanation of how you would decide a move. 
Reply in Chinese and keep it within 1-2 sentences.`;

  const startedAt = Date.now();
  const metaBase = {
    type: 'provider_call',
    t: nowISO(),
    seat: seatLabel,
    provider: provider.kind,
    model: provider.model || '',
    keyMask:
      provider.kind === 'openai' ? maskKey(keys.openai) :
      provider.kind === 'gemini' ? maskKey(keys.gemini) :
      provider.kind === 'kimi'   ? maskKey(keys.kimi)   :
      provider.kind === 'grok'   ? maskKey(keys.grok)   :
      provider.kind === 'http'   ? (keys.httpBase || '') :
      '',
  };

  write({ ...metaBase, stage: 'begin' });

  try {
    let reason = '';
    if (provider.kind === 'openai' && keys.openai) {
      reason = await callOpenAI(keys.openai, prompt, provider.model);
    } else if (provider.kind === 'gemini' && keys.gemini) {
      reason = await callGemini(keys.gemini, prompt, provider.model);
    } else if (provider.kind === 'kimi' && keys.kimi) {
      reason = await callKimi(keys.kimi, prompt, provider.model);
    } else if (provider.kind === 'grok' && keys.grok) {
      reason = await callGrok(keys.grok, prompt, provider.model);
    } else if (provider.kind === 'http' && keys.httpBase) {
      reason = await callHTTP(keys.httpBase, keys.httpToken, prompt, seatLabel);
    } else {
      reason = '未提供该 provider 所需的 key 或 httpBase，跳过调用';
    }

    write({
      ...metaBase,
      stage: 'end',
      ms: Date.now() - startedAt,
      ok: true,
      reason,
    });

    // 额外写一条“始终非空 reason”事件，兼容你前端日志格式
    write({
      type: 'reason',
      t: nowISO(),
      seat: seatLabel,
      provider: provider.kind,
      reason: okReasonOrFallback(reason, '（外部AI无返回，已保底）'),
    });
  } catch (err: any) {
    write({
      ...metaBase,
      stage: 'end',
      ms: Date.now() - startedAt,
      ok: false,
      error: String(err?.message || err),
    });
    write({
      type: 'warn',
      t: nowISO(),
      seat: seatLabel,
      msg: `外部AI(${provider.kind}) 调用失败，已忽略并维持内置决策`,
    });
  }
}

// ====== 主处理入口 ======
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
    return;
  }

  // NDJSON/流式响应头
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const write = (obj: any) => writeNDJSON(res, obj);

  // 解析请求体
  const body: StartBody = (req.body || {}) as any;
  const seatProviders: SeatProvider[] = Array.isArray(body.seatProviders) ? body.seatProviders : [];
  const seatKeysArr: SeatKeys[] = Array.isArray(body.seatKeys) ? body.seatKeys : [];
  const apiKeys: SeatKeys = (body.apiKeys || {}) as any;

  // 把“统一 keys”补齐到每座位
  const mergedSeatKeys: SeatKeys[] = seatProviders.map((_, i) => {
    const k = seatKeysArr[i] || {};
    return {
      openai: k.openai || apiKeys.openai,
      gemini: k.gemini || apiKeys.gemini,
      kimi:   k.kimi   || apiKeys.kimi,
      grok:   k.grok   || apiKeys.grok,
      httpBase: k.httpBase || apiKeys.httpBase,
      httpToken: k.httpToken || apiKeys.httpToken,
    };
  });

  // —— 开局前：写入调试事件（只输出打码/尾段，不打印明文 key）——
  write({
    type: 'debug.keys',
    t: nowISO(),
    seatProviders,
    seatKeyMasks: mergedSeatKeys.map((k) => ({
      openai: maskKey(k.openai),
      gemini: maskKey(k.gemini),
      kimi:   maskKey(k.kimi),
      grok:   maskKey(k.grok),
      httpBase: k.httpBase ? (new URL(k.httpBase).origin + (new URL(k.httpBase).pathname || '')) : '',
      httpToken: maskKey(k.httpToken),
    })),
  });

  // —— 连通性自检：并发“只做一次调用”，不阻塞对局（你也可以 await 保证先看结果）——
  Promise.allSettled(
    seatProviders.map((p, idx) => {
      if (p.kind === 'builtin') return Promise.resolve(null);
      return callProviderOnce(p, mergedSeatKeys[idx] || {}, `ESWN`[idx] || String(idx), write);
    })
  ).then(() => {
    // 可选：所有 ping 完成
  }).catch(() => { /* 忽略 */ });

  // ====== （可选）真正把外部 AI 用于“出牌决策” ======
  if (USE_REMOTE_FOR_MOVES) {
    // TODO:
    // 如果你的引擎支持以 IBot 形式注入，这里构建各座位的 RemoteBot（内部仍可兜底 GreedyMax）：
    // const bots: IBot[] = seatProviders.map((p, i) => {
    //   return p.kind === 'builtin'
    //     ? makeBuiltinBot(p.name || 'GreedyMax')
    //     : makeRemoteBot(p, mergedSeatKeys[i], /* write for logging */ write, /* fallback */ makeBuiltinBot('GreedyMax'));
    // });
    // 并把 bots 传入 runOneGame(...)。为避免破坏原逻辑，本模板默认不开启。
    write({
      type: 'info',
      t: nowISO(),
      msg: 'USE_REMOTE_FOR_MOVES=true：请在 TODO 处对接你的 IBot 适配器，并把 bots 传入引擎。',
    });
  } else {
    write({
      type: 'info',
      t: nowISO(),
      msg: '外部AI目前处于“连通性与reason记录”模式，不改变对局决策（仍用内置bot）。',
    });
  }

  // ====== 运行你现有的对局引擎 ======
  // 说明：保留你原先的调用方式（通常是 runOneGame(body.config, write)）。
  // 若你的签名不同，请按工程实际稍作调整。
  try {
    // 动态引入，避免路径不符时报编译错误；若你的工程用别名路径，请改成静态 import。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const engine = require('../../lib/arenaStream'); // <-- 如路径不同，请改这里
    const runOneGame = engine?.runOneGame;

    if (typeof runOneGame !== 'function') {
      write({
        type: 'error',
        t: nowISO(),
        msg: '未找到 runOneGame(...)，请检查 lib/arenaStream 导出路径或函数名',
      });
    } else {
      // === RUN YOUR GAME HERE ===
      // 常见写法一：runOneGame(body?.config || {}, write)
      // 常见写法二：runOneGame(write, body?.config || {})
      // 如果你不确定，可 console 查看 runOneGame.length 或查阅工程原始版本。
      try {
        await runOneGame(body?.config ?? {}, write);
      } catch (e1) {
        // 失败则换个参数顺序再试一次，尽量兼容老版本
        await runOneGame(write, body?.config ?? {});
      }
    }
  } catch (err: any) {
    write({
      type: 'error',
      t: nowISO(),
      msg: '引擎运行失败',
      detail: String(err?.message || err),
    });
  } finally {
    // 优雅收尾
    write({ type: 'done', t: nowISO() });
    try { res.end(); } catch { /* ignore */ }
  }
}
