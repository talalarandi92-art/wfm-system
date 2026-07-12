import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ScorecardController } from './scorecard.controller';
import { ScorecardUploadService } from './scorecard-upload.service';
import { ScorecardScoringService } from './scorecard-scoring.service';

@Module({
  imports: [
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [ScorecardController],
  providers: [ScorecardUploadService, ScorecardScoringService],
})
export class ScorecardModule {}
