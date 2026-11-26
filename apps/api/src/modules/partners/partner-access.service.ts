import { setScope } from '@/lib/scope';
import { Types } from 'mongoose';
import { hasPermission, normalizeStaffPermissions, type StaffPermission } from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { AuthContext } from '@/types/express';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import {
  PartnerModel,
  PartnerStaffModel,
  type PartnerRecord,
  type PartnerStaffRecord,
} from './partner.model';

export interface HotelAccess {
  hotel: HotelRecord;
  partner: PartnerRecord;
  role: 'OWNER' | 'STAFF';
}

/**
 * Resource-level access to partner data. Role membership alone is never enough:
 *  - owners act only on hotels of *their* approved partner account;
 *  - staff act only on assigned hotels and only with the specific staff permission;
 *  - anything else is reported as 404 so IDs cannot be probed.
 */
export class PartnerAccessService {
  findOwnedPartner(userId: string): Promise<PartnerRecord | null> {
    return PartnerModel.findOne({ ownerId: userId }).lean<PartnerRecord>().exec();
  }

  /** Owner of an APPROVED partner with the hotels:update permission (granted on approval). */
  async requireApprovedOwner(auth: AuthContext): Promise<PartnerRecord> {
    const partner = await this.findOwnedPartner(auth.userId);
    if (!partner)
      throw new AppError(
        403,
        'FORBIDDEN',
        'Complete partner onboarding before managing properties.',
      );
    if (partner.verificationStatus !== 'APPROVED')
      throw new AppError(
        403,
        'FORBIDDEN',
        'Your partner account must be approved before managing properties.',
      );
    if (!hasPermission(auth.roles, 'hotels:update')) throw Errors.forbidden();
    setScope({ partnerId: partner._id.toString() });
    return partner;
  }

  private async staffRecords(userId: string): Promise<PartnerStaffRecord[]> {
    return PartnerStaffModel.find({ userId, invitationStatus: 'ACCEPTED' })
      .lean<PartnerStaffRecord[]>()
      .exec();
  }

  async resolveHotel(
    auth: AuthContext,
    hotelId: string,
    need: StaffPermission,
  ): Promise<HotelAccess> {
    if (!Types.ObjectId.isValid(hotelId)) throw Errors.notFound('Property');
    const hotel = await HotelModel.findById(hotelId).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    const partner = await PartnerModel.findById(hotel.partnerId).lean<PartnerRecord>();
    if (!partner || partner.verificationStatus !== 'APPROVED') throw Errors.notFound('Property');

    if (partner.ownerId.toString() === auth.userId && hasPermission(auth.roles, 'hotels:update')) {
      setScope({ partnerId: partner._id.toString(), hotelId: hotel._id.toString() });
      return { hotel, partner, role: 'OWNER' };
    }
    if (hasPermission(auth.roles, 'partner:access')) {
      const staff = (await this.staffRecords(auth.userId)).find((s) =>
        s.partnerId.equals(partner._id),
      );
      if (
        staff &&
        normalizeStaffPermissions(staff.permissions).includes(need) &&
        staff.assignedProperties.some((id) => id.equals(hotel._id))
      ) {
        setScope({ partnerId: partner._id.toString(), hotelId: hotel._id.toString() });
        return { hotel, partner, role: 'STAFF' };
      }
    }
    throw Errors.notFound('Property');
  }

  async requireOwnerOfHotel(auth: AuthContext, hotelId: string): Promise<HotelAccess> {
    const access = await this.resolveHotel(auth, hotelId, 'property:edit');
    if (access.role !== 'OWNER') throw Errors.forbidden('Only the property owner can do this.');
    return access;
  }

  /** Hotel ids this user may see in the partner workspace. */
  async accessibleHotelFilter(auth: AuthContext): Promise<Record<string, unknown> | null> {
    const partner = await this.findOwnedPartner(auth.userId);
    if (partner?.verificationStatus === 'APPROVED' && hasPermission(auth.roles, 'hotels:update'))
      return { partnerId: partner._id };
    if (!hasPermission(auth.roles, 'partner:access')) return null;
    const staff = await this.staffRecords(auth.userId);
    const ids = staff.flatMap((s) => s.assignedProperties);
    return ids.length ? { _id: { $in: ids } } : null;
  }
}
