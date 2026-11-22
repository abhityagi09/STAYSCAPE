import { Types, type ClientSession, type UpdateQuery } from 'mongoose';
import type { AccountStatus, ListUsersQuery, Role } from '@stayscape/shared';
import { UserModel, type UserAttrs, type UserRecord } from './user.model';

export interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | undefined;
  passwordHash: string;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class UserRepository {
  async create(data: CreateUserData, session?: ClientSession): Promise<UserRecord> {
    const [doc] = await UserModel.create(
      [{ ...data, phone: data.phone ?? null }],
      session ? { session } : {},
    );
    if (!doc) throw new Error('User creation failed');
    return doc.toObject() as UserRecord;
  }

  findById(id: string): Promise<UserRecord | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return UserModel.findById(id).lean<UserRecord>().exec();
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return UserModel.findOne({ email }).lean<UserRecord>().exec();
  }

  findByEmailWithPassword(email: string): Promise<UserRecord | null> {
    return UserModel.findOne({ email }).select('+passwordHash').lean<UserRecord>().exec();
  }

  findByIdWithPassword(id: string): Promise<UserRecord | null> {
    return UserModel.findById(id).select('+passwordHash').lean<UserRecord>().exec();
  }

  update(
    id: string,
    update: UpdateQuery<UserAttrs>,
    session?: ClientSession,
  ): Promise<UserRecord | null> {
    return UserModel.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
      ...(session ? { session } : {}),
    })
      .lean<UserRecord>()
      .exec();
  }

  async recordLogin(id: string): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { lastLoginAt: new Date() } }).exec();
  }

  async setPassword(id: string, passwordHash: string, session?: ClientSession): Promise<void> {
    await UserModel.updateOne(
      { _id: id },
      { $set: { passwordHash, passwordChangedAt: new Date() } },
      session ? { session } : {},
    ).exec();
  }

  /** Idempotent: only the first verification sets the timestamp. */
  async markEmailVerified(id: string, session?: ClientSession): Promise<void> {
    await UserModel.updateOne(
      { _id: id, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
      session ? { session } : {},
    ).exec();
  }

  setRoles(id: string, roles: Role[]): Promise<UserRecord | null> {
    return this.update(id, { $set: { roles } });
  }

  setStatus(
    id: string,
    accountStatus: AccountStatus,
    session?: ClientSession,
  ): Promise<UserRecord | null> {
    return this.update(id, { $set: { accountStatus } }, session);
  }

  async list(query: ListUsersQuery): Promise<{ items: UserRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (query.role) filter.roles = query.role;
    if (query.status) filter.accountStatus = query.status;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ email: pattern }, { firstName: pattern }, { lastName: pattern }];
    }
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<UserRecord[]>()
        .exec(),
      UserModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}
