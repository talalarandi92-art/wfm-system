import { Module } from '@nestjs/common';
import { EmployeeMergeService }    from './employee-merge.service';
import { EmployeeMergeController } from './employee-merge.controller';

@Module({
  controllers: [EmployeeMergeController],
  providers:   [EmployeeMergeService],
  exports:     [EmployeeMergeService],
})
export class EmployeeMergeModule {}
