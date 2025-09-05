import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

function readBody(req: NextApiRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
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

  // 读参数（演示不强校验）
  await readBody(req).catch(() => ({}));

  // 设置 NDJSON 流头
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });

  const write = (obj: any) => res.write(JSON.stringify(obj) + '\n');

  // 预设一副“可收尾”的牌（丙地主，乙会出完）
  const hands: string[][] = [
    ['A','K','Q','J','T','9','8'],           // 甲
    ['A','A','7','7','6','5','4'],           // 乙
    ['K','K','3','3','2','2','J'],           // 丙(地主)
  ];

  const removeFromHand = (seat: number, labels: string[]) => {
    for (const lab of labels) {
      const k = hands[seat].indexOf(lab);
      if (k >= 0) hands[seat].splice(k, 1);
    }
  };
  const play = (seat: number, labels: string[], comboType = 'play') => {
    removeFromHand(seat, labels);
    write({ type: 'event', kind: 'play', seat, move: 'play', cards: labels, comboType });
  };
  const pass = (seat: number, reason = '过') => {
    write({ type: 'event', kind: 'play', seat, move: 'pass', reason });
  };
  const turn = (seat: number, lead = false) => {
    write({ type: 'event', kind: 'turn', seat, lead });
  };
  const checkFinish = () => {
    for (let i = 0; i < 3; i++) {
      if (hands[i].length === 0) {
        write({ type: 'score', totals: [10,10,10] }); // 演示分数
        write({ type: 'terminated' });
        try { res.end(); } catch {}
        return true;
      }
    }
    return false;
  };

  // 发牌/定地主
  write({ type: 'event', kind: 'deal', hands, bottom: ['A','8','J'] });
  write({ type: 'event', kind: 'landlord', landlord: 2, bottom: ['A','8','J'], baseScore: 3 });

  // 预设一个能打光乙手牌的简单流程：
  // 丙领出 J -> 甲过 -> 乙出 77 -> 丙出 22 -> 甲过 -> 乙出 AA -> 丙出 KK -> 甲过 -> 乙出 654(顺) -> 乙打空 -> 结束
  let step = 0;
  const timer = setInterval(() => {
    step++;
    if (step === 1) {
      turn(2, true);
      play(2, ['J'], 'single');
      if (checkFinish()) return;
      turn(0);
    } else if (step === 2) {
      pass(0);
      turn(1);
    } else if (step === 3) {
      play(1, ['7','7'], 'pair');
      if (checkFinish()) return;
      turn(2);
    } else if (step === 4) {
      play(2, ['2','2'], 'pair');
      if (checkFinish()) return;
      turn(0);
    } else if (step === 5) {
      pass(0);
      turn(1);
    } else if (step === 6) {
      play(1, ['A','A'], 'pair');
      if (checkFinish()) return;
      turn(2);
    } else if (step === 7) {
      play(2, ['K','K'], 'pair');
      if (checkFinish()) return;
      turn(0);
    } else if (step === 8) {
      pass(0);
      turn(1);
    } else if (step === 9) {
      play(1, ['6','5','4'], 'straight');
      if (checkFinish()) return; // 乙打空 -> 结束
      // 不会走到这里
    } else {
      clearInterval(timer);
      try { res.end(); } catch {}
    }
  }, 500);

  req.on('close', () => { clearInterval(timer); });
}
