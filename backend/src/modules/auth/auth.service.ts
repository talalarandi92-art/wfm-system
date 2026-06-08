import {
  Injectable, UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '@database/entities/user.entity';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string, tenantId?: string) {
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

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'locked') {
      throw new ForbiddenException('Account is locked. Contact your administrator.');
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active.');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      // Increment failed attempts
      await this.usersRepo.update(user.id, {
        failedAttempts: () => 'failed_attempts + 1',
      });

      const maxAttempts = this.config.get<number>('MAX_FAILED_LOGIN_ATTEMPTS', 5);
      if (user.failedAttempts + 1 >= maxAttempts) {
        await this.usersRepo.update(user.id, {
          status: 'locked',
          lockedAt: new Date(),
        });
        throw new ForbiddenException('Account locked after too many failed attempts.');
      }

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts on success
    await this.usersRepo.update(user.id, {
      failedAttempts: 0,
      lastLoginAt: new Date(),
    });

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

  async logout(userId: string) {
    await this.usersRepo.update(userId, {
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    });
  }

  private async issueTokenPair(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    // Store bcrypt hash of new refresh token (rotation)
    const rounds = this.config.get<number>('BCRYPT_ROUNDS', 10);
    const refreshHash = await bcrypt.hash(refreshToken, rounds);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.usersRepo.update(user.id, {
      refreshTokenHash: refreshHash,
      refreshTokenExpiresAt: expiresAt,
    });

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
      },
    };
  }
}
