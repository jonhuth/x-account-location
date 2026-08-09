import type { BotVerdict, ReplyData } from "../types.js";

/**
 * Server local prefilter — keep in sync with extension/botDetection.js.
 * HUMAN-DEFAULT: normal short chat is not a bot. High-precision only.
 */

const FARM_PHRASES = new Set(
	[
		"few understand this",
		"few understand",
		"the alpha here is crazy",
		"more people need to see this",
		"underrated thread",
		"this is the one",
		"this is the way",
		"came here to say this",
		"taking notes",
		"big if true",
		"absolute fire",
	].map((s) => s.toLowerCase()),
);

const FARM_PATTERNS = [
	/^(few\s+understand(\s+this)?)[\s!.]*$/i,
	/^(the\s+alpha\s+here\s+is\s+crazy)[\s!.]*$/i,
	/^(more\s+people\s+need\s+to\s+see\s+this)[\s!.]*$/i,
	/^(underrated\s+thread)[\s!.]*$/i,
	/^(this\s+is\s+the\s+(way|one))[\s!.]*$/i,
	/^(came\s+here\s+to\s+say\s+this)[\s!.]*$/i,
];

const LLM_SLOP_PATTERNS = [
	/^as\s+someone\s+who\b/i,
	/^in\s+today'?s\s+(fast[- ]paced|digital|ever[- ]changing)\b/i,
	/\bit'?s\s+not\s+just\s+about\b.*\bit'?s\s+about\b/i,
	/\blet'?s\s+unpack\s+this\b/i,
	/\bin\s+a\s+world\s+where\b/i,
];

function verdict(
	partial: Omit<BotVerdict, "source"> & { source?: BotVerdict["source"] },
): BotVerdict {
	return {
		isBot: Boolean(partial.isBot),
		isSlop: Boolean(partial.isSlop),
		confidence: Math.min(1, Math.max(0, Number(partial.confidence) || 0.5)),
		category: partial.category,
		reason: partial.reason,
		signals: Array.isArray(partial.signals) ? partial.signals.slice(0, 5) : [],
		source: "local",
	};
}

function hasKnownProfileCounts(reply: ReplyData): boolean {
	return (
		(Number.isFinite(reply.followers) && reply.followers > 0) ||
		(Number.isFinite(reply.following) && reply.following > 0)
	);
}

function isProtectiveHuman(reply: ReplyData): boolean {
	if (reply.isVerified) return true;
	if ((reply.followers || 0) >= 2000) return true;
	return false;
}

function isExtremeFarmProfile(reply: ReplyData): boolean {
	if (!hasKnownProfileCounts(reply)) return false;
	if (reply.isVerified) return false;
	const followers = Math.max(0, Number(reply.followers) || 0);
	const following = Math.max(0, Number(reply.following) || 0);
	if (following < 2000) return false;
	const ratio = following / Math.max(followers, 1);
	return followers < 150 && ratio >= 25;
}

export function localClassifyReply(reply: ReplyData): BotVerdict | null {
	const ratioHit = classifyFollowRatio(reply);
	if (ratioHit) return ratioHit;

	if (isProtectiveHuman(reply)) return null;

	const text = String(reply.replyText || "").trim();
	if (!text) return null;

	const normalized = text.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();
	const stripped = normalized.replace(/[.!?…]+$/g, "").trim();

	const farmPhrase =
		FARM_PHRASES.has(stripped) ||
		FARM_PHRASES.has(normalized) ||
		FARM_PATTERNS.some((re) => re.test(text) || re.test(normalized));

	if (farmPhrase) {
		const farmProfile = isExtremeFarmProfile(reply);
		return verdict({
			isBot: farmProfile,
			isSlop: true,
			confidence: farmProfile ? 0.86 : 0.7,
			category: farmProfile ? "engagement_farmer" : "sycophant",
			reason: farmProfile
				? "Farm catchphrase plus extreme follow-farm profile"
				: "Generic farm catchphrase (not enough alone to call bot)",
			signals: farmProfile
				? ["server_farm_phrase", "server_farm_profile"]
				: ["server_farm_phrase"],
		});
	}

	for (const re of LLM_SLOP_PATTERNS) {
		if (re.test(text) && text.length > 80) {
			return verdict({
				isBot: false,
				isSlop: true,
				confidence: 0.74,
				category: "llm_slop",
				reason: "Reads like generic LLM filler",
				signals: ["server_local_llm_slop"],
			});
		}
	}

	return null;
}

/**
 * Only extreme mass-follow + tiny audience. Mild high-following is normal.
 * 0/0 counts = missing data, not a farm.
 */
export function classifyFollowRatio(reply: ReplyData): BotVerdict | null {
	if (!hasKnownProfileCounts(reply)) return null;
	if (reply.isVerified) return null;

	const followers = Math.max(0, Number(reply.followers) || 0);
	const following = Math.max(0, Number(reply.following) || 0);
	if (following < 2500) return null;

	const ratio = following / Math.max(followers, 1);
	const text = String(reply.replyText || "").trim();
	const veryThin = text.length > 0 && text.length < 40;
	const ratioLabel = `${Math.round(ratio)}:1`;

	if (following >= 2500 && followers < 120 && ratio >= 30) {
		return verdict({
			isBot: true,
			isSlop: true,
			confidence: veryThin ? 0.9 : 0.84,
			category: "airdrop_farmer",
			reason: `Extreme follow-farm profile: following ${following} vs ${followers} followers (${ratioLabel})`,
			signals: [
				"server_ratio_mass_follow",
				`following_${following}`,
				`followers_${followers}`,
			],
		});
	}

	if (following >= 3000 && followers < 200 && ratio >= 25 && veryThin) {
		return verdict({
			isBot: true,
			isSlop: true,
			confidence: 0.82,
			category: "airdrop_farmer",
			reason: `Mass following (${ratioLabel}) with empty engagement reply`,
			signals: ["server_ratio_extreme", "server_thin_reply"],
		});
	}

	return null;
}
