import type { CurrencyType } from '@constants/enums';

export interface RewardItem {
  type: 'currency' | 'item';
  itemId?: string;
  currencyType?: CurrencyType;
  amount: string;
}

export interface RewardResult {
  items: RewardItem[];
}
