import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * A malformed value is a BAD REQUEST, not a server failure.
 *
 * When a caller sends `?date=banana`, Postgres rejects it and the driver throws.
 * Untouched, Nest reports **500 Internal server error** — which blames the system
 * for the caller's input and tells the user nothing they can act on. Measured on
 * the live API (2026-07-25), 7 of 10 malformed-input probes answered 500.
 *
 * `common/query-params.pipe.ts` validates the parameter names the platform uses
 * everywhere. This is the net beneath it: any data-shape error that still reaches
 * the database is translated to a precise 400. Between them, a bad input can no
 * longer look like a broken product.
 *
 * DELIBERATELY NARROW. Only SQLSTATE classes that can ONLY mean "the input was
 * malformed" are converted. A constraint violation, a deadlock, a connection
 * failure — those are real server-side conditions and must keep their 500 and
 * their alarm. Turning a genuine failure into a 400 would hide the very thing
 * this is meant to expose.
 */
const INPUT_SHAPE_ERRORS: Record<string, string> = {
  '22007': 'invalid date/time format',
  '22008': 'date/time field out of range',
  '22P02': 'invalid text representation (a value was not the expected type)',
  '22003': 'numeric value out of range',
  '22023': 'invalid parameter value',
  '2201X': 'invalid row count in a LIMIT/OFFSET',
};

@Catch()
export class PgErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('PgErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // Anything already carrying an intentional HTTP status passes straight through.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json(exception.getResponse());
      return;
    }

    const code = (exception as { code?: string })?.code;
    const reason = code ? INPUT_SHAPE_ERRORS[code] : undefined;

    if (reason) {
      /* Log at warn, not error: nothing is wrong with the server, and paging
         someone for a user's typo is how alert fatigue starts. */
      this.logger.warn(`400 ${req.method} ${req.originalUrl} — ${reason} (SQLSTATE ${code})`);
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `One of the values sent is not valid: ${reason}. Check the date, month or numeric parameters.`,
        error: 'Bad Request',
      });
      return;
    }

    // A genuine server-side failure — keep the 500 and keep the noise.
    const msg = (exception as Error)?.message ?? 'Internal server error';
    this.logger.error(`500 ${req.method} ${req.originalUrl} — ${msg}`, (exception as Error)?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
