import { describe, expect, it } from 'bun:test';

import { extractUserIdFromCookies, normalizeHuaweiAccountId } from './huaweiAccount';

describe('normalizeHuaweiAccountId', () => {
  it('accepts a bare 17-digit id', () => {
    expect(normalizeHuaweiAccountId('12345678901234567')).toEqual({ ok: true, id: '12345678901234567' });
  });

  it('strips spaces and a userId= prefix', () => {
    expect(normalizeHuaweiAccountId('  userId=12345678901234567 ')).toEqual({ ok: true, id: '12345678901234567' });
    expect(normalizeHuaweiAccountId('1234 5678 9012 34567')).toEqual({ ok: true, id: '12345678901234567' });
  });

  it('rejects empty, non-digit, too short and too long', () => {
    expect(normalizeHuaweiAccountId('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeHuaweiAccountId('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeHuaweiAccountId('abcdef')).toEqual({ ok: false, reason: 'non_digit' });
    expect(normalizeHuaweiAccountId('12345')).toEqual({ ok: false, reason: 'too_short' });
    expect(normalizeHuaweiAccountId('123456789012345678901')).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('extractUserIdFromCookies', () => {
  it('finds userId in a cookie string', () => {
    expect(extractUserIdFromCookies('foo=1; userId=12345678901234567; bar=2')).toEqual({ ok: true, id: '12345678901234567' });
  });

  it('is case-insensitive and url-decodes', () => {
    expect(extractUserIdFromCookies('USERID=12345678901234567')).toEqual({ ok: true, id: '12345678901234567' });
    expect(extractUserIdFromCookies('userid=%2012345678901234567')).toEqual({ ok: true, id: '12345678901234567' });
  });

  it('does not match a different cookie that ends in userid', () => {
    expect(extractUserIdFromCookies('xuserid=999; other=1')).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports empty when there is no userId cookie', () => {
    expect(extractUserIdFromCookies('foo=1; bar=2')).toEqual({ ok: false, reason: 'empty' });
    expect(extractUserIdFromCookies('')).toEqual({ ok: false, reason: 'empty' });
  });
});
