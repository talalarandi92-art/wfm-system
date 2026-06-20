import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { User } from '@database/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    private config: ConfigService,
  ) {}

  async findById(id: string, tenantId: string): Promise<User> {
    const user = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['roles', 'roles.permissions'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string, tenantId: string): Promise<User | null> {
    return this.repo.findOne({
      where: { email: email.toLowerCase(), tenantId },
      relations: ['roles', 'roles.permissions'],
    });
  }

  async listByTenant(tenantId: string, page = 1, limit = 50) {
    const [data, total] = await this.repo.findAndCount({
      where: { tenantId },
      relations: ['roles'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  /** Enforce a sane strength policy on user-chosen passwords. */
  private assertStrongPassword(pw: string): void {
    if (!pw || pw.length < 10)
      throw new BadRequestException('Password must be at least 10 characters.');
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
      throw new BadRequestException('Password must include lowercase, uppercase, and a digit.');
  }

  async setPassword(userId: string, plainPassword: string): Promise<void> {
    this.assertStrongPassword(plainPassword);
    const rounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const hash = await bcrypt.hash(plainPassword, rounds);
    await this.repo.update(userId, {
      passwordHash: hash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    } as any);
  }

  async activate(userId: string, tenantId: string): Promise<void> {
    const user = await this.findById(userId, tenantId);
    if (user.status === 'active') return;
    await this.repo.update(userId, { status: 'active' });
  }

  async deactivate(userId: string, tenantId: string): Promise<void> {
    await this.findById(userId, tenantId);
    await this.repo.update(userId, {
      status: 'inactive',
      refreshTokenHash: null,
      refreshTokenExpiresAt: null,
    } as any);
  }

  async createUser(data: {
    tenantId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    password: string;
    status?: string;
  }): Promise<User> {
    const existing = await this.repo.findOne({
      where: { email: data.email.toLowerCase(), tenantId: data.tenantId },
    });
    if (existing) throw new ConflictException('Email already registered');

    const rounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const hash = await bcrypt.hash(data.password, rounds);

    const user = this.repo.create({
      tenantId: data.tenantId,
      email: data.email.toLowerCase(),
      firstName: data.firstName,
      lastName: data.lastName,
      passwordHash: hash,
      status: data.status ?? 'active',
      mustChangePassword: true,
    });

    return this.repo.save(user);
  }
}
