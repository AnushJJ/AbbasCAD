"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthRouter = createAuthRouter;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const auth_1 = require("../auth");
const http_1 = require("../http");
const registerSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
    email: zod_1.z.string().trim().email().max(254),
    name: zod_1.z.string().trim().min(2).max(100),
    phone: zod_1.z.string().trim().max(30).optional().or(zod_1.z.literal('')),
    password: zod_1.z.string().min(10).max(128),
}).strict();
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email().max(254),
    password: zod_1.z.string().min(1).max(128),
}).strict();
const profileSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(100).optional(),
    phone: zod_1.z.string().trim().max(30).optional().or(zod_1.z.literal('')),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field');
function publicUser(user) {
    return { id: user.id, username: user.username, email: user.email, name: user.name, phone: user.phone, role: user.role, createdAt: user.createdAt };
}
function createAuthRouter(database) {
    const router = (0, express_1.Router)();
    const authLimiter = (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
    router.post('/register', authLimiter, (0, http_1.asyncRoute)(async (request, response) => {
        const parsed = registerSchema.safeParse(request.body);
        if (!parsed.success)
            throw new http_1.HttpError(400, 'VALIDATION_ERROR', 'Registration details are invalid', parsed.error.issues.map(({ path, message }) => ({ path, message })));
        const data = parsed.data;
        const user = await database.user.create({
            data: {
                username: data.username,
                email: data.email.toLowerCase(),
                name: data.name,
                phone: data.phone || null,
                passwordHash: await (0, auth_1.passwordHash)(data.password),
                loyalty: { create: {} },
            },
        });
        (0, auth_1.setAuthCookie)(response, (0, auth_1.issueToken)({ id: user.id, role: user.role }));
        response.status(201).json({ user: publicUser(user) });
    }));
    router.post('/login', authLimiter, (0, http_1.asyncRoute)(async (request, response) => {
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success)
            throw new http_1.HttpError(400, 'VALIDATION_ERROR', 'Email or password is invalid');
        const user = await database.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user || !(await (0, auth_1.verifyPassword)(parsed.data.password, user.passwordHash))) {
            throw new http_1.HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
        }
        (0, auth_1.setAuthCookie)(response, (0, auth_1.issueToken)({ id: user.id, role: user.role }));
        response.json({ user: publicUser(user) });
    }));
    router.post('/logout', (_request, response) => {
        (0, auth_1.clearAuthCookie)(response);
        response.status(204).end();
    });
    router.get('/me', auth_1.requireAuth, (0, http_1.asyncRoute)(async (request, response) => {
        const user = request.authUser;
        const profile = await database.user.findUnique({
            where: { id: user.id },
            include: { loyalty: true },
        });
        if (!profile)
            throw new http_1.HttpError(401, 'UNAUTHENTICATED', 'Your account is unavailable');
        response.json({ user: publicUser(profile), loyalty: profile.loyalty });
    }));
    router.patch('/profile', auth_1.requireAuth, (0, http_1.asyncRoute)(async (request, response) => {
        const parsed = profileSchema.safeParse(request.body);
        if (!parsed.success)
            throw new http_1.HttpError(400, 'VALIDATION_ERROR', 'Profile details are invalid', parsed.error.issues);
        const user = request.authUser;
        const updated = await database.user.update({
            where: { id: user.id },
            data: {
                ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
                ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
            },
        });
        response.json({ user: publicUser(updated) });
    }));
    return router;
}
