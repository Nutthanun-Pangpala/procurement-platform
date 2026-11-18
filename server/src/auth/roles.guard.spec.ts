import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';

function ctx(user: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: string[] | undefined) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(roles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

const user = (...roles: string[]) => ({ sub: 'u1', roles, vendorId: null });

describe('RolesGuard', () => {
  it('allows any logged-in user when no roles are required', () => {
    expect(guardRequiring(undefined).canActivate(ctx(user()))).toBe(true);
    expect(guardRequiring([]).canActivate(ctx(user('VENDOR')))).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    const guard = guardRequiring(['PROCUREMENT', 'APPROVER']);
    expect(guard.canActivate(ctx(user('APPROVER')))).toBe(true);
  });

  it('allows a user with several roles when one matches', () => {
    const guard = guardRequiring(['PROCUREMENT']);
    expect(guard.canActivate(ctx(user('PM_REQUESTER', 'PROCUREMENT')))).toBe(
      true,
    );
  });

  it('forbids a user without any required role', () => {
    const guard = guardRequiring(['PROCUREMENT']);
    expect(() => guard.canActivate(ctx(user('VENDOR')))).toThrow(
      ForbiddenException,
    );
  });

  it('does not treat ADMIN as a superuser', () => {
    const guard = guardRequiring(['PROCUREMENT']);
    expect(() => guard.canActivate(ctx(user('ADMIN')))).toThrow(
      ForbiddenException,
    );
  });

  it('is unauthorized when no user is on the request', () => {
    const guard = guardRequiring(['ADMIN']);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
