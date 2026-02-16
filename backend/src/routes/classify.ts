import { Hono } from "hono";
import { classifyBatchReplies } from "../lib/anthropic.js";
import { getCachedVerdict, setCachedVerdict } from "../lib/cache.js";
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

		// Check cache for each reply
		const results: { index: number; verdict: BotVerdict | null }[] = [];
		const uncached: { index: number; reply: ReplyData }[] = [];

		for (let i = 0; i < replies.length; i++) {
			const reply = replies[i];
			const cached = getCachedVerdict(reply.username);

			if (cached) {
				results.push({ index: i, verdict: cached });
			} else {
				uncached.push({ index: i, reply });
			}
		}

		// Process uncached replies with AI
		if (uncached.length > 0) {
			const uncachedReplies = uncached.map((u) => u.reply);
			const aiVerdicts = await classifyBatchReplies(uncachedReplies);

			uncached.forEach((item, i) => {
				const verdict = aiVerdicts[i];
				if (verdict) {
					setCachedVerdict(item.reply.username, verdict);
				}
				results.push({ index: item.index, verdict: verdict ?? createFallbackVerdict() });
			});
		}

		// Sort by original index and extract verdicts
		results.sort((a, b) => a.index - b.index);
		const verdicts = results.map((r) => r.verdict!);

		return c.json<ClassifyResponse>({ verdicts });
	} catch (error) {
		console.error("Classify error:", error);
		return c.json({ error: "Internal server error" }, 500);
	}
});

function createFallbackVerdict(): BotVerdict {
	return {
		isBot: false,
		confidence: 0,
		category: "genuine",
		reason: "Classification failed, defaulting to genuine",
		signals: [],
		source: "ai",
	};
}

export default app;
