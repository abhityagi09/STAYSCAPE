import { PRIVILEGED_ROLES, ROLE_RANK, highestRank, type Role } from './roles';

/**
 * Fine-grained permissions. The backend is the sole enforcement point; the frontend only uses
 * these to decide which navigation to render.
 */
export const PERMISSIONS = [
  // customer
  'bookings:create',
  'bookings:read-own',
  'bookings:cancel-own',
  'reviews:create',
  // partner
  'partner:access',
  'hotels:create',
  'hotels:update',
  'rooms:manage',
  'bookings:read-property',
  'staff:manage',
  // platform
  'admin:access',
  'hotels:moderate',
  'bookings:read-all',
  'users:read',
  'users:manage',
  'partners:approve',
  'payments:read',
  'refunds:manage',
  'reports:view',
  'reviews:moderate',
  'support:create',
  'audit:read',
  'roles:assign-privileged',
  'system:configure',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER: Permission[] = [
  'bookings:create',
  'bookings:read-own',
  'bookings:cancel-own',
  'reviews:create',
  'support:create',
];

const HOTEL_STAFF: Permission[] = ['partner:access', 'rooms:manage', 'bookings:read-property'];

const HOTEL_OWNER: Permission[] = [
  ...HOTEL_STAFF,
  'hotels:create',
  'hotels:update',
  'staff:manage',
  'reports:view',
];

const SUPPORT: Permission[] = ['admin:access', 'users:read', 'bookings:read-all', 'payments:read'];

const ADMIN: Permission[] = [
  ...SUPPORT,
  'users:manage',
  'hotels:moderate',
  'partners:approve',
  'refunds:manage',
  'reports:view',
  'reviews:moderate',
  'audit:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  CUSTOMER,
  HOTEL_STAFF,
  HOTEL_OWNER,
  SUPPORT,
  ADMIN,
  SUPER_ADMIN: [...PERMISSIONS],
};

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set].sort();
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}

export function hasAllPermissions(
  roles: readonly Role[],
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => hasPermission(roles, permission));
}

export function hasAnyPermission(
  roles: readonly Role[],
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(roles, permission));
}

export interface RoleChangeCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether `actorRoles` may replace `targetCurrentRoles` with `nextRoles`.
 * Rules:
 *  - actor needs users:manage
 *  - nobody changes their own roles (prevents self-escalation and lock-out)
 *  - privileged roles (ADMIN, SUPER_ADMIN) can only be granted or removed by a SUPER_ADMIN
 *  - non-super-admins cannot modify accounts of equal or higher rank
 */
export function checkRoleChange(params: {
  actorId: string;
  actorRoles: readonly Role[];
  targetId: string;
  targetCurrentRoles: readonly Role[];
  nextRoles: readonly Role[];
}): RoleChangeCheck {
  const { actorId, actorRoles, targetId, targetCurrentRoles, nextRoles } = params;
  if (!hasPermission(actorRoles, 'users:manage')) {
    return { allowed: false, reason: 'You do not have permission to manage users.' };
  }
  if (actorId === targetId) {
    return { allowed: false, reason: 'You cannot change your own roles.' };
  }
  const actorIsSuper = hasPermission(actorRoles, 'roles:assign-privileged');
  const touchesPrivileged = [...targetCurrentRoles, ...nextRoles].some((role) =>
    PRIVILEGED_ROLES.includes(role),
  );
  if (touchesPrivileged && !actorIsSuper) {
    return { allowed: false, reason: 'Only a super administrator can manage privileged roles.' };
  }
  if (!actorIsSuper && highestRank(targetCurrentRoles) >= highestRank(actorRoles)) {
    return {
      allowed: false,
      reason: 'You cannot modify an account with equal or greater authority.',
    };
  }
  return { allowed: true };
}

/** Same seniority rule for status changes (suspension etc.). */
export function canModerateAccount(params: {
  actorId: string;
  actorRoles: readonly Role[];
  targetId: string;
  targetRoles: readonly Role[];
}): RoleChangeCheck {
  const { actorId, actorRoles, targetId, targetRoles } = params;
  if (!hasPermission(actorRoles, 'users:manage')) {
    return { allowed: false, reason: 'You do not have permission to manage users.' };
  }
  if (actorId === targetId) return { allowed: false, reason: 'You cannot change your own status.' };
  const actorRank = highestRank(actorRoles);
  if (actorRank < ROLE_RANK.SUPER_ADMIN && highestRank(targetRoles) >= actorRank) {
    return {
      allowed: false,
      reason: 'You cannot modify an account with equal or greater authority.',
    };
  }
  return { allowed: true };
}
