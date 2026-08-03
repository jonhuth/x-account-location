import { Hono } from "hono";
import { classifySingleReply } from "../lib/anthropic.js";
import { getCachedVerdict, setCachedVerdict } from "../lib/cache.js";
import { localClassifyReply } from "../lib/localFilter.js";
import type { LookupResponse, ReplyData } from "../types.js";

const app = new Hono();

// Bot-or-Not style lookup by username
app.get("/:username", async (c) => {
	const username = c.req.param("username").replace(/^@/, "").toLowerCase();

	if (!username || username.length < 1 || username.length > 15) {
		return c.json({ error: "Invalid username" }, 400);
	}

	const replyText = c.req.query("replyText") ?? "";
	const cacheKey = replyText ? `${username}:${simpleHash(replyText.slice(0, 64))}` : username;

	const cached = getCachedVerdict(cacheKey) || getCachedVerdict(username);
	if (cached) {
		return c.json<LookupResponse>({
			username,
			verdict: cached,
			cached: true,
		});
	}

	const bio = c.req.query("bio") ?? "";
	const displayName = c.req.query("displayName") ?? username;
	const followers = Number(c.req.query("followers")) || 0;
	const following = Number(c.req.query("following")) || 0;
	const isVerified = c.req.query("verified") === "true";
	const createdAt = c.req.query("createdAt");
	const hasAvatar = c.req.query("hasAvatar");
	const heuristicScore = c.req.query("heuristicScore");

	const replyData: ReplyData = {
		username,
		displayName,
		replyText,
		originalTweetText: c.req.query("originalTweetText") ?? "",
		bio,
		followers,
		following,
		accountCreatedAt: createdAt ?? "",
		hasCustomAvatar: hasAvatar !== "false",
		isVerified,
		location: c.req.query("location") ?? null,
		secondsAfterOriginal: 0,
		heuristicScore: heuristicScore ? Number(heuristicScore) : 0,
		userFollows: false,
		mutualCount: 0,
	};

	const local = localClassifyReply(replyData);
	if (local) {
		setCachedVerdict(cacheKey, local);
		return c.json<LookupResponse>({
			username,
			verdict: local,
			cached: false,
		});
	}

	const verdict = await classifySingleReply(replyData);

	if (verdict) {
		setCachedVerdict(cacheKey, verdict);
	}

	return c.json<LookupResponse>({
		username,
		verdict,
		cached: false,
	});
});

function simpleHash(text: string): string {
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(16);
}

export default app;
