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

  export function createTransport(options: TransportOptions): Transporter;

  const nodemailer: {
    createTransport(options: TransportOptions): Transporter;
  };

  export default nodemailer;
}
