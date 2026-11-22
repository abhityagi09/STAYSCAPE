import { hasPermission, type Permission, type Role } from '@stayscape/shared';
import { Errors } from '@/lib/errors';

export interface Principal {
  userId: string;
  roles: readonly Role[];
}

export interface OwnedResource {
  /** Primary owner (e.g. the hotel owner). */
  ownerId: string | { toString(): string };
  /** Additional users with delegated access (e.g. hotel staff). */
  memberIds?: ReadonlyArray<string | { toString(): string }>;
}

/**
 * Resource-level authorisation, deliberately separate from role membership.
 *
 * Holding `hotels:update` lets a HOTEL_OWNER update *their* hotels; it never grants access to
 * another owner's property. Only an explicit platform-wide override permission
 * (e.g. `hotels:moderate` for admins) bypasses ownership.
 */
export function canAccessResource(
  principal: Principal,
  resource: OwnedResource,
  options: { permission: Permission; overridePermission?: Permission },
): boolean {
  if (options.overridePermission && hasPermission(principal.roles, options.overridePermission))
    return true;
  if (!hasPermission(principal.roles, options.permission)) return false;
  const owner = resource.ownerId.toString();
  if (owner === principal.userId) return true;
  return (resource.memberIds ?? []).some((member) => member.toString() === principal.userId);
}

/**
 * Throws 404 rather than 403 when access is denied so that probing IDs does not reveal
 * whether a resource exists.
 */
export function assertCanAccessResource(
  principal: Principal,
  resource: OwnedResource | null | undefined,
  options: { permission: Permission; overridePermission?: Permission; resourceName?: string },
): asserts resource is OwnedResource {
  if (!resource || !canAccessResource(principal, resource, options)) {
    throw Errors.notFound(options.resourceName ?? 'Resource');
  }
}
