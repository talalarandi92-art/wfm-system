import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Thin email sender. Reads SMTP_* from env. If SMTP isn't configured it logs the
 * intended email instead of throwing — so the app works in dev/before SMTP is set up.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('MailerService');
  private transporter: nodemailer.Transporter | null = null;

  private get configured(): boolean {
    return !!process.env.SMTP_HOST;
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.configured) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
    }
    return this.transporter;
  }

  /** Send an email. Returns true if actually dispatched, false if logged-only (no SMTP). */
  async send(to: string | string[], subject: string, html: string): Promise<boolean> {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) return false;

    const t = this.getTransporter();
    if (!t) {
      this.logger.warn(`(SMTP not configured) would email ${recipients.join(', ')} — "${subject}"`);
      return false;
    }
    try {
      await t.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER || 'wfm@boutiqaat.local',
        to: recipients.join(', '),
        subject, html,
      });
      this.logger.log(`Email sent to ${recipients.length} recipient(s): "${subject}"`);
      return true;
    } catch (e: any) {
      this.logger.error(`Email send failed: ${e?.message ?? e}`);
      return false;
    }
  }
}
