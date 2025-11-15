import type { NextApiRequest, NextApiResponse } from 'next';
import { clearRunLog, storeRunLog } from '../../lib/runLogStore';
import { sendRunLogEmail } from '../../lib/email';

type RunMode = 'regular' | 'knockout';

type RunLogRequest = {
  runId?: string;
  mode?: RunMode;
  logLines?: unknown;
  metadata?: Record<string, any>;
};

type ApiResponse = {
  ok: boolean;
  runId: string;
  delivered: boolean;
  message?: string;
};

function coerceLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return lines.map(line => {
    if (typeof line === 'string') return line;
    if (line == null) return '';
    try {
      return JSON.stringify(line);
    } catch {
      return String(line);
    }
  });
}

function buildSubject(mode: RunMode, metadata: Record<string, any>, runId: string): string {
  const prefix = mode === 'knockout' ? 'Knockout' : 'Regular';
  const summary = typeof metadata?.summary === 'string' && metadata.summary.trim()
    ? metadata.summary.trim()
    : undefined;
  const label = summary ? ` - ${summary}` : '';
  return `[Fight the Landlord] ${prefix} run log${label} (#${runId})`;
}

function buildTextBody(
  mode: RunMode,
  metadata: Record<string, any>,
  runId: string,
  lines: string[],
): string {
  const receivedAt = new Date().toISOString();
  const metaJson = JSON.stringify(metadata ?? {}, null, 2);
  const logText = lines.length ? lines.join('\n') : '(no log lines provided)';
  return [
    `Run ID: ${runId}`,
    `Mode: ${mode}`,
    `Received at: ${receivedAt}`,
    '',
    'Metadata:',
    metaJson,
    '',
    'Logs:',
    logText,
  ].join('\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse | { ok: false; error: string }>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const bodyRaw = req.body as RunLogRequest | string | undefined;
    const parsed: RunLogRequest = typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : (bodyRaw ?? {});

    const mode: RunMode = parsed.mode === 'knockout' ? 'knockout' : 'regular';
    const runId = (parsed.runId && typeof parsed.runId === 'string' && parsed.runId.trim())
      ? parsed.runId.trim()
      : `${mode}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const metadata = typeof parsed.metadata === 'object' && parsed.metadata ? parsed.metadata : {};
    const lines = coerceLines(parsed.logLines);

    storeRunLog({
      id: runId,
      createdAt: new Date().toISOString(),
      mode,
      metadata,
      lines,
    });

    const subject = buildSubject(mode, metadata, runId);
    const text = buildTextBody(mode, metadata, runId, lines);

    const sendResult = await sendRunLogEmail({ subject, text });

    if (!sendResult.ok) {
      console.error('[deliver_logs] send failed', runId, sendResult.message);
      res.status(502).json({
        ok: false,
        runId,
        delivered: false,
        message: sendResult.message || 'Email send failed',
      });
      return;
    }

    clearRunLog(runId);

    res.status(200).json({
      ok: true,
      runId,
      delivered: true,
    });
  } catch (err: any) {
    console.error('[deliver_logs] error', err);
    res.status(400).json({ ok: false, error: err?.message || 'Invalid payload' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};
