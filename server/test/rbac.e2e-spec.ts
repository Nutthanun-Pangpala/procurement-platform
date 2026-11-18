import {
  Controller,
  Get,
  INestApplication,
  Module,
  Query,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { Auth } from './../src/auth/auth.decorator.js';
import type { JwtPayload } from './../src/auth/auth.types.js';
import { AuthModule } from './../src/auth/auth.module.js';
import { CurrentUser, requireVendorId } from './../src/auth/current-user.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Throwaway routes that exist only in this test, to exercise the guards.
@Controller('rbac-test')
class RbacTestController {
  @Auth()
  @Get('any')
  any() {
    return { ok: true };
  }

  @Auth('ADMIN')
  @Get('admin')
  admin() {
    return { ok: true };
  }

  @Auth('PROCUREMENT', 'APPROVER')
  @Get('either')
  either() {
    return { ok: true };
  }

  @Auth('VENDOR')
  @Get('vendor-scope')
  vendorScope(
    @CurrentUser() user: JwtPayload,
    @Query('vendorId') _ignored?: string,
  ) {
    return { vendorId: requireVendorId(user) };
  }
}

@Module({ imports: [AuthModule], controllers: [RbacTestController] })
class RbacTestModule {}

describe('RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const http = () => request(app.getHttpServer());
  const token = (roles: string[], vendorId: string | null = null) =>
    jwt.signAsync({ sub: 'u1', roles, vendorId } satisfies JwtPayload);
  // Sends the request and returns the response (status + body).
  const call = async (
    path: string,
    roles?: string[],
    vendorId: string | null = null,
  ) => {
    const req = http().get(`/api/v1/rbac-test/${path}`);
    if (roles) {
      req.set('Authorization', `Bearer ${await token(roles, vendorId)}`);
    }
    return req;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-1234';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, RbacTestModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: async () => undefined,
        $disconnect: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    jwt = app.get(JwtService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 without a token, on every protected route', async () => {
    expect((await call('any')).status).toBe(401);
    expect((await call('admin')).status).toBe(401);
    expect((await call('either')).status).toBe(401);
  });

  it('@Auth() lets any logged-in role in', async () => {
    expect((await call('any', ['VENDOR'])).status).toBe(200);
  });

  it('403 for the wrong role, 200 for the right one', async () => {
    expect((await call('admin', ['PM_REQUESTER'])).status).toBe(403);
    expect((await call('admin', ['ADMIN'])).status).toBe(200);
  });

  it('accepts any one of several allowed roles', async () => {
    expect((await call('either', ['APPROVER'])).status).toBe(200);
    expect((await call('either', ['PROCUREMENT'])).status).toBe(200);
    expect((await call('either', ['VENDOR'])).status).toBe(403);
  });

  it('ADMIN is not a superuser', async () => {
    expect((await call('either', ['ADMIN'])).status).toBe(403);
  });

  it('a user with several roles passes if any one matches', async () => {
    expect((await call('either', ['PM_REQUESTER', 'APPROVER'])).status).toBe(
      200,
    );
  });

  it('vendor routes use the vendorId from the token, not the query', async () => {
    const res = await call(
      'vendor-scope?vendorId=someone-else',
      ['VENDOR'],
      'v1',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vendorId: 'v1' });
  });

  it('a VENDOR token with no vendor linked is 403', async () => {
    expect((await call('vendor-scope', ['VENDOR'], null)).status).toBe(403);
  });
});
