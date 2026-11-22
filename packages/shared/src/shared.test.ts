import { describe, expect, it } from 'vitest';
import {
  checkRoleChange,
  formatMinorUnits,
  hasPermission,
  parseMajorToMinor,
  passwordSchema,
  permissionsForRoles,
  registerFormSchema,
  registerSchema,
} from './index';

describe('permissions', () => {
  it('grants customers only customer permissions', () => {
    expect(hasPermission(['CUSTOMER'], 'bookings:read-own')).toBe(true);
    expect(hasPermission(['CUSTOMER'], 'users:manage')).toBe(false);
  });

  it('merges permissions across multiple roles', () => {
    const perms = permissionsForRoles(['CUSTOMER', 'HOTEL_STAFF']);
    expect(perms).toContain('bookings:create');
    expect(perms).toContain('rooms:manage');
    expect(perms).not.toContain('hotels:create');
  });

  it('only lets super admins grant privileged roles', () => {
    const base = { actorId: 'a', targetId: 'b', targetCurrentRoles: ['CUSTOMER'] as const };
    expect(checkRoleChange({ ...base, actorRoles: ['ADMIN'], nextRoles: ['ADMIN'] }).allowed).toBe(
      false,
    );
    expect(
      checkRoleChange({ ...base, actorRoles: ['SUPER_ADMIN'], nextRoles: ['ADMIN'] }).allowed,
    ).toBe(true);
    expect(
      checkRoleChange({ ...base, actorRoles: ['ADMIN'], nextRoles: ['HOTEL_OWNER'] }).allowed,
    ).toBe(true);
  });

  it('prevents self role changes', () => {
    const result = checkRoleChange({
      actorId: 'a',
      targetId: 'a',
      actorRoles: ['SUPER_ADMIN'],
      targetCurrentRoles: ['SUPER_ADMIN'],
      nextRoles: ['CUSTOMER'],
    });
    expect(result.allowed).toBe(false);
  });
});

describe('schemas', () => {
  it('enforces password strength', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('Str0ngPassword').success).toBe(true);
  });

  it('normalises email and strips empty phone', () => {
    const result = registerSchema.parse({
      firstName: 'Asha',
      lastName: 'Rao',
      email: '  Asha.Rao@Example.COM ',
      phone: '',
      password: 'Str0ngPassword',
      acceptTerms: true,
    });
    expect(result.email).toBe('asha.rao@example.com');
    expect(result.phone).toBeUndefined();
  });

  it('rejects unknown fields such as roles on registration', () => {
    const result = registerSchema.safeParse({
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'asha@example.com',
      password: 'Str0ngPassword',
      acceptTerms: true,
      roles: ['ADMIN'],
    });
    expect(result.success).toBe(false);
  });

  it('requires matching confirm password in the form schema', () => {
    const result = registerFormSchema.safeParse({
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'asha@example.com',
      password: 'Str0ngPassword',
      confirmPassword: 'Different1Password',
      acceptTerms: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });
});

describe('money', () => {
  it('parses decimal input into integer minor units', () => {
    expect(parseMajorToMinor('1499.5', 'INR')).toBe(149950);
    expect(parseMajorToMinor('0.10', 'USD')).toBe(10);
    expect(() => parseMajorToMinor('1.234', 'INR')).toThrow();
  });

  it('formats minor units', () => {
    expect(formatMinorUnits(149950, 'INR', 'en-IN')).toBe('₹1,499.50');
    expect(() => formatMinorUnits(1.5, 'INR')).toThrow();
  });
});
