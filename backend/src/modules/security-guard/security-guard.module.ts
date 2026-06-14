import { Module } from '@nestjs/common';
import { SecurityGuardController } from './security-guard.controller';
import { SecurityGuardService } from './security-guard.service';

@Module({
  controllers: [SecurityGuardController],
  providers: [SecurityGuardService],
  exports: [SecurityGuardService],
})
export class SecurityGuardModule {}
