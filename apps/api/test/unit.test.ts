/* Small DB-free checks of pure helpers (no PostgreSQL needed). Importing these modules only creates a lazy
   connection pool; nothing connects until a query runs. */
import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { bad, conflict, forbidden, locked, notFound, unauthorized, HttpError } from '../src/errors.js';
import { hashPassword, PasswordPolicy } from '../src/auth.js';
import { DateParam, IdParam, parse } from '../src/routes/util.js';
import { localDate, localHHMM, minutesOfDay } from '../src/clock.js';

describe('error helpers', () => {
  it('map to the expected HTTP statuses', () => {
    expect(bad('x').status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict('x').status).toBe(409);
    expect(locked('x').status).toBe(423);
  });
  it('keep their default messages and optional code/details', () => {
    expect(unauthorized().message).toBe('Sign in first.');
    expect(forbidden().message).toBe('You do not have access to this.');
    expect(notFound().message).toBe('Not found');
    expect(unauthorized('nope', 'token_expired').code).toBe('token_expired');
    expect(conflict('clash', { a: 1 }, 'dup').details).toEqual({ a: 1 });
    expect(bad('x')).toBeInstanceOf(HttpError);
  });
});

describe('password handling', () => {
  it('hashPassword produces a verifiable bcrypt hash with cost 12', async () => {
    const h = await hashPassword('Sample-Passw0rd');
    expect(h).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare('Sample-Passw0rd', h)).toBe(true);
    expect(await bcrypt.compare('another-Passw0rd', h)).toBe(false);
  });
  it('PasswordPolicy enforces length, a letter and a number', () => {
    expect(PasswordPolicy.safeParse('abcdefgh12').success).toBe(true);
    expect(PasswordPolicy.safeParse('short1a').error?.issues[0].message).toBe('Use at least 10 characters.');
    expect(PasswordPolicy.safeParse('1234567890').error?.issues[0].message).toBe('Include at least one letter.');
    expect(PasswordPolicy.safeParse('abcdefghijk').error?.issues[0].message).toBe('Include at least one number.');
    expect(PasswordPolicy.safeParse('a1'.repeat(70)).success).toBe(false); // over 128 characters
  });
});

describe('request parameter parsing', () => {
  it('accepts a YYYY-MM-DD date and rejects anything else with the same message', () => {
    expect(parse(DateParam, { date: '2026-04-30' })).toEqual({ date: '2026-04-30' });
    expect(() => parse(DateParam, { date: '30-04-2026' })).toThrow('date: Use YYYY-MM-DD.');
  });
  it('coerces numeric ids and rejects non-positive or non-integer values', () => {
    expect(parse(IdParam, { id: '42' })).toEqual({ id: 42 });
    expect(() => parse(IdParam, { id: '0' })).toThrow(HttpError);
    expect(() => parse(IdParam, { id: '1.5' })).toThrow(HttpError);
  });
  it('turns validation failures into a 400 with field details', () => {
    try { parse(DateParam, {}); expect.unreachable(); } catch (e) {
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).details).toEqual([{ field: 'date', message: 'Required' }]);
    }
  });
});

describe('Sri Lanka local time helpers', () => {
  it('convert a UTC instant to local date, clock time and minutes of day (UTC+05:30)', () => {
    const d = new Date('2026-04-30T20:00:00Z'); // 01:30 on 1 May in Colombo
    expect(localDate(d)).toBe('2026-05-01');
    expect(localHHMM(d)).toBe('01:30');
    expect(minutesOfDay(d)).toBe(90);
  });
  it('keep the local date during the Colombo morning', () => {
    const d = new Date('2026-04-30T02:30:00+05:30');
    expect(localDate(d)).toBe('2026-04-30');
    expect(localHHMM(d)).toBe('02:30');
    expect(minutesOfDay(d)).toBe(150);
  });
});
