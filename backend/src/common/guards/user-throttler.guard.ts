import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Per-USER rate limiting (2026-07-06, EXECUTION_BRIEF risk #15).
 *
 * The default ThrottlerGuard tracks by IP. Behind nginx / one office egress IP, ALL users
 * share one bucket — the load test proved it: at 120 concurrent authenticated users,
 * 23,394 / 23,492 requests were 429'd. Authenticated requests are now tracked by USER id
 * (each user gets their own budget); unauthenticated requests keep IP tracking (login
 * brute-force protection unchanged — the @Throttle override on /auth/login still applies).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id ?? req.user?.sub;
    if (userId) return `u:${userId}`;
    const fwd = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    return `ip:${fwd || req.ip || req.socket?.remoteAddress || 'unknown'}`;
  }
}
