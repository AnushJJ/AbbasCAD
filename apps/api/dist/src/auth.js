"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cookieParser = exports.authCookieName = void 0;
exports.passwordHash = passwordHash;
exports.verifyPassword = verifyPassword;
exports.issueToken = issueToken;
exports.setAuthCookie = setAuthCookie;
exports.clearAuthCookie = clearAuthCookie;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
exports.cookieParser = cookie_parser_1.default;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const http_1 = require("./http");
const db_1 = require("./db");
exports.authCookieName = 'smartbusToken';
function passwordHash(password) {
    return bcryptjs_1.default.hash(password, 12);
}
function verifyPassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
function secret() {
    const value = process.env.JWT_SECRET;
    if (!value || Buffer.byteLength(value) < 32) {
        throw new http_1.HttpError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured on this server');
    }
    return value;
}
function issueToken(user) {
    return jsonwebtoken_1.default.sign({ role: user.role }, secret(), { subject: user.id, expiresIn: '7d' });
}
function setAuthCookie(response, token) {
    response.cookie(exports.authCookieName, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
}
function clearAuthCookie(response) {
    response.clearCookie(exports.authCookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api',
    });
}
function requireAuth(request, _response, next) {
    try {
        const req = request;
        const token = req.cookies?.[exports.authCookieName] ??
            (req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]);
        if (!token)
            throw new http_1.HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
        const decoded = jsonwebtoken_1.default.verify(token, secret());
        if (typeof decoded.sub !== 'string' || !Object.values(client_1.Role).includes(decoded.role)) {
            throw new http_1.HttpError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired');
        }
        req.authUser = { id: decoded.sub, role: decoded.role };
        next();
    }
    catch (error) {
        next(error instanceof http_1.HttpError ? error : new http_1.HttpError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired'));
    }
}
function requireAdmin(request, response, next) {
    const user = request.authUser;
    if (!user) {
        response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required' } });
        return;
    }
    void db_1.prisma.user.findUnique({ where: { id: user.id }, select: { role: true } })
        .then((record) => {
        if (record?.role !== client_1.Role.ADMIN) {
            response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required' } });
            return;
        }
        user.role = client_1.Role.ADMIN;
        next();
    })
        .catch(next);
}
