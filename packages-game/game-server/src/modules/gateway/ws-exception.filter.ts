import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();
    const message = host.switchToWs().getData();

    let code: number = ErrorCodes.INTERNAL_ERROR;
    let msg: string = '服务器内部错误';
    let data: any = null;

    if (exception instanceof GameException) {
      const response = exception.getResponse() as any;
      code = response.code;
      msg = response.msg;
      data = response.data;
    } else if (exception instanceof Error) {
      msg = exception.message;
      this.logger.error(`WS error: ${exception.message}`, exception.stack);
    }

    client.emit('message', {
      cmd: message?.cmd ?? 'error',
      seq: message?.seq ?? 0,
      code,
      msg,
      data,
    });
  }
}
