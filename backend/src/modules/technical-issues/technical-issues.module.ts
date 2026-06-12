import { Module } from '@nestjs/common';
import { TechnicalIssuesController } from './technical-issues.controller';

@Module({ controllers: [TechnicalIssuesController] })
export class TechnicalIssuesModule {}
