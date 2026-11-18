import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';

const PASSWORD = 'Correct-Horse-1';
const baseUser = {
  id: 'u1',
  email: 'admin@example.com',
  fullName: 'Admin',
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
  status: 'ACTIVE',
  roles: [{ role: { code: 'ADMIN' } }],
  vendorLinks: [],
};

function build(user: unknown, tokenRecord: unknown = null) {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(user),
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(tokenRecord),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') };
  const service = new AuthService(
    prisma as never,
    jwt as unknown as JwtService,
    new ConfigService({}),
  );
  return { service, prisma, jwt };
}

const future = () => new Date(Date.now() + 60_000);
const record = (over: object = {}) => ({
  id: 't1',
  userId: 'u1',
  revokedAt: null,
  expiresAt: future(),
  user: baseUser,
  ...over,
});

describe('AuthService.login', () => {
  it('logs in with a valid password and puts roles in the token', async () => {
    const { service, jwt, prisma } = build(baseUser);
    const res = await service.login('ADMIN@example.com', PASSWORD);

    expect(res.accessToken).toBe('signed-token');
    expect(res.user.roles).toEqual(['ADMIN']);
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'u1',
      roles: ['ADMIN'],
      vendorId: null,
    });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('stores only a hash of the refresh token', async () => {
    const { service, prisma } = build(baseUser);
    const res = await service.login('admin@example.com', PASSWORD);

    const stored = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenHash).not.toBe(res.refreshToken);
    expect(res.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('puts the vendorId from the vendor link in the token', async () => {
    const { service, jwt } = build({
      ...baseUser,
      roles: [{ role: { code: 'VENDOR' } }],
      vendorLinks: [{ vendorId: 'v9' }],
    });
    await service.login('admin@example.com', PASSWORD);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 'v9' }),
    );
  });

  it('rejects a wrong password', async () => {
    const { service } = build(baseUser);
    await expect(service.login('admin@example.com', 'nope')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unknown email with the same error', async () => {
    const { service } = build(null);
    await expect(service.login('x@example.com', PASSWORD)).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('rejects a disabled user even with the right password', async () => {
    const { service } = build({ ...baseUser, status: 'DISABLED' });
    await expect(service.login('admin@example.com', PASSWORD)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthService.refresh', () => {
  it('rotates: revokes the old token and issues a new pair', async () => {
    const { service, prisma } = build(baseUser, record());
    const res = await service.refresh('raw-token');

    expect(res.accessToken).toBe('signed-token');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1', revokedAt: null } }),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown token', async () => {
    const { service } = build(baseUser, null);
    await expect(service.refresh('x')).rejects.toThrow(UnauthorizedException);
  });

  it('on reuse of a revoked token, revokes every session of that user', async () => {
    const { service, prisma } = build(
      baseUser,
      record({ revokedAt: new Date() }),
    );
    await expect(service.refresh('x')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const { service } = build(
      baseUser,
      record({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.refresh('x')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the user was disabled', async () => {
    const { service } = build(
      baseUser,
      record({ user: { ...baseUser, status: 'DISABLED' } }),
    );
    await expect(service.refresh('x')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when another request already claimed the token', async () => {
    const { service, prisma } = build(baseUser, record());
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh('x')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout / me', () => {
  it('logout revokes the matching token', async () => {
    const { service, prisma } = build(baseUser);
    await service.logout('raw');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { revokedAt: expect.any(Date) },
      }),
    );
  });

  it('me() rejects when the user was disabled after the token was issued', async () => {
    const { service } = build({ ...baseUser, status: 'DISABLED' });
    await expect(service.me('u1')).rejects.toThrow(UnauthorizedException);
  });
});
