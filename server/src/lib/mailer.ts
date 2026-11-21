import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { log, redact } from './log.js';

export interface Mail {
  to: string;
  subject: string;
  /** Short paragraphs of plain text; the HTML version is built from them. */
  lines: string[];
  /** Optional big code shown in the email (OTP). */
  code?: string;
  action?: { label: string; url: string };
  footer?: string;
}

type Provider = { name: string; send: (m: Mail, html: string, text: string) => Promise<void> };

function providers(): Provider[] {
  const c = config();
  const list: Provider[] = [];
  if (c.RESEND_API_KEY) {
    list.push({
      name: 'resend',
      send: async (m, html, text) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: c.MAIL_FROM, to: [m.to], subject: m.subject, html, text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      },
    });
  }
  if (c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASS) {
    const port = c.SMTP_PORT ?? 465;
    const transport = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: c.SMTP_USER, pass: c.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
    list.push({ name: 'smtp', send: async (m, html, text) => void (await transport.sendMail({ from: c.MAIL_FROM, to: m.to, subject: m.subject, html, text })) });
  }
  return list;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function renderMail(m: Mail): { html: string; text: string } {
  const paras = m.lines.map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#0E1A2B">${esc(l)}</p>`).join('');
  const code = m.code
    ? `<p style="margin:6px 0 18px;font-family:Consolas,Menlo,monospace;font-size:30px;letter-spacing:8px;font-weight:700;color:#0E1A2B">${esc(m.code)}</p>`
    : '';
  const action = m.action
    ? `<p style="margin:8px 0 20px"><a href="${esc(m.action.url)}" style="display:inline-block;background:#FFC233;color:#0E1A2B;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;border:1px solid #D9A21B">${esc(m.action.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F2F5F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F5F8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #DDE3EA;border-radius:12px">
<tr><td style="height:6px;background:#0E1A2B;border-radius:12px 12px 0 0"></td></tr>
<tr><td style="padding:26px 28px 8px"><p style="margin:0 0 18px;font-size:13px;font-weight:700;color:#3B4A5E">Arka</p>${paras}${code}${action}</td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#64748B">${esc(m.footer ?? 'You received this because of an action on your Arka account. If it wasn’t you, ignore this email.')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [...m.lines, m.code ? `Code: ${m.code}` : '', m.action ? `${m.action.label}: ${m.action.url}` : '', '', m.footer ?? ''].filter(Boolean).join('\n\n');
  return { html, text };
}

/**
 * Try every configured provider in order until one accepts. Never throws: a broken provider must not
 * break sign-up. Returns the provider name that sent it, or 'log' if none is configured.
 */
export async function sendMail(m: Mail, opts: { demo?: boolean } = {}): Promise<string> {
  const { html, text } = renderMail(m);
  if (opts.demo) {
    log.debug({ to: '[demo]', subject: redact(m.subject) }, 'email suppressed in demo workspace');
    return 'suppressed';
  }
  for (const p of providers()) {
    try {
      await p.send(m, html, text);
      log.info({ provider: p.name, subject: redact(m.subject) }, 'email sent');
      return p.name;
    } catch (err) {
      log.warn({ provider: p.name, err: String(err).slice(0, 200) }, 'email provider failed, trying the next one');
    }
  }
  log.info({ subject: redact(m.subject) }, 'email logged (no provider configured)');
  return 'log';
}
