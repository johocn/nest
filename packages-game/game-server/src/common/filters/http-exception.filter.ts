import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: number = ErrorCodes.INTERNAL_ERROR;
    let msg = 'Internal server error';
    let data: any = undefined;

    if (exception instanceof GameException) {
      const res = exception.getResponse() as any;
      code = res.code;
      msg = res.msg;
      data = res.data;
      status = exception.getStatus();
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        msg = res;
        code = status;
      } else if (typeof res === 'object' && res !== null) {
        msg = (res as any).message || exception.message;
        code = status;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
    }

    this.logger.error(
      `${request.method} ${request.url} → ${status} [${code}] ${msg}`,
    );

    response.status(status).json({ code, msg, data });
  }
}
