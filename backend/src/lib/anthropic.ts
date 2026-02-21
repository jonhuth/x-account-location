import Anthropic from "@anthropic-ai/sdk";
import type { BotVerdict, ReplyData, SpamCategory } from "../types.js";
import { SYSTEM_PROMPT, buildSingleUserMessage, buildUserMessage } from "./prompt.js";

const anthropic = new Anthropic();

interface AIResponse {
	is_bot: boolean;
	confidence: number;
	category: SpamCategory;
	reason: string;
	signals: string[];
}

function parseAIResponse(text: string): AIResponse | null {
	try {
		const cleaned = text
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		return {
			is_bot: Boolean(parsed.is_bot),
			confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
			category: validateCategory(parsed.category),
			reason: String(parsed.reason || "Unknown"),
			signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 5) : [],
		};
	} catch {
		console.error("Failed to parse AI response:", text.substring(0, 200));
		return null;
	}
}

function parseBatchAIResponse(text: string, expectedCount: number): AIResponse[] {
	try {
		const cleaned = text
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		const parsed = JSON.parse(cleaned);

		if (!Array.isArray(parsed)) {
			// Try to wrap single object response
			if (expectedCount === 1 && typeof parsed === "object") {
				return [
					{
						is_bot: Boolean(parsed.is_bot),
						confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
						category: validateCategory(parsed.category),
						reason: String(parsed.reason || "Unknown"),
						signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 5) : [],
					},
				];
			}
			console.error("Batch response is not an array");
			return [];
		}

		return parsed.map((item) => ({
			is_bot: Boolean(item.is_bot),
			confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
			category: validateCategory(item.category),
			reason: String(item.reason || "Unknown"),
			signals: Array.isArray(item.signals) ? item.signals.slice(0, 5) : [],
		}));
	} catch {
		console.error("Failed to parse batch AI response:", text.substring(0, 200));
		return [];
	}
}

function validateCategory(cat: unknown): SpamCategory {
	const valid: SpamCategory[] = [
		"engagement_farmer",
		"sycophant",
		"self_promoter",
		"airdrop_farmer",
		"crypto_spam",
		"genuine",
	];
	if (typeof cat === "string" && valid.includes(cat as SpamCategory)) {
		return cat as SpamCategory;
	}
	return "crypto_spam";
}

export async function classifySingleReply(reply: ReplyData): Promise<BotVerdict | null> {
	try {
		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 256,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildSingleUserMessage(reply) }],
		});

		const content = message.content[0];
		if (content.type !== "text") return null;

		const parsed = parseAIResponse(content.text);
		if (!parsed) return null;

		return {
			isBot: parsed.is_bot,
			confidence: parsed.confidence,
			category: parsed.category,
			reason: parsed.reason,
			signals: parsed.signals,
			source: "ai",
		};
	} catch (error) {
		console.error("Anthropic API error:", error);
		return null;
	}
}

export async function classifyBatchReplies(replies: ReplyData[]): Promise<(BotVerdict | null)[]> {
	if (replies.length === 0) return [];
	if (replies.length === 1) {
		const result = await classifySingleReply(replies[0]);
		return [result];
	}

	try {
		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 512,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildUserMessage(replies) }],
		});

		const content = message.content[0];
		if (content.type !== "text") {
			return replies.map(() => null);
		}

		const parsed = parseBatchAIResponse(content.text, replies.length);

		const results: (BotVerdict | null)[] = [];
		for (let i = 0; i < replies.length; i++) {
			if (parsed[i]) {
				results.push({
					isBot: parsed[i].is_bot,
					confidence: parsed[i].confidence,
					category: parsed[i].category,
					reason: parsed[i].reason,
					signals: parsed[i].signals,
					source: "ai",
				});
			} else {
				results.push(null);
			}
		}

		return results;
	} catch (error) {
		console.error("Anthropic API batch error:", error);
		return replies.map(() => null);
	}
}
