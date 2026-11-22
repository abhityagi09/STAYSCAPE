/**
 * Platform roles. Guests are unauthenticated public visitors and therefore have no role.
 */
export const ROLES = [
  'CUSTOMER',
  'HOTEL_OWNER',
  'HOTEL_STAFF',
  'SUPPORT',
  'ADMIN',
  'SUPER_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export const Role = {
  CUSTOMER: 'CUSTOMER',
  HOTEL_OWNER: 'HOTEL_OWNER',
  HOTEL_STAFF: 'HOTEL_STAFF',
  SUPPORT: 'SUPPORT',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const satisfies Record<Role, Role>;

/** Role assigned to every self-registered account. Public registration can never assign another role. */
export const DEFAULT_ROLE: Role = Role.CUSTOMER;

/** Roles that only a SUPER_ADMIN may grant or revoke. */
export const PRIVILEGED_ROLES: readonly Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

/** Relative authority, used to stop an administrator from modifying an equal or more senior account. */
export const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  HOTEL_STAFF: 1,
  HOTEL_OWNER: 2,
  SUPPORT: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
};

export const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: 'Customer',
  HOTEL_OWNER: 'Hotel owner',
  HOTEL_STAFF: 'Hotel staff',
  SUPPORT: 'Support',
  ADMIN: 'Administrator',
  SUPER_ADMIN: 'Super administrator',
};

export function highestRank(roles: readonly Role[]): number {
  return roles.reduce((max, role) => Math.max(max, ROLE_RANK[role]), -1);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
