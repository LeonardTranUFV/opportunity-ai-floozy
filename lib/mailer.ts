import nodemailer from "nodemailer";

/**
 * Outgoing mail, for the morning lead digest.
 *
 * Gmail with an app password, which is what scripts/send-daily-leads.ts has
 * been sending through since 2026-09-30 — the same two environment variables,
 * so moving the send into the app needs no new account anywhere, only those
 * values copied into Vercel.
 *
 * Deliberately not a hard dependency: the app must build and run without mail
 * configured. `mailerConfigured()` is what the UI asks so it can say the
 * digest will not go out, rather than letting a customer set a send time that
 * silently does nothing.
 */
export function mailerConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function senderAddress(): string | null {
  return process.env.GMAIL_USER ?? null;
}

export interface Attachment {
  filename: string;
  content: string;
  contentType?: string;
}

/**
 * Sends one message. Throws on a bad credential or a refused recipient, which
 * the caller records against that recipient — one client's bad address must
 * not stop the rest of the morning's sends.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are not set");
  }

  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transport.sendMail({
    from: user,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
  });
}
