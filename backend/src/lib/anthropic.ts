import Anthropic from "@anthropic-ai/sdk";
import type { BotVerdict, ReplyData, SpamCategory } from "../types.js";
import { buildBatchPrompt, buildClassificationPrompt } from "./prompt.js";

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
		// Remove any markdown code blocks if present
		const cleaned = text
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		return {
			is_bot: Boolean(parsed.is_bot),
			confidence: Number(parsed.confidence) || 0.5,
			category: parsed.category || "crypto_spam",
			reason: String(parsed.reason || "Unknown"),
			signals: Array.isArray(parsed.signals) ? parsed.signals : [],
		};
	} catch {
		console.error("Failed to parse AI response:", text);
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
			console.error("Batch response is not an array");
			return [];
		}

		return parsed.map((item) => ({
			is_bot: Boolean(item.is_bot),
			confidence: Number(item.confidence) || 0.5,
			category: item.category || "crypto_spam",
			reason: String(item.reason || "Unknown"),
			signals: Array.isArray(item.signals) ? item.signals : [],
		}));
	} catch {
		console.error("Failed to parse batch AI response:", text);
		return [];
	}
}

export async function classifySingleReply(reply: ReplyData): Promise<BotVerdict | null> {
	try {
		const prompt = buildClassificationPrompt(reply);

		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 512,
			messages: [{ role: "user", content: prompt }],
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
		const prompt = buildBatchPrompt(replies);

		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 1024,
			messages: [{ role: "user", content: prompt }],
		});

		const content = message.content[0];
		if (content.type !== "text") {
			return replies.map(() => null);
		}

		const parsed = parseBatchAIResponse(content.text, replies.length);

		// Pad with nulls if response is incomplete
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
