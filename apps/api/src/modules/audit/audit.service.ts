import { requestScope } from '@/lib/scope';
import { Types } from 'mongoose';
import type { AuditLogDto, ListAuditQuery, Paginated } from '@stayscape/shared';
import type { Logger } from '@/lib/logger';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditLogRecord } from './audit-log.model';
import type { AuditRepository } from './audit.repository';

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|otp|cvv|card|pan|api[-_]?key/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;

/** Remove secrets and bound the size of audit metadata. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeMetadata(inner, depth + 1);
  }
  return out;
}

const toId = (v: string | null | undefined) =>
  v && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to the partner resolved for the current request (see lib/scope). */
  partnerId?: string | null;
  hotelId?: string | null;
  context?: Pick<RequestContext, 'ipAddress' | 'requestId'>;
}

export function toAuditLogDto(record: AuditLogRecord): AuditLogDto {
  return {
    id: record._id.toString(),
    actorId: record.actorId ? record.actorId.toString() : null,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    metadata: record.metadata ?? {},
    ipAddress: record.ipAddress,
    requestId: record.requestId,
    timestamp: record.timestamp.toISOString(),
  };
}

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Record an audit event. Failures are logged rather than thrown so an audit-store outage
   * cannot block a user action that has already been committed.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.repository.insert({
        actorId:
          entry.actorId && Types.ObjectId.isValid(entry.actorId)
            ? new Types.ObjectId(entry.actorId)
            : null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (sanitizeMetadata(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
        partnerId: toId(entry.partnerId ?? requestScope.getStore()?.partnerId),
        hotelId: toId(entry.hotelId ?? requestScope.getStore()?.hotelId),
        ipAddress: entry.context?.ipAddress ?? null,
        requestId: entry.context?.requestId ?? null,
      });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write audit log');
    }
  }

  async list(query: ListAuditQuery): Promise<Paginated<AuditLogDto>> {
    const { items, total } = await this.repository.list(query);
    return paginated(items.map(toAuditLogDto), query.page, query.limit, total);
  }
}
