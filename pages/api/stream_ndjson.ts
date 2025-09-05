import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: false,        // 我们自己读 body，避免影响流式输出
    responseLimit: false,
  },
};

function readBody(req: NextApiRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
    return;
  }

  // 读取参数（此处不强校验，用于演示）
  const _body = await readBody(req).catch(() => ({}));

  // NDJSON/分块输出
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });

  const write = (obj: any) => {
    res.write(JSON.stringify(obj) + '\n');
  };

  // —— 以下是极简“内建”演示流：发几条事件就结束 —— //
  const hands = [
    ['A','K','Q','J','T','9','8'],
    ['A','A','7','7','6','5','4'],
    ['K','K','3','3','2','2','J'],
  ];
  write({ type: 'event', kind: 'deal', hands, bottom: ['A','8','J'] });
  write({ type: 'event', kind: 'landlord', landlord: 2, bottom: ['A','8','J'], baseScore: 3 });
  write({ type: 'event', kind: 'turn', seat: 2, lead: true });

  let step = 0;
  const timer = setInterval(() => {
    step++;
    if (step === 1) {
      write({ type: 'event', kind: 'play', seat: 2, move: 'play', cards: ['J'], comboType: 'single' });
      write({ type: 'event', kind: 'turn', seat: 0 });
    } else if (step === 2) {
      write({ type: 'event', kind: 'play', seat: 0, move: 'pass', reason: '过' });
      write({ type: 'event', kind: 'turn', seat: 1 });
    } else if (step === 3) {
      write({ type: 'event', kind: 'play', seat: 1, move: 'play', cards: ['7','7'], comboType: 'pair' });
      write({ type: 'event', kind: 'turn', seat: 2 });
    } else if (step === 4) {
      write({ type: 'score', totals: [10, 10, 10] });
      write({ type: 'terminated' });
      clearInterval(timer);
      res.end();
    }
  }, 500);

  req.on('close', () => { clearInterval(timer); });
}
