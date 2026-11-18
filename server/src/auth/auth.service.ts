import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload, UserProfile } from './auth.types.js';

// Compared against when the email is unknown, so response time does not
// reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const USER_INCLUDE = {
  roles: { include: { role: true } },
  vendorLinks: true,
} as const;

type UserWithRelations = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roles: { role: { code: string } }[];
  vendorLinks: { vendorId: string }[];
};

// Only the hash is stored, so a database leak does not leak usable tokens.
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly refreshDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshDays = Number(config.get('REFRESH_TOKEN_DAYS') ?? 7);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      include: USER_INCLUDE,
    });

    const passwordOk = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.startSession(user);
  }

  /** Rotates the refresh token: the old one is revoked, a new one is issued. */
  async refresh(rawToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { include: USER_INCLUDE } },
    });
    if (!record) throw new UnauthorizedException();

    if (record.revokedAt) {
      // A revoked token came back: treat it as stolen and end every session.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException();
    }
    if (record.expiresAt <= new Date() || record.user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }

    // Only one concurrent request can claim the token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) throw new UnauthorizedException();

    return this.startSession(record.user);
  }

  /** Idempotent: unknown or already revoked tokens are ignored. */
  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_INCLUDE,
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return this.toProfile(user);
  }

  private async startSession(user: UserWithRelations) {
    const profile = this.toProfile(user);
    const payload: JwtPayload = {
      sub: profile.id,
      roles: profile.roles,
      vendorId: profile.vendorId,
    };
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.refreshDays * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: profile.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: profile,
      refreshToken,
      refreshExpiresAt,
    };
  }

  private toProfile(user: UserWithRelations): UserProfile {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles.map((r) => r.role.code),
      vendorId: user.vendorLinks[0]?.vendorId ?? null,
    };
  }
}
