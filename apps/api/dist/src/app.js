"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.createApp = createApp;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const db_1 = require("./db");
const search_1 = require("./routes/search");
const auth_1 = require("./routes/auth");
const bookings_1 = require("./routes/bookings");
const admin_1 = require("./routes/admin");
const http_1 = require("./http");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
function createApp(database = db_1.prisma) {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    const configuredOrigin = process.env.WEB_ORIGIN;
    const allowedOrigins = new Set([
        configuredOrigin,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ].filter((origin) => Boolean(origin)));
    app.use((0, cors_1.default)({ credentials: true, origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
    app.use(express_1.default.json({ limit: '100kb' }));
    app.use((0, cookie_parser_1.default)());
    app.get('/api/health', (_request, response) => {
        response.status(200).json({ status: 'ok', service: 'smartbus-api' });
    });
    app.use('/api', (0, search_1.createSearchRouter)(database));
    const fullDatabase = database;
    app.use('/api/auth', (0, auth_1.createAuthRouter)(fullDatabase));
    app.use('/api', (0, bookings_1.createBookingRouter)(fullDatabase));
    app.use('/api/admin', (0, admin_1.createAdminRouter)(fullDatabase));
    app.use((_request, response) => {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
    });
    app.use(http_1.sendError);
    return app;
}
exports.app = createApp();
