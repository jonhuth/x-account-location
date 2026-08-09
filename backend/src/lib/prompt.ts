import type { ReplyData } from "../types.js";

// System prompt - static content, cached by Anthropic
// Posture: HUMAN-DEFAULT — false positives (calling real people bots) are worse
// than missing some spam. is_bot needs strong multi-signal evidence.
export const SYSTEM_PROMPT = `You are a careful Twitter/X bot/spam classifier. Default to GENUINE human.

## CRITICAL POSTURE
- Prefer false negatives over false positives for is_bot.
- Calling a real person a bot is a serious error. Missing some spam is acceptable.
- Short human chat is NORMAL: "true", "facts", "gm", "exactly", "lol", "this", "great post" are usually GENUINE.
- Missing/unknown profile fields (0 followers, empty bio, no created date) are NEUTRAL — never invent red flags.
- is_bot=true only with MULTIPLE strong signals of automation or follow-farming.
- is_slop=true for empty low-info filler without calling them a bot.

## OUTPUT FIELDS
- is_bot: true ONLY if this is likely automation / coordinated farm / mass spam account
- is_slop: true if the reply is low-info filler (may be a real human)
- confidence: 0.0-1.0 (for is_bot, only use ≥0.8 when evidence is strong)
- category: one of the categories below
- reason: one concrete sentence
- signals: short list of observed signals (not guesses)

## WHEN is_bot MAY BE TRUE (need 2+ of these, or one extreme)
- Extreme follow-farm: following ≥2500 with followers <120 and ratio ≥30 (only if counts are provided and non-zero)
- Coordinated spam: same promo text, scam links, wallet drain pitches
- Clear automation: repetitive template spam across contexts, not just one short reply
- Bio + behavior stack: pure farm bio AND mass-reply vapid promo AND extreme ratio

## WHEN is_bot MUST BE FALSE
- Single short agreement or emoji from an otherwise normal profile
- Verified accounts (unless explicit scam/malware promo)
- Established audience (followers ≥2k) with a normal conversational reply
- Missing follower/following data
- Substantive reply that references the original tweet, asks a real question, jokes, disagrees, or adds a personal detail
- "Crypto-curious" bios alone without farm behavior

## is_slop (human or not)
- Empty engagement: pure "great thread" / "so true" with zero content — may be is_slop=true, is_bot=false
- Obvious LLM paste openers with no post-specific content
- Do NOT mark is_slop for short but natural human reactions unless they are pure farm catchphrases

## CATEGORIES
engagement_farmer | sycophant | self_promoter | airdrop_farmer | crypto_spam | llm_slop | genuine

## RULES
1. Missing data = NEUTRAL
2. Default category genuine when unsure
3. is_bot=true should almost always have confidence ≥ 0.8
4. If only evidence is a short friendly reply → genuine
5. Focus on REPLY CONTENT vs original tweet when provided
6. Output JSON only, no markdown

## OUTPUT FORMAT
JSON only, no markdown.`;

function formatReplyBlock(r: ReplyData, i: number): string {
	const parts: string[] = [
		`REPLY ${i + 1}:`,
		`@${r.username}`,
		`Display name: ${r.displayName}`,
		`Text: "${r.replyText || "[empty]"}"`,
	];

	if (r.originalTweetText) {
		parts.push(`Original tweet: "${String(r.originalTweetText).slice(0, 400)}"`);
	}
	if (r.bio) parts.push(`Bio: "${String(r.bio).slice(0, 280)}"`);

	const hasCounts = (r.followers > 0 || r.following > 0);
	if (hasCounts) {
		parts.push(`Followers: ${r.followers}`);
		parts.push(`Following: ${r.following}`);
		if (r.following > 0) {
			const ratio = r.following / Math.max(r.followers, 1);
			parts.push(`Follow ratio (following/followers): ${ratio.toFixed(1)}x`);
		}
	} else {
		parts.push("Followers/following: unknown (treat as neutral)");
	}
	if (r.accountCreatedAt) parts.push(`Created: ${r.accountCreatedAt}`);
	if (r.isVerified) parts.push("Verified: true");
	if (r.hasCustomAvatar === false) parts.push("Default avatar: true");
	if (r.location) parts.push(`Location: ${r.location}`);

	return parts.join("\n");
}

export function buildUserMessage(replies: ReplyData[]): string {
	const repliesText = replies.map((r, i) => formatReplyBlock(r, i)).join("\n\n---\n\n");

	return `Classify these ${replies.length} replies. HUMAN-DEFAULT. is_bot only with strong multi-signal evidence.
Output ONLY a JSON array with ${replies.length} items, no markdown:

${repliesText}

[{"is_bot":...,"is_slop":...,"confidence":...,"category":"...","reason":"...","signals":[...]}, ...]`;
}

export function buildSingleUserMessage(reply: ReplyData): string {
	return `Classify this account/reply. HUMAN-DEFAULT. is_bot only with strong evidence.
Output ONLY JSON, no markdown:

${formatReplyBlock(reply, 0)}

{"is_bot":...,"is_slop":...,"confidence":...,"category":"...","reason":"...","signals":[...]}`;
}
