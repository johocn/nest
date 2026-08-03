import { HttpException, HttpStatus } from '@nestjs/common';

export interface GameExceptionResponse {
  code: number;
  msg: string;
  data?: any;
}

export class GameException extends HttpException {
  constructor(code: number, msg: string, data?: any) {
    const response: GameExceptionResponse = { code, msg };
    if (data !== undefined) {
      response.data = data;
    }
    super(response, HttpStatus.OK);
  }
}
