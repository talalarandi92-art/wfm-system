import {
  Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Get,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
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
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
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
  logout(@CurrentUser() user: User) {
    return this.authService.logout(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile and permissions' })
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
      roles: user.roles?.map(r => r.code) ?? [],
      permissions: user.permissionCodes,
    };
  }
}
