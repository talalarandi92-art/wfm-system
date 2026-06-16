import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from '@database/entities/user.entity';

export interface JwtPayload {
  sub: string;       // user id
  tenantId: string;
  email: string;
  jti?: string;      // JWT ID — used for access token revocation
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectDataSource() private ds: DataSource,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User & { jti?: string }> {
    // Reject if this token's JTI has been explicitly revoked (e.g. logout)
    if (payload.jti) {
      const [revoked] = await this.ds.query(
        `SELECT 1 FROM revoked_tokens WHERE jti = $1 AND expires_at > NOW() LIMIT 1`,
        [payload.jti],
      );
      if (revoked) throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.usersRepo.findOne({
      where: { id: payload.sub, tenantId: payload.tenantId },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Attach jti so auth.controller can pass it to logout for blacklisting
    return Object.assign(user, { jti: payload.jti });
  }
}
