import {
  Injectable, UnauthorizedException, ForbiddenException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User } from '@database/entities/user.entity';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  /** Append an immutable audit entry — failure must NEVER block the caller */
  private async writeAudit(opts: {
    tenantId: string;
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    try {
      // Validate IP — PostgreSQL inet cast rejects malformed values
      const safeIp = /^[\d:.a-fA-F]+$/.test(opts.ip ?? '') ? opts.ip : null;
      await this.ds.query(
        `INSERT INTO audit_logs
           (tenant_id, actor_id, actor_email, action, module,
            entity_type, entity_id, metadata, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, 'auth', 'user', $5, $6::jsonb, $7::inet, $8)`,
        [
          opts.tenantId,
          opts.actorId   ?? null,
          opts.actorEmail ?? null,
          opts.action,
          opts.entityId  ?? null,
          opts.metadata ? JSON.stringify(opts.metadata) : null,
          safeIp,
          opts.userAgent ?? null,
        ],
      );
    } catch (err) {
      this.logger.warn(`Audit write failed [${opts.action}]: ${err?.message}`);
    }
  }

  /** Linked employee summary for the login/me payload (null when not linked) */
  async getLinkedEmployee(employeeId: string | null) {
    if (!employeeId) return null;
    const rows = await this.ds.query(
      `SELECT e.id, e.employee_no,
              e.first_name_en || ' ' || e.last_name_en AS full_name,
              e.gender, f.id AS function_id, f.name AS function_name
       FROM employees e
       LEFT JOIN functions f ON f.id = e.function_id
       WHERE e.id = $1`,
      [employeeId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      employeeNo: r.employee_no,
      fullName: r.full_name,
      gender: r.gender,
      functionId: r.function_id,
      functionName: r.function_name,
    };
  }

  async login(
    email: string,
    password: string,
    tenantId?: string,
    ip?: string,
    userAgent?: string,
  ) {
    // Load password hash (select: false field needs explicit select)
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .addSelect('u.refreshTokenHash')
      .leftJoinAndSelect('u.roles', 'role')
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('LOWER(u.email) = LOWER(:email)', { email })
      .andWhere(tenantId ? 'u.tenantId = :tenantId' : '1=1', { tenantId })
      .getOne();

    // No audit on "user not found" — prevents timing-based user enumeration
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'locked') {
      if (user.lockedUntil && user.lockedUntil < new Date()) {
        // Auto-unlock — lock window has passed
        await this.ds.query(
          `UPDATE users SET status='active', failed_attempts=0, locked_at=NULL, locked_until=NULL WHERE id=$1`,
          [user.id],
        );
        user.status = 'active';
      } else {
        await this.writeAudit({
          tenantId: user.tenantId,
          actorId: user.id,
          actorEmail: user.email,
          action: 'LOGIN_BLOCKED',
          entityId: user.id,
          metadata: { reason: 'account_locked', lockedUntil: user.lockedUntil?.toISOString() },
          ip,
          userAgent,
        });
        const until = user.lockedUntil
          ? ` Locked until ${user.lockedUntil.toISOString()}.`
          : '';
        throw new ForbiddenException(`Account is locked. Contact your administrator.${until}`);
      }
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active.');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      const maxAttempts = this.config.get<number>('MAX_FAILED_LOGIN_ATTEMPTS', 5);
      const lockMinutes = this.config.get<number>('LOCK_DURATION_MINUTES', 30);
      const newAttempts = user.failedAttempts + 1;

      await this.writeAudit({
        tenantId: user.tenantId,
        actorId: user.id,
        actorEmail: user.email,
        action: 'LOGIN_FAILED',
        entityId: user.id,
        metadata: { reason: 'wrong_password', attempt: newAttempts, maxAttempts },
        ip,
        userAgent,
      });

      await this.usersRepo.update(user.id, {
        failedAttempts: () => 'failed_attempts + 1',
      });

      if (newAttempts >= maxAttempts) {
        const lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
        await this.usersRepo.update(user.id, {
          status: 'locked',
          lockedAt: new Date(),
          lockedUntil,
        });
        await this.writeAudit({
          tenantId: user.tenantId,
          actorId: user.id,
          actorEmail: user.email,
          action: 'ACCOUNT_LOCKED',
          entityId: user.id,
          metadata: { lockedUntil: lockedUntil.toISOString(), lockMinutes },
          ip,
          userAgent,
        });
        throw new ForbiddenException(
          `Account locked after too many failed attempts. Try again after ${lockMinutes} minutes.`,
        );
      }

      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login
    await this.usersRepo.update(user.id, {
      failedAttempts: 0,
      lastLoginAt: new Date(),
    });

    await this.writeAudit({
      tenantId: user.tenantId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'LOGIN_SUCCESS',
      entityId: user.id,
      metadata: { roles: user.roles?.map(r => r.code) ?? [] },
      ip,
      userAgent,
    });

    // Lazy cleanup — purge expired blacklist rows on each successful login
    this.ds.query(`DELETE FROM revoked_tokens WHERE expires_at < NOW()`).catch(() => {});

    return this.issueTokenPair(user);
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.refreshTokenHash')
      .addSelect('u.refreshTokenExpiresAt')
      .leftJoinAndSelect('u.roles', 'role')
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('u.id = :id', { id: payload.sub })
      .getOne();

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User not found or inactive');
    }

    const tokenValid = user.refreshTokenHash
      ? await bcrypt.compare(refreshToken, user.refreshTokenHash)
      : false;

    if (!tokenValid) {
      throw new UnauthorizedException('Refresh token has been rotated or revoked');
    }

    if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired — please log in again');
    }

    return this.issueTokenPair(user);
  }

  async logout(
    userId: string,
    tenantId?: string,
    ip?: string,
    userAgent?: string,
    actorEmail?: string,
    jti?: string,
  ) {
    // Revoke refresh token (DB hash cleared)
    await this.usersRepo.update(userId, {
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    });

    // Blacklist the access token's JTI until its natural expiry elapses.
    if (jti) {
      const expiresAt = new Date(
        Date.now() + this.parseExpiryMs(
          this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
        ) + 60_000, // +1 min buffer
      );
      await this.ds
        .query(
          `INSERT INTO revoked_tokens(jti, user_id, expires_at)
           VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING`,
          [jti, userId, expiresAt],
        )
        .catch((err) =>
          this.logger.warn(`Failed to blacklist token JTI: ${err?.message}`),
        );
    }

    if (tenantId) {
      await this.writeAudit({
        tenantId,
        actorId: userId,
        actorEmail: actorEmail ?? null,
        action: 'LOGOUT',
        entityId: userId,
        metadata: jti ? { jtiRevoked: true } : undefined,
        ip,
        userAgent,
      });
    }
  }

  private parseExpiryMs(expiry: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiry);
    if (!match) return 15 * 60 * 1000;
    const n = parseInt(match[1], 10);
    const units: Record<string, number> = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 };
    return n * (units[match[2]] ?? 60e3);
  }

  private async issueTokenPair(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      jti: randomUUID(), // unique per-token ID — enables revocation on logout
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') as any, // ms.StringValue
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') as any, // ms.StringValue
    });

    // Store bcrypt hash of new refresh token (rotation)
    const rounds = Number(this.config.get<number>('BCRYPT_ROUNDS', 10));
    const refreshHash = await bcrypt.hash(refreshToken, rounds);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.usersRepo.update(user.id, {
      refreshTokenHash: refreshHash,
      refreshTokenExpiresAt: expiresAt,
    });

    const employee = await this.getLinkedEmployee(user.employeeId ?? null);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 min in seconds
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: user.tenantId,
        mustChangePassword: user.mustChangePassword,
        roles: user.roles?.map(r => r.code) ?? [],
        permissions: user.permissionCodes,
        employeeId: user.employeeId ?? null,
        employee,
      },
    };
  }

  /**
   * Self-service password change: verify the current password, enforce the
   * strength policy, rotate the hash, clear the must-change flag, and invalidate
   * any active refresh token so other sessions are forced to re-authenticate.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, ip?: string, userAgent?: string) {
    const user = await this.usersRepo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    if (!newPassword || newPassword.length < 10)
      throw new ForbiddenException('Password must be at least 10 characters.');
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword))
      throw new ForbiddenException('Password must include lowercase, uppercase, and a digit.');
    if (await bcrypt.compare(newPassword, user.passwordHash))
      throw new ForbiddenException('New password must differ from the current one.');

    const rounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const hash = await bcrypt.hash(newPassword, rounds);
    await this.usersRepo.update(userId, {
      passwordHash: hash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      refreshTokenHash: null,
    } as any);

    await this.writeAudit({
      tenantId: user.tenantId, actorId: user.id, actorEmail: user.email,
      action: 'auth.password_changed', entityId: user.id, ip, userAgent,
    });
    return { message: 'Password changed. Please sign in again on other devices.' };
  }
}
