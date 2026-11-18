import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

const PASSWORD = 'Correct-Horse-1';
const user = {
  id: 'u1',
  email: 'admin@example.com',
  fullName: 'Admin',
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
  status: 'ACTIVE',
  roles: [{ role: { code: 'ADMIN' } }],
  vendorLinks: [],
};

type TokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

// Small in-memory stand-in for the RefreshToken table.
function fakePrisma() {
  const tokens: TokenRow[] = [];
  return {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    user: {
      findFirst: async () => user,
      findUnique: async () => user,
      update: async () => user,
    },
    refreshToken: {
      create: async ({
        data,
      }: {
        data: Omit<TokenRow, 'id' | 'revokedAt'>;
      }) => {
        const row = { ...data, id: `t${tokens.length + 1}`, revokedAt: null };
        tokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = tokens.find((t) => t.tokenHash === where.tokenHash);
        return row ? { ...row, user } : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Partial<TokenRow>;
        data: { revokedAt: Date };
      }) => {
        const rows = tokens.filter(
          (t) =>
            (where.id === undefined || t.id === where.id) &&
            (where.userId === undefined || t.userId === where.userId) &&
            (where.tokenHash === undefined ||
              t.tokenHash === where.tokenHash) &&
            t.revokedAt === null,
        );
        rows.forEach((t) => (t.revokedAt = data.revokedAt));
        return { count: rows.length };
      },
    },
  };
}

const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    process.env.JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-1234';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma())
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('login returns a token, then /auth/me works with it', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect(login.body.refreshToken).toBeUndefined();

    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: user.email, roles: ['ADMIN'] });
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('login sets an httpOnly refresh cookie limited to /api/v1/auth', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const header = (login.headers['set-cookie'] as unknown as string[])[0];
    expect(header).toContain('refresh_token=');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/api/v1/auth');
  });

  it('refresh rotates the cookie, and the old one stops working', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const first = cookieOf(login);

    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(200);
    expect(refreshed.body.accessToken).toBeDefined();
    const second = cookieOf(refreshed);
    expect(second).not.toBe(first);

    // Replaying the old token is rejected and kills the new session too.
    await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    await http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('refresh without a cookie is 401', () =>
    http().post('/api/v1/auth/refresh').expect(401));

  it('logout revokes the refresh token and clears the cookie', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const cookie = cookieOf(login);

    const out = await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toContain(
      'refresh_token=;',
    );

    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('logout without a cookie is still 204', () =>
    http().post('/api/v1/auth/logout').expect(204));

  it('/auth/me without or with a bad token is 401', async () => {
    await http().get('/api/v1/auth/me').expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.token')
      .expect(401);
  });

  it('login with the wrong password is 401', () =>
    http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong' })
      .expect(401));

  it('login rejects bad email and unknown fields (400)', async () => {
    await http()
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD, role: 'ADMIN' })
      .expect(400);
  });
});
