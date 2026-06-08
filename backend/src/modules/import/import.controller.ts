import {
  Controller, Post, Get, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile,
  ParseUUIDPipe, ParseIntPipe, DefaultValuePipe,
  BadRequestException, Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation,
  ApiQuery, ApiParam,
} from '@nestjs/swagger';

import { JwtAuthGuard }   from '../../common/guards/jwt-auth.guard';
import { CurrentUser }    from '../../common/decorators/current-user.decorator';
import { ImportService, ImportType } from './import.service';

const ALLOWED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some OS sends this for .xlsx
];

const MAX_FILE_MB = 50;

@ApiTags('Import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('imports')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);
  constructor(private readonly svc: ImportService) {}

  /** Upload workbook → parse → return preview */
  @Post('upload')
  @ApiOperation({ summary: 'Upload an Excel workbook and get a parse preview' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (
          ALLOWED_MIME.includes(file.mimetype) ||
          file.originalname.match(/\.(xlsx|xls)$/i)
        ) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only .xlsx / .xls files are allowed'), false);
        }
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('type') importType: ImportType,
    @Query('sheet') sheetName: string,
    @CurrentUser() user: any,
  ) {
    try {
      if (!file) throw new BadRequestException('No file uploaded');
      if (!['timing', 'shifts', 'schedule'].includes(importType)) {
        throw new BadRequestException('type must be: timing | shifts | schedule');
      }
      this.logger.log(`Upload: type=${importType} sheet=${sheetName} size=${file?.size} user=${user?.id}`);
      return await this.svc.upload(user.tenantId, user.id, file, importType, sheetName);
    } catch (err) {
      this.logger.error(`Upload failed: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  /** List available sheet names in an uploaded file */
  @Post('sheets')
  @ApiOperation({ summary: 'Return sheet names from an uploaded workbook' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
    }),
  )
  async listSheets(@UploadedFile() file: Express.Multer.File) {
    try {
      this.logger.log(`listSheets called, file=${file?.originalname}, size=${file?.size}`);
      if (!file) throw new BadRequestException('No file uploaded');
      const XLSX = await import('xlsx');
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      this.logger.log(`Sheets found: ${wb.SheetNames.join(', ')}`);
      return { sheetNames: wb.SheetNames };
    } catch (err) {
      this.logger.error(`listSheets failed: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  /** Get preview + paginated rows for a batch */
  @Get(':batchId/preview')
  @ApiOperation({ summary: 'Get parsed preview rows for a batch' })
  @ApiParam({ name: 'batchId', type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'filter', required: false, enum: ['all', 'valid', 'error', 'warning'] })
  async preview(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100),  ParseIntPipe) limit: number,
    @Query('filter') filter: 'all' | 'valid' | 'error' | 'warning',
    @CurrentUser() user: any,
  ) {
    return this.svc.getPreview(user.tenantId, batchId, page, limit, filter ?? 'all');
  }

  /** Commit a previewed batch to real tables */
  @Post(':batchId/commit')
  @ApiOperation({ summary: 'Commit a validated import batch to the database' })
  @ApiParam({ name: 'batchId', type: String })
  async commit(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body('skipErrors') skipErrors: boolean,
    @CurrentUser() user: any,
  ) {
    return this.svc.commit(user.tenantId, user.id, batchId, skipErrors ?? false);
  }

  /** List recent import batches */
  @Get()
  @ApiOperation({ summary: 'List import batches' })
  @ApiQuery({ name: 'type', required: false, enum: ['timing', 'shifts', 'schedule'] })
  async list(
    @Query('type') importType: ImportType,
    @CurrentUser() user: any,
  ) {
    return this.svc.listBatches(user.tenantId, importType);
  }
}
