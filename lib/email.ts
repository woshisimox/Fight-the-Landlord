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

function createTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const portRaw = process.env.SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 465;
  const secure = resolveBooleanFlag(process.env.SMTP_SECURE, port === 465);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? '';

  try {
    return nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 465,
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
