import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@database/entities/user.entity';

export interface JwtPayload {
  sub: string;       // user id
  tenantId: string;
  email: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id: payload.sub, tenantId: payload.tenantId },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
  }
}
