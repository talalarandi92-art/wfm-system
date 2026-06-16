import { Module } from '@nestjs/common';
import { TeamLearningController } from './team-learning.controller';

@Module({
  controllers: [TeamLearningController],
})
export class TeamLearningModule {}
