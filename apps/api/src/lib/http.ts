import type { Response } from 'express';
import type { ApiSuccess, Paginated, PaginationMeta } from '@stayscape/shared';

export function sendSuccess<T>(res: Response, data: T, status = 200): Response<ApiSuccess<T>> {
  return res.status(status).json({ success: true, data } satisfies ApiSuccess<T>);
}

export function sendMessage(res: Response, message: string, status = 200) {
  return sendSuccess(res, { message }, status);
}

export function buildPagination(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function paginated<T>(items: T[], page: number, limit: number, total: number): Paginated<T> {
  return { items, pagination: buildPagination(page, limit, total) };
}
