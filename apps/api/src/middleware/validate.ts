import type { RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import type { ApiErrorDetails } from '@stayscape/shared';
import { Errors } from '@/lib/errors';

export function zodErrorDetails(error: ZodError): ApiErrorDetails {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) (fieldErrors[key] ??= []).push('This field is not allowed');
      continue;
    }
    const path = issue.path.map(String).join('.');
    if (!path) formErrors.push(issue.message);
    else (fieldErrors[path] ??= []).push(issue.message);
  }
  return { fieldErrors, formErrors };
}

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and normalises untrusted input. Parsed values replace `req.body`; query and
 * params (read-only in Express 5) are exposed as `req.validatedQuery` / `req.validatedParams`.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success)
        return next(
          Errors.validation(zodErrorDetails(result.error), 'The URL parameters are invalid.'),
        );
      req.validatedParams = result.data;
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success)
        return next(
          Errors.validation(zodErrorDetails(result.error), 'The query parameters are invalid.'),
        );
      req.validatedQuery = result.data;
    }
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body ?? {});
      if (!result.success) return next(Errors.validation(zodErrorDetails(result.error)));
      req.body = result.data;
    }
    next();
  };
}

/**
 * Validate a PATCH body and keep only the top-level fields the client actually sent.
 * (Zod applies inner `.default()`s even under `.partial()`, which would otherwise silently
 * reset omitted fields such as photo lists to their defaults.)
 */
export function validatePatch(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const present = new Set(Object.keys(raw));
    const result = schema.safeParse(raw);
    if (!result.success) return next(Errors.validation(zodErrorDetails(result.error)));
    req.body = Object.fromEntries(
      Object.entries(result.data as Record<string, unknown>).filter(([key]) => present.has(key)),
    );
    next();
  };
}
