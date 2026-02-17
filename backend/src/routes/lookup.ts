import { Hono } from "hono";
import { classifySingleReply } from "../lib/anthropic.js";
import { getCachedVerdict, setCachedVerdict } from "../lib/cache.js";
import type { LookupResponse, ReplyData } from "../types.js";

const app = new Hono();

// Bot-or-Not style lookup by username
app.get("/:username", async (c) => {
	const username = c.req.param("username").replace(/^@/, "").toLowerCase();

	if (!username || username.length < 1 || username.length > 15) {
		return c.json({ error: "Invalid username" }, 400);
	}

	// Check cache first
	const cached = getCachedVerdict(username);
	if (cached) {
		return c.json<LookupResponse>({
			username,
			verdict: cached,
			cached: true,
		});
	}

	// For lookup, we need minimal data - create a minimal ReplyData
	// The caller can optionally provide more context via query params
	const bio = c.req.query("bio") ?? "";
	const displayName = c.req.query("displayName") ?? username;
	const followers = Number(c.req.query("followers")) || 0;
	const following = Number(c.req.query("following")) || 0;
	const isVerified = c.req.query("verified") === "true";

	// Use null/unknown for missing data instead of fake defaults
	// AI should treat missing data as neutral, not suspicious
	const createdAt = c.req.query("createdAt");
	const hasAvatar = c.req.query("hasAvatar");
	const heuristicScore = c.req.query("heuristicScore");

	const replyData: ReplyData = {
		username,
		displayName,
		replyText: c.req.query("replyText") ?? "",
		originalTweetText: "",
		bio,
		followers,
		following,
		accountCreatedAt: createdAt ?? "", // Empty = unknown, not "just created"
		hasCustomAvatar: hasAvatar !== "false", // Assume avatar exists if unknown or true
		isVerified,
		location: c.req.query("location") ?? null,
		secondsAfterOriginal: 0,
		heuristicScore: heuristicScore ? Number(heuristicScore) : 0, // 0 = no heuristic data
		userFollows: c.req.query("userFollows") === "true",
		mutualCount: Number(c.req.query("mutualCount")) || 0,
	};

	const verdict = await classifySingleReply(replyData);

	if (verdict) {
		setCachedVerdict(username, verdict);
	}

	return c.json<LookupResponse>({
		username,
		verdict,
		cached: false,
	});
});

export default app;
