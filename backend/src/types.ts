export interface ReplyData {
	username: string;
	displayName: string;
	replyText: string;
	originalTweetText: string;
	bio: string;
	followers: number;
	following: number;
	accountCreatedAt: string;
	hasCustomAvatar: boolean;
	isVerified: boolean;
	location: string | null;
	secondsAfterOriginal: number;
	heuristicScore: number;
	// Legitimacy context (client-only hard-trust preferred; keep for completeness)
	userFollows: boolean;
	mutualCount: number;
}

export type SpamCategory =
	| "engagement_farmer"
	| "sycophant"
	| "self_promoter"
	| "airdrop_farmer"
	| "crypto_spam"
	| "llm_slop"
	| "genuine";

export interface BotVerdict {
	isBot: boolean;
	/** Low-info engagement farming / LLM filler — can be true even when isBot is false */
	isSlop: boolean;
	confidence: number;
	category: SpamCategory;
	reason: string;
	signals: string[];
	source: "ai" | "cache" | "local" | "fallback";
}

export interface ClassifyRequest {
	replies: ReplyData[];
}

export interface ClassifyResponse {
	verdicts: BotVerdict[];
}

export interface LookupResponse {
	username: string;
	verdict: BotVerdict | null;
	cached: boolean;
}
