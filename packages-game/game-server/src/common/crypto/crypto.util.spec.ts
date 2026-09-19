import { aesEncrypt, aesDecrypt, sha256Hex } from './crypto.util';

describe('crypto.util', () => {
  const secret = 'test-secret-123';

  it('aes 加解密往返一致', () => {
    const plain = '张三';
    const enc = aesEncrypt(plain, secret);
    expect(enc).not.toContain('张三');
    expect(aesDecrypt(enc, secret)).toBe(plain);
  });

  it('同一明文两次加密密文不同（随机 IV）', () => {
    expect(aesEncrypt('张三', secret)).not.toBe(aesEncrypt('张三', secret));
  });

  it('密钥错误解密失败', () => {
    const enc = aesEncrypt('张三', secret);
    expect(() => aesDecrypt(enc, 'wrong-secret')).toThrow();
  });

  it('sha256 固定输出', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
