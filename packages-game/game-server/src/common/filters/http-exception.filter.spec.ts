import { HttpExceptionFilter } from './http-exception.filter';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

function createMockHost(): ArgumentsHost {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const request = { url: '/test', method: 'GET' };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as any;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('should format GameException response', () => {
    const host = createMockHost();
    const exception = new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具不足');

    filter.catch(exception, host);

    const response = host.switchToHttp().getResponse();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(response.json).toHaveBeenCalledWith({
      code: ErrorCodes.ITEM_NOT_ENOUGH,
      msg: '道具不足',
      data: undefined,
    });
  });

  it('should format generic HttpException response', () => {
    const host = createMockHost();
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    const response = host.switchToHttp().getResponse();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({
      code: HttpStatus.NOT_FOUND,
      msg: 'Not Found',
      data: undefined,
    });
  });

  it('should format unknown error as internal error', () => {
    const host = createMockHost();
    const exception = new Error('Something went wrong');

    filter.catch(exception as any, host);

    const response = host.switchToHttp().getResponse();
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({
      code: ErrorCodes.INTERNAL_ERROR,
      msg: 'Internal server error',
      data: undefined,
    });
  });
});
