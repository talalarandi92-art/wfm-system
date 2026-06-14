import { Module } from '@nestjs/common';
import { CoachingService } from './coaching.service';
import { CoachingController } from './coaching.controller';

@Module({
  controllers: [CoachingController],
  providers: [CoachingService],
})
export class CoachingModule {}
