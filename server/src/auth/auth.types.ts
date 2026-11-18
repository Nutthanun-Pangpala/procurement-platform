import type { Request } from 'express';

/** Claims stored in the access token. Never trust ids sent by the client. */
export interface JwtPayload {
  sub: string;
  roles: string[];
  vendorId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  vendorId: string | null;
}
