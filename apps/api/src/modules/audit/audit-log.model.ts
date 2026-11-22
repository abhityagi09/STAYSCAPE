import { Schema, model, type Types } from 'mongoose';

export interface AuditLogAttrs {
  actorId: Types.ObjectId | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  requestId: string | null;
  timestamp: Date;
}

export type AuditLogRecord = AuditLogAttrs & { _id: Types.ObjectId };

const auditLogSchema = new Schema<AuditLogAttrs>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, maxlength: 100 },
    entityType: { type: String, required: true, maxlength: 60 },
    entityId: { type: String, default: null, maxlength: 64 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: null, maxlength: 64 },
    requestId: { type: String, default: null, maxlength: 64 },
    timestamp: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false, minimize: false },
);

auditLogSchema.index({ timestamp: -1 }, { name: 'timestamp' });
auditLogSchema.index({ actorId: 1, timestamp: -1 }, { name: 'actor_timestamp' });
auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 }, { name: 'entity_timestamp' });
auditLogSchema.index({ action: 1, timestamp: -1 }, { name: 'action_timestamp' });

export const AuditLogModel = model<AuditLogAttrs>('AuditLog', auditLogSchema);
