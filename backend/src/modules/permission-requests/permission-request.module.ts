import { Module } from '@nestjs/common';
import { PermissionRequestController } from './permission-request.controller';
import { PermissionRequestService } from './permission-request.service';

@Module({
  controllers: [PermissionRequestController],
  providers:   [PermissionRequestService],
  exports:     [PermissionRequestService],
})
export class PermissionRequestModule {}
