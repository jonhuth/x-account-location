import { Hono } from "hono";
import { classifyBatchReplies } from "../lib/anthropic.js";
import { getCachedVerdict, setCachedVerdict } from "../lib/cache.js";
import { localClassifyReply } from "../lib/localFilter.js";
import type { BotVerdict, ClassifyRequest, ClassifyResponse, ReplyData } from "../types.js";

const app = new Hono();

app.post("/", async (c) => {
	try {
		const body = await c.req.json<ClassifyRequest>();
		const { replies } = body;

		if (!replies || !Array.isArray(replies) || replies.length === 0) {
			return c.json({ error: "replies array is required" }, 400);
		}

		if (replies.length > 5) {
			return c.json({ error: "Maximum 5 replies per batch" }, 400);
		}

		const results: { index: number; verdict: BotVerdict | null }[] = [];
		const needAi: { index: number; reply: ReplyData }[] = [];

		for (let i = 0; i < replies.length; i++) {
			const reply = normalizeReply(replies[i]);

			// 1) Server local template filter (free)
			const local = localClassifyReply(reply);
			if (local) {
				setCachedVerdict(cacheKey(reply), local);
				results.push({ index: i, verdict: local });
				continue;
			}

			// 2) LRU cache (shared, non-personalized) — skip unusable placeholders
			const cached = getCachedVerdict(cacheKey(reply));
			if (cached && cached.source !== "fallback" && Number(cached.confidence) > 0) {
				results.push({ index: i, verdict: cached });
				continue;
			}

			needAi.push({ index: i, reply });
		}

		// 3) AI for the rest
		if (needAi.length > 0) {
			const aiVerdicts = await classifyBatchReplies(needAi.map((u) => u.reply));

			needAi.forEach((item, i) => {
				const verdict = aiVerdicts[i];
				// Never put fallback zeros into the shared LRU
				if (verdict && Number(verdict.confidence) > 0) {
					setCachedVerdict(cacheKey(item.reply), verdict);
				}
				results.push({
					index: item.index,
					verdict: verdict ?? createFallbackVerdict(),
				});
			});
		}

		results.sort((a, b) => a.index - b.index);
		const verdicts = results.map((r) => r.verdict!);

		return c.json<ClassifyResponse>({ verdicts });
	} catch (error) {
		console.error("Classify error:", error);
		return c.json({ error: "Internal server error" }, 500);
	}
});

/** Include short content hash so different replies from same user aren't fully collapsed */
function cacheKey(reply: ReplyData): string {
	const user = String(reply.username || "").toLowerCase();
	const text = String(reply.replyText || "")
		.slice(0, 64)
		.toLowerCase();
	let h = 0;
	for (let i = 0; i < text.length; i++) {
		h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
	}
	return `${user}:${(h >>> 0).toString(16)}`;
}

function normalizeReply(r: Partial<ReplyData>): ReplyData {
	return {
		username: String(r.username || "").toLowerCase(),
		displayName: String(r.displayName || r.username || ""),
		replyText: String(r.replyText || ""),
		originalTweetText: String(r.originalTweetText || ""),
		bio: String(r.bio || ""),
		followers: Number(r.followers) || 0,
		following: Number(r.following) || 0,
		accountCreatedAt: String(r.accountCreatedAt || ""),
		hasCustomAvatar: r.hasCustomAvatar ?? true,
		isVerified: Boolean(r.isVerified),
		location: r.location ?? null,
		secondsAfterOriginal: Number(r.secondsAfterOriginal) || 0,
		heuristicScore: Number(r.heuristicScore) || 0,
		userFollows: false,
		mutualCount: 0,
	};
}

function createFallbackVerdict(): BotVerdict {
	// Must NOT look like a real human score of 0 — clients treat source=fallback as unknown
	return {
		isBot: false,
		isSlop: false,
		confidence: 0,
		category: "genuine",
		reason: "Classification failed — score unavailable",
		signals: [],
		source: "fallback",
	};
}

export default app;
