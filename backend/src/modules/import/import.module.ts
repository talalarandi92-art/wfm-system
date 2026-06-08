import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ImportBatch } from '../../database/entities/import-batch.entity';
import { ImportRow }   from '../../database/entities/import-row.entity';
import { ShiftCode }   from '../../database/entities/shift-code.entity';

import { ImportService }    from './import.service';
import { ImportController } from './import.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportBatch, ImportRow, ShiftCode]),
  ],
  controllers: [ImportController],
  providers:   [ImportService],
  exports:     [ImportService],
})
export class ImportModule {}
