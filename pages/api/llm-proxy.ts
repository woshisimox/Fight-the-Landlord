import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * 统一LLM代理（OpenAI/Gemini/Kimi/Grok）。
 * 为了示例编译通过，这里不实际向外网请求；
 * 逻辑：若请求体里携带legal，返回：
 *  - 如果有合法牌，推荐第1个；否则 pass。
 *  - 附带一个简单reason。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const body = req.body || {};
    const legal = body?.prompt?.legal || [];
    if (Array.isArray(legal) && legal.length>0) {
      const choice = legal[0];
      return res.status(200).json({
        move: 'play',
        cards: choice.cards,
        reason: '代理示例：选择第1个合法出牌（可在生产替换为真实LLM调用）',
        provider: body?.provider || 'stub'
      });
    } else {
      return res.status(200).json({ move:'pass', reason:'代理示例：无牌可出/建议过' });
    }
  } catch (e:any) {
    return res.status(200).json({ move:'pass', reason: '代理异常，默认过', error: String(e?.message || e) });
  }
}
