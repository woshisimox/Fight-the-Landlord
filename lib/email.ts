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

function resolveBooleanFlag(value: string | undefined | null, fallback: boolean): boolean {
  if (value == null) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  return fallback;
}

type TransportConfig = string | TransportOptions;

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function firstString(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return null;
}

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
    process.env.LOG_EMAIL_CONNECTION_STRING,
    process.env.LOG_EMAIL_CONNECTION_URL,
    process.env.LOG_EMAIL_SMTP_URL,
    process.env.EMAIL_TRANSPORT,
    process.env.EMAIL_SERVER_JSON,
    process.env.EMAIL_SERVER,
    process.env.SMTP_URL,
    process.env.SMTP_CONNECTION_URL,
    process.env.SMTP_TRANSPORT,
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

  const service = firstNonEmpty(
    process.env.LOG_EMAIL_SERVICE,
    process.env.EMAIL_SERVICE,
  );

  const host = firstNonEmpty(
    process.env.LOG_EMAIL_HOST,
    process.env.EMAIL_HOST,
    process.env.SMTP_HOST,
  );
  if (!host && !service) return null;

  const portRaw = firstNonEmpty(
    process.env.LOG_EMAIL_PORT,
    process.env.EMAIL_PORT,
    process.env.SMTP_PORT,
  );
  const parsedPort = portRaw ? Number(portRaw) : Number.NaN;
  const port = Number.isFinite(parsedPort) ? parsedPort : undefined;
  const secureRaw = firstNonEmpty(
    process.env.LOG_EMAIL_SECURE,
    process.env.LOG_EMAIL_TLS,
    process.env.EMAIL_SECURE,
    process.env.SMTP_SECURE,
  );
  const secure = secureRaw != null
    ? resolveBooleanFlag(secureRaw, false)
    : host
      ? port === 465
      : false;
  const finalPort = port ?? (secure ? 465 : 587);
  const user = firstNonEmpty(
    process.env.LOG_EMAIL_USER,
    process.env.LOG_EMAIL_USERNAME,
    process.env.EMAIL_USER,
    process.env.EMAIL_USERNAME,
    process.env.SMTP_USER,
    process.env.SMTP_USERNAME,
  );
  const pass = firstString(
    process.env.LOG_EMAIL_PASS,
    process.env.LOG_EMAIL_PASSWORD,
    process.env.EMAIL_PASS,
    process.env.EMAIL_PASSWORD,
    process.env.SMTP_PASS,
    process.env.SMTP_PASSWORD,
  ) || '';

  const requireTls = resolveBooleanFlag(
    firstNonEmpty(
      process.env.LOG_EMAIL_REQUIRE_TLS,
      process.env.EMAIL_REQUIRE_TLS,
      process.env.SMTP_REQUIRE_TLS,
    ),
    false,
  );
  const ignoreTls = resolveBooleanFlag(
    firstNonEmpty(
      process.env.LOG_EMAIL_IGNORE_TLS,
      process.env.EMAIL_IGNORE_TLS,
      process.env.SMTP_IGNORE_TLS,
    ),
    false,
  );
  const rejectUnauthorized = !resolveBooleanFlag(
    firstNonEmpty(
      process.env.LOG_EMAIL_ALLOW_SELF_SIGNED,
      process.env.EMAIL_ALLOW_SELF_SIGNED,
      process.env.SMTP_ALLOW_SELF_SIGNED,
    ),
    false,
  );

  const name = firstNonEmpty(
    process.env.LOG_EMAIL_NAME,
    process.env.EMAIL_NAME,
    process.env.SMTP_NAME,
  );
  const authMethod = firstNonEmpty(
    process.env.LOG_EMAIL_AUTH_METHOD,
    process.env.EMAIL_AUTH_METHOD,
    process.env.SMTP_AUTH_METHOD,
  );
  const pool = firstNonEmpty(
    process.env.LOG_EMAIL_POOL,
    process.env.EMAIL_POOL,
    process.env.SMTP_POOL,
  );

  const transportOptions: TransportOptions = {
    ...(host ? { host } : {}),
    ...(Number.isFinite(finalPort) && host ? { port: finalPort } : {}),
    secure,
    auth: user ? { user, pass } : undefined,
    requireTLS: requireTls,
    ignoreTLS: ignoreTls,
    tls: rejectUnauthorized ? undefined : { rejectUnauthorized },
    service: service || undefined,
  };
  if (name) transportOptions.name = name;
  if (authMethod) transportOptions.authMethod = authMethod;
  if (pool) transportOptions.pool = resolveBooleanFlag(pool, false);

  try {
    const transporter = nodemailer.createTransport(transportOptions);
    console.info('[email] transporter configured with host settings', {
      host: host || null,
      service: service || null,
      port: host ? finalPort : null,
      secure,
      pool: transportOptions.pool ?? false,
      requireTLS: transportOptions.requireTLS ?? false,
      ignoreTLS: transportOptions.ignoreTLS ?? false,
    });
    return transporter;
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

  const to = firstNonEmpty(
    process.env.LOG_EMAIL_RECIPIENT,
    process.env.EMAIL_TO,
  ) || 'ai-gaming.online@outlook.com';
  const from = firstNonEmpty(
    process.env.LOG_EMAIL_FROM,
    process.env.EMAIL_FROM,
    process.env.SMTP_FROM,
    to,
  ) || to;

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
