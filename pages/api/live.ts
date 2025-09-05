import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).end('Method Not Allowed');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (obj: any) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // —— 与上面 NDJSON 相同的演示事件序列 —— //
  const hands = [
    ['A','K','Q','J','T','9','8'],
    ['A','A','7','7','6','5','4'],
    ['K','K','3','3','2','2','J'],
  ];
  send({ type: 'event', kind: 'deal', hands, bottom: ['A','8','J'] });
  send({ type: 'event', kind: 'landlord', landlord: 2, bottom: ['A','8','J'], baseScore: 3 });
  send({ type: 'event', kind: 'turn', seat: 2, lead: true });

  let step = 0;
  const timer = setInterval(() => {
    step++;
    if (step === 1) {
      send({ type: 'event', kind: 'play', seat: 2, move: 'play', cards: ['J'], comboType: 'single' });
      send({ type: 'event', kind: 'turn', seat: 0 });
    } else if (step === 2) {
      send({ type: 'event', kind: 'play', seat: 0, move: 'pass', reason: '过' });
      send({ type: 'event', kind: 'turn', seat: 1 });
    } else if (step === 3) {
      send({ type: 'event', kind: 'play', seat: 1, move: 'play', cards: ['7','7'], comboType: 'pair' });
      send({ type: 'event', kind: 'turn', seat: 2 });
    } else if (step === 4) {
      send({ type: 'score', totals: [10, 10, 10] });
      send({ type: 'terminated' });
      clearInterval(timer);
      setTimeout(() => res.end(), 200);
    }
  }, 500);

  req.on('close', () => { clearInterval(timer); });
}
