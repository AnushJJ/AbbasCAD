import { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function sendError(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2002') {
      response.status(409).json({ error: { code: 'CONFLICT', message: 'That value is already in use' } });
      return;
    }
    if (error.code === 'P2025') {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found' } });
      return;
    }
    if (error.code === 'P2003' || error.code === 'P2014') {
      response.status(409).json({ error: { code: 'RECORD_IN_USE', message: 'This record is referenced by existing data' } });
      return;
    }
  }
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON' } });
    return;
  }
  console.error('Unhandled SmartBus API error');
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } });
}
