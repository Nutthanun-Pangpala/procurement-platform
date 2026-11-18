import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthenticatedRequest, JwtPayload } from './auth.types.js';

/** The caller as stored in the token. Use this, never ids from the request body. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export function hasAnyRole(user: JwtPayload, ...roles: string[]): boolean {
  return roles.some((role) => user.roles.includes(role));
}

/** For Vendor-only routes: the vendor always comes from the token. */
export function requireVendorId(user: JwtPayload): string {
  if (!user.vendorId) throw new ForbiddenException('Vendor account required');
  return user.vendorId;
}
