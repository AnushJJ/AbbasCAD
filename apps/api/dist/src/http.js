"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.asyncRoute = asyncRoute;
exports.sendError = sendError;
class HttpError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.name = 'HttpError';
    }
}
exports.HttpError = HttpError;
function asyncRoute(handler) {
    return (request, response, next) => {
        Promise.resolve(handler(request, response, next)).catch(next);
    };
}
function sendError(error, _request, response, _next) {
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
