import { Types } from 'mongoose';
import type { ListAuditQuery } from '@stayscape/shared';
import { AuditLogModel, type AuditLogAttrs, type AuditLogRecord } from './audit-log.model';

export class AuditRepository {
  async insert(entry: Omit<AuditLogAttrs, 'timestamp'> & { timestamp?: Date }): Promise<void> {
    await AuditLogModel.create(entry);
  }

  async list(query: ListAuditQuery): Promise<{ items: AuditLogRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ timestamp: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<AuditLogRecord[]>()
        .exec(),
      AuditLogModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}
