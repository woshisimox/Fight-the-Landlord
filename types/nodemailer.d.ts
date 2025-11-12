declare module 'nodemailer' {
  export type Address = string | { name?: string; address: string };

  export interface SendMailOptions {
    from?: Address;
    to?: Address | Address[];
    subject?: string;
    text?: string;
    html?: string;
  }

  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    service?: string;
    pool?: boolean;
    requireTLS?: boolean;
    ignoreTLS?: boolean;
    secureConnection?: boolean;
    name?: string;
    authMethod?: string;
    auth?: {
      user?: string;
      pass?: string;
    };
    tls?: {
      rejectUnauthorized?: boolean;
      ciphers?: string;
    };
  }

  export interface Transporter {
    sendMail(mailOptions: SendMailOptions): Promise<unknown>;
    verify?(callback?: (err: Error | null, success: boolean) => void): Promise<unknown> | void;
  }

  export type TransportConfig = TransportOptions | string;

  export function createTransport(options: TransportConfig): Transporter;

  const nodemailer: {
    createTransport(options: TransportConfig): Transporter;
  };

  export default nodemailer;
}
