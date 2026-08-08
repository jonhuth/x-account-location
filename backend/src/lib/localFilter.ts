import type { BotVerdict, ReplyData } from "../types.js";

/**
 * Server-side template prefilter — same idea as the extension client.
 * Avoids Haiku spend on obvious engagement farm phrases.
 */

const EXACT_SLOP = new Set(
	[
		"facts",
		"fact",
		"real",
		"true",
		"so true",
		"so real",
		"valid",
		"based",
		"w",
		"this",
		"this is the way",
		"bullish",
		"bearish",
		"gm",
		"gn",
		"lfg",
		"wagmi",
		"ngmi",
		"few",
		"few understand this",
		"underrated",
		"underrated thread",
		"saving this",
		"bookmarking this",
		"more people need to see this",
		"this is the one",
		"the alpha here is crazy",
		"great thread",
		"great post",
		"amazing thread",
		"love this",
		"exactly",
		"exactly this",
		"came here to say this",
		"taking notes",
		"noted",
		"big if true",
	].map((s) => s.toLowerCase()),
);

const SLOP_PATTERNS = [
	/^(so\s+)?(true|real|valid|based|facts)[\s!.]*$/i,
	/^(great|amazing|excellent|solid|insane|crazy)\s+(thread|post|take|point)[\s!.]*$/i,
	/^(this\s+is\s+the\s+way|this\s+is\s+the\s+one)[\s!.]*$/i,
	/^(more\s+people\s+need\s+to\s+see\s+this)[\s!.]*$/i,
	/^(few\s+understand(\s+this)?)[\s!.]*$/i,
	/^(saving|bookmarking)\s+this[\s!.]*$/i,
	/^(gm|gn|wagmi|ngmi|lfg)[\s!.]*$/i,
];

const LLM_SLOP_PATTERNS = [
	/^as\s+someone\s+who\b/i,
	/^in\s+today'?s\s+(fast[- ]paced|digital|ever[- ]changing)\b/i,
	/\bit'?s\s+not\s+just\s+about\b.*\bit'?s\s+about\b/i,
	/\blet'?s\s+unpack\s+this\b/i,
	/\bin\s+a\s+world\s+where\b/i,
];

function verdict(partial: Omit<BotVerdict, "source"> & { source?: BotVerdict["source"] }): BotVerdict {
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

export function localClassifyReply(reply: ReplyData): BotVerdict | null {
	const text = String(reply.replyText || "").trim();

	if (text) {
		const normalized = text.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();
		const stripped = normalized.replace(/[.!?…]+$/g, "").trim();

		if (EXACT_SLOP.has(stripped) || EXACT_SLOP.has(normalized)) {
			return verdict({
				isBot: true,
				isSlop: true,
				confidence: 0.88,
				category: "sycophant",
				reason: "Generic engagement phrase with no substance",
				signals: ["server_local_exact"],
			});
		}

		for (const re of SLOP_PATTERNS) {
			if (re.test(text) || re.test(normalized)) {
				return verdict({
					isBot: true,
					isSlop: true,
					confidence: 0.82,
					category: "sycophant",
					reason: "Matches known engagement-farm reply pattern",
					signals: ["server_local_pattern"],
				});
			}
		}

		if (text.length <= 24 && !/[a-z0-9]/i.test(text) && /[\u{1F300}-\u{1FAFF}]/u.test(text)) {
			return verdict({
				isBot: true,
				isSlop: true,
				confidence: 0.8,
				category: "sycophant",
				reason: "Emoji-only engagement reply",
				signals: ["server_local_emoji"],
			});
		}

		const tokens = stripped.split(/\s+/).filter(Boolean);
		if (
			tokens.length > 0 &&
			tokens.length <= 2 &&
			text.length <= 16 &&
			!/[?]/.test(text) &&
			/^(yes|yep|yeah|yup|true|real|facts|this|same|agreed|agree|correct|exactly|based|valid|w|fire)$/i.test(
				stripped,
			)
		) {
			return verdict({
				isBot: true,
				isSlop: true,
				confidence: 0.78,
				category: "sycophant",
				reason: "Ultra-short vapid agreement",
				signals: ["server_local_short"],
			});
		}

		for (const re of LLM_SLOP_PATTERNS) {
			if (re.test(text)) {
				return verdict({
					isBot: false,
					isSlop: true,
					confidence: 0.72,
					category: "llm_slop",
					reason: "Reads like generic LLM filler",
					signals: ["server_local_llm_slop"],
				});
			}
		}
	}

	// Follow/follower ratio — high signal even without reply text
	const ratioHit = classifyFollowRatio(reply);
	if (ratioHit) return ratioHit;

	return null;
}

/**
 * following >> followers is a strong bot/farm prior (mass-follow to fish follows).
 * Keep in sync with extension/botDetection.js classifyFollowRatio.
 */
export function classifyFollowRatio(reply: ReplyData): BotVerdict | null {
	const followers = Math.max(0, Number(reply.followers) || 0);
	const following = Math.max(0, Number(reply.following) || 0);
	if (following < 150) return null;

	const ratio = following / Math.max(followers, 1);
	const text = String(reply.replyText || "").trim();
	const thin = text.length > 0 && text.length < 120 && !/[?]/.test(text);
	const veryThin = text.length > 0 && text.length < 60;
	const ratioLabel = `${Math.round(ratio)}:1`;

	if (following >= 1500 && followers < 200) {
		return verdict({
			isBot: true,
			isSlop: true,
			confidence: veryThin ? 0.92 : 0.88,
			category: "airdrop_farmer",
			reason: `Follow-farm profile: following ${following} vs ${followers} followers (${ratioLabel})`,
			signals: [
				"server_ratio_mass_follow",
				`following_${following}`,
				`followers_${followers}`,
			],
		});
	}

	if (following >= 400 && ratio >= 20) {
		return verdict({
			isBot: true,
			isSlop: true,
			confidence: veryThin ? 0.9 : 0.84,
			category: "airdrop_farmer",
			reason: `Extreme following/followers ratio (${ratioLabel}) — follow-to-get-followed pattern`,
			signals: ["server_ratio_extreme", `ratio_${Math.round(ratio)}`],
		});
	}

	if (following >= 300 && ratio >= 12) {
		return verdict({
			isBot: true,
			isSlop: true,
			confidence: thin ? 0.8 : 0.74,
			category: "airdrop_farmer",
			reason: `High following/followers ratio (${ratioLabel}) typical of follow-farm accounts`,
			signals: ["server_ratio_high", `ratio_${Math.round(ratio)}`],
		});
	}

	if (following >= 200 && ratio >= 8 && (veryThin || (thin && !reply.isVerified))) {
		return verdict({
			isBot: true,
			isSlop: true,
			confidence: 0.72,
			category: "engagement_farmer",
			reason: `Elevated follow ratio (${ratioLabel}) with thin engagement-style reply`,
			signals: ["server_ratio_elevated", "server_thin_reply"],
		});
	}

	return null;
}
