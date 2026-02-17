import type { ReplyData } from "../types.js";

function getFollowerRatioAssessment(followers: number, following: number): string {
	if (following === 0) return "suspicious (following nobody)";
	const ratio = followers / following;
	if (ratio >= 10 && followers >= 1000) return "strong (earned audience)";
	if (ratio >= 3 && followers >= 500) return "moderate";
	if (ratio >= 1.5 && followers >= 100) return "slight positive";
	if (ratio < 0.5 && following > 1000) return "suspicious (farming pattern)";
	return "neutral";
}

function getAccountAgeYears(createdAt: string): number | null {
	if (!createdAt) return null;
	const created = new Date(createdAt).getTime();
	if (Number.isNaN(created)) return null;
	const now = Date.now();
	return (now - created) / (365 * 24 * 60 * 60 * 1000);
}

export function buildClassificationPrompt(reply: ReplyData): string {
	const ageYears = getAccountAgeYears(reply.accountCreatedAt);
	const followerRatio = reply.following > 0 ? (reply.followers / reply.following).toFixed(1) : "unknown";
	const ratioAssessment =
		reply.followers > 0 || reply.following > 0
			? getFollowerRatioAssessment(reply.followers, reply.following)
			: "unknown (no data)";

	// Format account age - show "unknown" if not available
	const ageDisplay = ageYears !== null ? `${ageYears.toFixed(1)} years old` : "unknown";

	return `You are analyzing Twitter/X replies for bot/spam detection, with special focus on crypto Twitter spam.

CONTEXT:
- Original tweet: ${reply.originalTweetText || "[not provided]"}
- Reply text: ${reply.replyText || "[lookup mode - no reply text]"}
- Account: @${reply.username}
- Display name: ${reply.displayName}
- Account created: ${reply.accountCreatedAt || "unknown"} (${ageDisplay})
- Followers: ${reply.followers || "unknown"} / Following: ${reply.following || "unknown"} (ratio: ${followerRatio}x)
- Bio: ${reply.bio || "[no bio provided]"}
- Reply timing: ${reply.secondsAfterOriginal > 0 ? `${reply.secondsAfterOriginal}s after original` : "unknown"}
- Profile picture: ${reply.hasCustomAvatar ? "custom" : "unknown/default"}
- Verified: ${reply.isVerified}
- Location: ${reply.location || "[not set]"}
- Heuristic score: ${reply.heuristicScore}/100 (higher = more suspicious, 0 = no heuristic data)

NOTE: "unknown" values mean we don't have that data - treat as NEUTRAL, not suspicious.

LEGITIMACY CONTEXT:
- User follows this account: ${reply.userFollows}
- Mutual follows (accounts user follows who also follow this account): ${reply.mutualCount}
- Follower ratio assessment: ${ratioAssessment}

SPAM/BOT CATEGORIES (flag if ANY apply):

1. ENGAGEMENT FARMER
   - Replies to build Kaito score or similar metrics
   - Generic agreement designed to get likes, not add value
   - Bio mentions "yapper", engagement stats, "building presence"
   - Replies to every tweet from popular accounts
   
2. SYCOPHANT BOT
   - "Great thread!", "So true!", "Bullish!", "This is the way"
   - Restates the tweet as if adding insight
   - Never disagrees, never asks substantive questions
   - "More people need to see this" without explaining why
   
3. SELF-PROMOTER
   - Pivots every reply to their project/product
   - "This is why we're building X"
   - "We solved this at [project]"
   - Bio has "DM for collabs" or agency signals
   
4. AIRDROP FARMER
   - Generic supportive comments on protocol accounts
   - Bio mentions multiple ecosystems being "explored"
   - Following >> Followers (farming pattern)
   - New account, high activity
   
5. CRYPTO BIO SPAM SIGNALS
   - Buzzword soup: "web3 explorer", "defi degen", "crypto native", "onchain curious"
   - Multiple chain emojis (◎ ⟠ 🔵)
   - ".eth" or ".sol" in name
   - "Future millionaire", "generational wealth"
   - Kaito/engagement metrics in bio
   
6. VAPID REPLY PATTERNS
   - "Saving this for later"
   - "Underrated thread"
   - "The alpha here is crazy"
   - "Few understand this"
   - Single word: "Facts", "Real", "Valid", "Based"

GENUINE HUMAN SIGNALS (reduce spam score):
- Specific references to content in the original tweet
- Personal anecdotes or experiences shared
- Disagreement or nuanced critique (bots avoid conflict)
- Questions that show they actually read the tweet
- Humor, sarcasm, or personality that doesn't fit templates
- Typos combined with substantive content
- Reply that could NOT be copy-pasted to any other tweet

LEGITIMACY SIGNALS (strong evidence against bot):
- User follows this account → VERY strong signal, almost never flag
- High mutual follows (5+) → Strong social proof from trusted network
- Strong follower ratio (10x+) → Earned audience, not farming
- Account age 2+ years → Survived without being banned
- High absolute followers (10K+) → Established presence, hard to fake
- Verified account → Some friction (paid), reduces bot likelihood

IMPORTANT: If user_follows is true, you need OVERWHELMING evidence of bot 
behavior to flag. A vapid reply from someone the user follows is their 
problem - they chose to follow that account.

CRITICAL: In crypto Twitter, the bar for "spam" is LOWER than general Twitter.
Even if a reply is from a real human, if they're clearly engagement farming
(adding zero value, generic praise, optimizing for metrics), flag them.
The goal is signal-to-noise ratio, not just catching literal bots.

OUTPUT (JSON only, no markdown):
{
  "is_bot": true/false,
  "confidence": 0.0-1.0,
  "category": "engagement_farmer|sycophant|self_promoter|airdrop_farmer|crypto_spam|genuine",
  "reason": "One sentence explanation",
  "signals": ["signal1", "signal2"]
}

DEFAULT TO FLAGGING. False positives (hiding a real human's vapid reply) are 
far less harmful than false negatives (letting spam drown signal). When in 
doubt, is_bot: true.`;
}

export function buildBatchPrompt(replies: ReplyData[]): string {
	const repliesContext = replies
		.map((reply, i) => {
			const ageYears = getAccountAgeYears(reply.accountCreatedAt);
			const followerRatio = reply.following > 0 ? (reply.followers / reply.following).toFixed(1) : "N/A";
			const ratioAssessment = getFollowerRatioAssessment(reply.followers, reply.following);

			return `REPLY ${i + 1}:
- Original tweet: ${reply.originalTweetText || "[not provided]"}
- Reply text: ${reply.replyText}
- Account: @${reply.username}
- Display name: ${reply.displayName}
- Account created: ${reply.accountCreatedAt} (${ageYears || ""}.toFixed(1)} years old)
- Followers: ${reply.followers} / Following: ${reply.following} (ratio: ${followerRatio}x)
- Bio: ${reply.bio || "[no bio]"}
- Reply timing: ${reply.secondsAfterOriginal}s after original
- Profile picture: ${reply.hasCustomAvatar ? "custom" : "default"}
- Verified: ${reply.isVerified}
- Location: ${reply.location || "[not set]"}
- Heuristic score: ${reply.heuristicScore}/100
- User follows: ${reply.userFollows}
- Mutual follows: ${reply.mutualCount}
- Follower ratio assessment: ${ratioAssessment}`;
		})
		.join("\n\n");

	return `You are analyzing Twitter/X replies for bot/spam detection, with special focus on crypto Twitter spam.

${repliesContext}

SPAM/BOT CATEGORIES (flag if ANY apply):

1. ENGAGEMENT FARMER - Replies to build Kaito score or similar metrics, generic agreement
2. SYCOPHANT BOT - "Great thread!", restates tweet, never disagrees
3. SELF-PROMOTER - Pivots to their project, "DM for collabs" bio
4. AIRDROP FARMER - Generic supportive comments, following >> followers, new account
5. CRYPTO BIO SPAM SIGNALS - Buzzword soup, chain emojis, ".eth/.sol" names
6. VAPID REPLY PATTERNS - "Saving this", "Underrated", single words like "Facts"

GENUINE HUMAN SIGNALS: Specific references, personal anecdotes, disagreement, substantive questions, humor.

LEGITIMACY SIGNALS: user_follows=true (VERY strong), high mutuals (5+), strong follower ratio (10x+), old account (2yr+), high followers (10K+), verified.

IMPORTANT: If user_follows is true, require OVERWHELMING evidence to flag.

DEFAULT TO FLAGGING in crypto Twitter. The goal is signal-to-noise ratio.

OUTPUT (JSON array, no markdown, exactly ${replies.length} items):
[
  {"is_bot": true/false, "confidence": 0.0-1.0, "category": "...", "reason": "...", "signals": [...]},
  ...
]`;
}
