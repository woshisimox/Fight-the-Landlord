import nodemailer, { Transporter } from 'nodemailer';

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

function resolveConnectionUrl(): string | null {
  const candidates = [
    process.env.LOG_EMAIL_TRANSPORT,
    process.env.SMTP_URL,
    process.env.SMTP_CONNECTION_URL,
    process.env.EMAIL_SERVER,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function createTransporter(): Transporter | null {
  const url = resolveConnectionUrl();
  if (url) {
    try {
      return nodemailer.createTransport(url);
    } catch (err) {
      console.error('[email] failed to create transporter from url', err);
    }
  }

  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const portRaw = process.env.SMTP_PORT?.trim();
  const parsedPort = portRaw ? Number(portRaw) : Number.NaN;
  const port = Number.isFinite(parsedPort) ? parsedPort : undefined;
  const secure = resolveBooleanFlag(process.env.SMTP_SECURE, port === 465);
  const finalPort = port ?? (secure ? 465 : 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? '';

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
  if ((globalThis as any).__DDZ_MAIL_TRANSPORT__) {
    return (globalThis as any).__DDZ_MAIL_TRANSPORT__ as Transporter;
  }
  const transporter = createTransporter();
  (globalThis as any).__DDZ_MAIL_TRANSPORT__ = transporter;
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
