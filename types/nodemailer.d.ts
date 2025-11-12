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
    auth?: {
      user?: string;
      pass?: string;
    };
  }

  export interface Transporter {
    sendMail(mailOptions: SendMailOptions): Promise<unknown>;
  }

  export type TransportConfig = TransportOptions | string;

  export function createTransport(options: TransportConfig): Transporter;

  const nodemailer: {
    createTransport(options: TransportConfig): Transporter;
  };

  export default nodemailer;
}
