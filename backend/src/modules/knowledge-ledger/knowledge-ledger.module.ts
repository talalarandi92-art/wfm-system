import { Module } from '@nestjs/common';
import { KnowledgeLedgerController } from './knowledge-ledger.controller';

@Module({
  controllers: [KnowledgeLedgerController],
})
export class KnowledgeLedgerModule {}
