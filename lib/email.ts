import nodemailer, { Transporter, TransportOptions } from 'nodemailer';

type SendMailOptions = {
  subject: string;
  text: string;
  html?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __DDZ_MAIL_TRANSPORT__: Transporter | null | undefined;
}

function resolveBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  return fallback;
}

type TransportConfig = string | TransportOptions;

function parseTransportCandidate(raw: string | undefined | null): TransportConfig | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed as TransportOptions;
      }
    } catch (err) {
      console.error('[email] failed to parse transport JSON', err);
    }
  }
  return trimmed;
}

function resolveConnectionConfigs(): TransportConfig[] {
  const configs: TransportConfig[] = [];
  const candidates = [
    process.env.LOG_EMAIL_TRANSPORT,
    process.env.LOG_EMAIL_TRANSPORT_JSON,
    process.env.EMAIL_TRANSPORT,
    process.env.SMTP_URL,
    process.env.SMTP_CONNECTION_URL,
    process.env.EMAIL_SERVER,
  ];
  for (const candidate of candidates) {
    const parsed = parseTransportCandidate(candidate);
    if (parsed) configs.push(parsed);
  }
  return configs;
}

function createTransporter(): Transporter | null {
  const configs = resolveConnectionConfigs();
  for (const config of configs) {
    try {
      const transporter = nodemailer.createTransport(config);
      console.info('[email] transporter configured from connection config');
      return transporter;
    } catch (err) {
      console.error('[email] failed to create transporter from config', err);
    }
  }

  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const portRaw = process.env.SMTP_PORT?.trim();
  const parsedPort = portRaw ? Number(portRaw) : Number.NaN;
  const port = Number.isFinite(parsedPort) ? parsedPort : undefined;
  const secure = resolveBooleanFlag(process.env.SMTP_SECURE, port === 465);
  const finalPort = port ?? (secure ? 465 : 587);
  const user = (
    process.env.SMTP_USER
    || process.env.SMTP_USERNAME
    || process.env.EMAIL_USER
    || process.env.EMAIL_USERNAME
  )?.trim();
  const passRaw = (
    process.env.SMTP_PASS
    ?? process.env.SMTP_PASSWORD
    ?? process.env.EMAIL_PASS
    ?? process.env.EMAIL_PASSWORD
  );
  const pass = typeof passRaw === 'string' ? passRaw : '';

  try {
    return nodemailer.createTransport({
      host,
      port: finalPort,
      secure,
      auth: user ? { user, pass } : undefined,
    });
  } catch (err) {
    console.error('[email] failed to create transporter', err);
    return null;
  }
}

function getTransporter(): Transporter | null {
  const cached = (globalThis as any).__DDZ_MAIL_TRANSPORT__ as Transporter | null | undefined;
  if (cached) return cached;
  const transporter = createTransporter();
  if (transporter) {
    (globalThis as any).__DDZ_MAIL_TRANSPORT__ = transporter;
  }
  return transporter;
}

export async function sendRunLogEmail(options: SendMailOptions): Promise<{ ok: boolean; message?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] transporter not configured; skipping send');
    return { ok: false, message: 'Email transport not configured' };
  }

  const to = (process.env.LOG_EMAIL_RECIPIENT || '').trim() || 'ai-gaming.online@outlook.com';
  const from = (process.env.LOG_EMAIL_FROM || '').trim() || to;

  try {
    const maybeVerify = (transporter as any).verify;
    if (typeof maybeVerify === 'function') {
      try {
        await maybeVerify.call(transporter);
      } catch (verifyErr) {
        console.warn('[email] transporter verify failed', verifyErr);
      }
    }
    await transporter.sendMail({
      from,
      to,
      subject: options.subject,
      text: options.text,
      ...(options.html ? { html: options.html } : {}),
    });
    return { ok: true };
  } catch (err: any) {
    console.error('[email] send error', err);
    return { ok: false, message: err?.message || 'Email send failed' };
  }
}
