import {
  Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Get, Req,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MfaTokenDto, MfaDisableDto } from './dto/mfa.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { Public } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@database/entities/user.entity';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // Stricter limit on login
  @ApiOperation({ summary: 'Login — returns access + refresh tokens' })
  @ApiOkResponse({ description: 'JWT token pair and user context' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    const userAgent = req.headers['user-agent'];
    return this.authService.login(dto.email, dto.password, undefined, ip, userAgent, dto.mfaCode);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token — returns new token pair' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout — revokes refresh token' })
  logout(@CurrentUser() user: User, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    const userAgent = req.headers['user-agent'];
    return this.authService.logout(
      user.id,
      (user as any).tenantId,
      ip,
      userAgent,
      (user as any).email ?? user.email,
      (user as any).jti,  // JTI attached by JwtStrategy.validate() for blacklisting
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change own password — verifies current, enforces policy, rotates sessions' })
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    return this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword, ip, req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Begin TOTP MFA enrolment — returns secret + otpauth URL for a QR' })
  mfaSetup(@CurrentUser() user: User) {
    return this.authService.setupMfa(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Verify the first TOTP code and turn MFA on' })
  mfaEnable(@CurrentUser() user: User, @Body() dto: MfaTokenDto) {
    return this.authService.enableMfa(user.id, dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disable MFA — requires password and a current code' })
  mfaDisable(@CurrentUser() user: User, @Body() dto: MfaDisableDto) {
    return this.authService.disableMfa(user.id, dto.password, dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile and permissions' })
  async me(@CurrentUser() user: User) {
    const employee = await this.authService.getLinkedEmployee(user.employeeId ?? null);
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: user.mfaEnabled ?? false,
      roles: user.roles?.map(r => r.code) ?? [],
      permissions: user.permissionCodes,
      employeeId: user.employeeId ?? null,
      employee,
    };
  }
}
