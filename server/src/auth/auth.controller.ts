import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Auth } from './auth.decorator.js';
import { CurrentUser } from './current-user.js';
import { readCookie } from './cookies.js';
import type { JwtPayload } from './auth.types.js';

const REFRESH_COOKIE = 'refresh_token';
// Only sent to /auth/* so the refresh token never travels with other requests.
const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, refreshExpiresAt, ...body } = await this.auth.login(
      dto.email,
      dto.password,
    );
    this.setRefreshCookie(res, refreshToken, refreshExpiresAt);
    return body;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (!raw) throw new UnauthorizedException();

    try {
      const { refreshToken, refreshExpiresAt, ...body } =
        await this.auth.refresh(raw);
      this.setRefreshCookie(res, refreshToken, refreshExpiresAt);
      return body;
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (raw) await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Auth()
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }

  private setRefreshCookie(res: Response, token: string, expires: Date) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
      expires,
    });
  }
}
