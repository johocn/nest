import {
  TYPE_TO_ENUM,
  ENUM_TO_TYPE,
  toEntityPayload,
  fromEntity,
} from './notice-admin.controller';

describe('NoticeAdmin mapping layer', () => {
  // ========== TYPE_TO_ENUM 双向性 ==========
  describe('TYPE_TO_ENUM / ENUM_TO_TYPE bidirectional', () => {
    it('TYPE_TO_ENUM maps all 3 admin-web types to NoticeType enum values', () => {
      expect(TYPE_TO_ENUM.announcement).toBe('popup');
      expect(TYPE_TO_ENUM.maintenance).toBe('banner');
      expect(TYPE_TO_ENUM.activity).toBe('login');
    });
    it('ENUM_TO_TYPE inverts TYPE_TO_ENUM for all entries', () => {
      for (const [webType, enumVal] of Object.entries(TYPE_TO_ENUM)) {
        expect(ENUM_TO_TYPE[enumVal]).toBe(webType);
      }
    });
  });

  // ========== toEntityPayload ==========
  describe('toEntityPayload', () => {
    it('maps announcement → popup', () => {
      const out = toEntityPayload({ type: 'announcement' });
      expect(out.noticeType).toBe('popup');
      expect(out.type).toBeUndefined();
    });
    it('maps maintenance → banner', () => {
      const out = toEntityPayload({ type: 'maintenance' });
      expect(out.noticeType).toBe('banner');
    });
    it('maps activity → login', () => {
      const out = toEntityPayload({ type: 'activity' });
      expect(out.noticeType).toBe('login');
    });
    it('unknown type passthrough (透传)', () => {
      const out = toEntityPayload({ type: 'unknown_type' });
      expect(out.noticeType).toBe('unknown_type');
    });
    it('no type → nothing added', () => {
      const out = toEntityPayload({ title: 'test' });
      expect(out.noticeType).toBeUndefined();
      expect(out.type).toBeUndefined();
    });
    it('preserves other fields', () => {
      const out = toEntityPayload({ title: 'Hello', content: 'World', type: 'announcement', scope: 'global', priority: 'high' });
      expect(out.title).toBe('Hello');
      expect(out.content).toBe('World');
      expect(out.scope).toBe('global');
      expect(out.priority).toBe('high');
      expect(out.noticeType).toBe('popup');
    });
  });

  // ========== fromEntity ==========
  describe('fromEntity', () => {
    it('maps popup → announcement', () => {
      const out = fromEntity({ noticeType: 'popup' });
      expect(out.type).toBe('announcement');
      expect(out.noticeType).toBe('popup'); // 原始字段也保留
    });
    it('maps banner → maintenance', () => {
      const out = fromEntity({ noticeType: 'banner' });
      expect(out.type).toBe('maintenance');
    });
    it('maps login → activity', () => {
      const out = fromEntity({ noticeType: 'login' });
      expect(out.type).toBe('activity');
    });
    it('unknown noticeType passthrough', () => {
      const out = fromEntity({ noticeType: 'custom' });
      expect(out.type).toBe('custom');
    });
    it('returns null for null input', () => {
      expect(fromEntity(null)).toBeNull();
    });
    it('preserves other fields', () => {
      const out = fromEntity({ noticeType: 'popup', title: 'Hi', isActive: true });
      expect(out.title).toBe('Hi');
      expect(out.isActive).toBe(true);
      expect(out.type).toBe('announcement');
    });
  });
});
