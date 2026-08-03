import { GameException } from './game.exception';
import { ErrorCodes } from '@constants/error-codes';

describe('GameException', () => {
  it('should create with code, message, and data', () => {
    const ex = new GameException(ErrorCodes.ITEM_NOT_ENOUGH, '道具不足', {
      itemId: 1,
    });
    expect(ex.getResponse()).toEqual({
      code: ErrorCodes.ITEM_NOT_ENOUGH,
      msg: '道具不足',
      data: { itemId: 1 },
    });
  });

  it('should create without data', () => {
    const ex = new GameException(ErrorCodes.PARAM_INVALID, '参数非法');
    const response = ex.getResponse() as any;
    expect(response.code).toBe(ErrorCodes.PARAM_INVALID);
    expect(response.msg).toBe('参数非法');
    expect(response.data).toBeUndefined();
  });
});
