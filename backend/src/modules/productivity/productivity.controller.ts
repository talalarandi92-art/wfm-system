import {
  Controller, Post, UseGuards, UseInterceptors, UploadedFile,
  ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ProductivityService } from './productivity.service';

@ApiTags('Productivity')
@ApiBearerAuth()
@Controller('productivity')
@UseGuards(JwtAuthGuard)
export class ProductivityController {
  constructor(private readonly svc: ProductivityService) {}

  @Post('analyze')
  @RequirePermissions('reports.view')
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { ttl: 3600000, limit: 60 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an Ameyo Agent Productivity Interval export → per-agent productivity (no DB write)' })
  analyze(
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: 40 * 1024 * 1024 })],
    })) file: Express.Multer.File,
  ) {
    return this.svc.analyze(file.buffer);
  }
}
