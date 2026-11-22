import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import { zodErrorDetails } from './validate';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found.`));
};

function normalise(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return Errors.validation(zodErrorDetails(error));
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE')
      return Errors.tooLarge('The file is larger than the allowed size.');
    return Errors.badRequest('The upload is invalid.');
  }
  if (isMongoDuplicateKey(error))
    return Errors.conflict('CONFLICT', 'A record with these details already exists.');
  if (error instanceof mongoose.Error.CastError)
    return Errors.badRequest('A supplied identifier is invalid.');
  if (error instanceof mongoose.Error.ValidationError)
    return Errors.badRequest('The data could not be saved.');

  // body-parser errors expose `type` and `status`
  const candidate = error as { type?: string; status?: number };
  if (candidate?.type === 'entity.too.large') return Errors.tooLarge();
  if (candidate?.type === 'entity.parse.failed')
    return Errors.badRequest('The request body is not valid JSON.');
  if (candidate?.type === 'charset.unsupported' || candidate?.type === 'encoding.unsupported') {
    return Errors.unsupportedMedia('Unsupported request encoding.');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred. Please try again.');
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const appError = normalise(error);
    if (appError.statusCode >= 500) {
      // Full detail goes to logs only; the client receives a generic message.
      logger.error({ err: error, requestId: req.requestId, path: req.path }, 'Unhandled error');
    }
    if (appError.headers) res.set(appError.headers);
    const body: ApiErrorBody = {
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId: req.requestId,
      },
    };
    res.status(appError.statusCode).json(body);
  };
}
