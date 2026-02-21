import type { ReplyData } from "../types.js";

// System prompt - static content, cached by Anthropic
export const SYSTEM_PROMPT = `You are a Twitter/X spam detector specialized in crypto Twitter. Your job is to classify replies as genuine or spam.

## SPAM CATEGORIES

### ENGAGEMENT_FARMER
- Replies to build Kaito score or similar metrics
- Generic agreement designed to get likes, not add value
- Bio mentions "yapper", engagement stats, "building presence"
- Mass-replies to popular accounts

### SYCOPHANT
- "Great thread!", "So true!", "Bullish!", "This is the way"
- Restates the tweet without adding insight
- Never disagrees, never asks substantive questions
- "More people need to see this" without explaining why

### SELF_PROMOTER
- Pivots every reply to their project/product
- "This is why we're building X", "We solved this at [project]"
- Bio has "DM for collabs" or agency signals

### AIRDROP_FARMER
- Generic supportive comments on protocol accounts
- Bio mentions multiple ecosystems being "explored"
- Following >> Followers (farming pattern)
- New account, high activity

### CRYPTO_SPAM
Bio/name signals:
- Buzzword soup: "web3 explorer", "defi degen", "crypto native", "onchain curious"
- Multiple chain emojis (◎ ⟠ 🔵)
- ".eth" or ".sol" in name without substance
- "Future millionaire", "generational wealth"
- Kaito/engagement metrics in bio

Vapid reply patterns:
- "Saving this", "Underrated thread", "The alpha here is crazy"
- "Few understand this", "This is the one"
- Single words: "Facts", "Real", "Valid", "Based", "W"

## GENUINE SIGNALS (reduce spam score)
- Specific references to content in original tweet
- Personal anecdotes or experiences
- Disagreement or nuanced critique
- Questions showing they read the tweet
- Humor, sarcasm, personality
- Typos with substantive content
- Reply that couldn't be copy-pasted elsewhere

## LEGITIMACY SIGNALS (strong evidence against bot)
- User follows this account → VERY strong signal, almost never flag
- High mutual follows (5+) → Strong social proof
- Verified account → Some friction (paid), reduces bot likelihood
- Substantive reply (>100 chars with specific content)

## RULES
1. If user_follows=true, need OVERWHELMING evidence to flag
2. Missing/unknown data = NEUTRAL (don't penalize)
3. In crypto Twitter, bar for "spam" is LOWER - even real humans engagement farming should be flagged
4. Default to flagging: false positives (hiding vapid reply) < false negatives (letting spam through)
5. Focus on REPLY CONTENT and DISPLAY NAME - these are most reliable signals

## OUTPUT FORMAT
For each reply, output JSON with:
- is_bot: boolean
- confidence: 0.0-1.0 (how sure you are)
- category: "engagement_farmer"|"sycophant"|"self_promoter"|"airdrop_farmer"|"crypto_spam"|"genuine"
- reason: One sentence explanation
- signals: Array of specific signals detected`;

// Build user message with reply data
export function buildUserMessage(replies: ReplyData[]): string {
	const repliesText = replies
		.map((r, i) => {
			const parts: string[] = [
				`REPLY ${i + 1}:`,
				`@${r.username}`,
				`Display name: ${r.displayName}`,
				`Text: "${r.replyText || "[empty]"}"`,
			];

			// Add optional data if available (not empty/zero/unknown)
			if (r.bio) parts.push(`Bio: "${r.bio}"`);
			if (r.followers > 0) parts.push(`Followers: ${r.followers}`);
			if (r.following > 0) parts.push(`Following: ${r.following}`);
			if (r.isVerified) parts.push("Verified: true");
			if (!r.hasCustomAvatar) parts.push("Default avatar: true");
			if (r.userFollows) parts.push("USER FOLLOWS: true");
			if (r.mutualCount > 0) parts.push(`Mutual follows: ${r.mutualCount}`);

			return parts.join("\n");
		})
		.join("\n\n---\n\n");

	return `Classify these ${replies.length} replies. Output ONLY a JSON array with ${replies.length} items, no markdown:

${repliesText}

[{"is_bot":...,"confidence":...,"category":"...","reason":"...","signals":[...]}, ...]`;
}

// Single reply prompt (for lookup)
export function buildSingleUserMessage(reply: ReplyData): string {
	const parts: string[] = [`@${reply.username}`, `Display name: ${reply.displayName}`];

	if (reply.replyText) parts.push(`Text: "${reply.replyText}"`);
	if (reply.bio) parts.push(`Bio: "${reply.bio}"`);
	if (reply.followers > 0) parts.push(`Followers: ${reply.followers}`);
	if (reply.following > 0) parts.push(`Following: ${reply.following}`);
	if (reply.isVerified) parts.push("Verified: true");
	if (!reply.hasCustomAvatar) parts.push("Default avatar: true");
	if (reply.userFollows) parts.push("USER FOLLOWS: true");
	if (reply.mutualCount > 0) parts.push(`Mutual follows: ${reply.mutualCount}`);

	return `Classify this account/reply. Output ONLY JSON, no markdown:

${parts.join("\n")}

{"is_bot":...,"confidence":...,"category":"...","reason":"...","signals":[...]}`;
}
