import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getCacheStats } from "./lib/cache.js";
import classifyRoutes from "./routes/classify.js";
import lookupRoutes from "./routes/lookup.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
	"*",
	cors({
		origin: (origin) => {
			// Allow Chrome extensions and localhost for development
			if (!origin) return "http://localhost:3000";
			if (origin.startsWith("chrome-extension://")) return origin;
			if (origin.includes("localhost")) return origin;
			// Allow configured origins
			const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
			if (allowedOrigins.includes(origin)) return origin;
			return "http://localhost:3000";
		},
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type"],
	}),
);

// Rate limiting state (simple in-memory, resets on restart)
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60 * 1000;

app.use("/api/*", async (c, next) => {
	const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";

	const now = Date.now();
	const record = requestCounts.get(ip);

	if (!record || record.resetAt < now) {
		requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
	} else {
		record.count++;
		if (record.count > RATE_LIMIT) {
			return c.json({ error: "Rate limit exceeded" }, 429);
		}
	}

	await next();
});

// Routes
app.route("/api/classify", classifyRoutes);
app.route("/api/lookup", lookupRoutes);

// Health check
app.get("/api/health", (c) => {
	const cacheStats = getCacheStats();
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		cache: cacheStats,
	});
});

// Root
app.get("/", (c) => {
	return c.json({
		name: "X Bot Detector API",
		version: "1.0.0",
		endpoints: {
			classify: "POST /api/classify",
			lookup: "GET /api/lookup/:username",
			health: "GET /api/health",
		},
	});
});

const port = Number(process.env.PORT) || 3000;
console.log(`Starting X Bot Detector API on port ${port}`);

export default {
	port,
	fetch: app.fetch,
};
