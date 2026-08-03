import { randomBytes } from 'crypto';

export function generateOrderNo(): string {
  const timestamp = Date.now().toString();
  const random = randomBytes(4).toString('hex');
  return `ORD${timestamp}${random}`;
}

export function generateBatchId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `BAT${timestamp}${random}`;
}
