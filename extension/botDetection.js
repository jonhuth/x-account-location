// Bot Detection - Client extraction + cheap local prefilter
// Heavy scoring stays on the server; local filters avoid API/X load

// ============================================================================
// DATA EXTRACTION
// ============================================================================

/**
 * Extract reply data from a tweet DOM element.
 * Profile fields stay empty here — filled from passive pageScript cache only.
 */
function extractReplyDataFromElement(el, username) {
	try {
		const userNameContainer = el.querySelector(
			'[data-testid="User-Name"], [data-testid="UserName"]',
		);
		let displayName = username;
		if (userNameContainer) {
			const nameLink = userNameContainer.querySelector('a[href^="/"]');
			if (nameLink) {
				const fullText = nameLink.textContent?.trim() || "";
				if (fullText && !fullText.startsWith("@")) {
					displayName = fullText;
				}
			}
		}

		const replyText =
			el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || "";

		const avatarEl = el.querySelector('img[src*="profile_images"]');
		const hasCustomAvatar = avatarEl
			? !String(avatarEl.src || "").includes("default_profile")
			: true;

		const isVerified = !!(
			el.querySelector('[data-testid="icon-verified"]') ||
			el.querySelector('svg[aria-label*="Verified"]') ||
			el.querySelector('[aria-label*="Verified"]') ||
			userNameContainer?.querySelector('svg[data-testid="icon-verified"]') ||
			userNameContainer?.querySelector('[data-testid="icon-verified"]') ||
			userNameContainer?.querySelector('svg[viewBox="0 0 22 22"]')
		);

		return {
			username,
			displayName,
			replyText,
			originalTweetText: extractOriginalTweetText(el),
			hasCustomAvatar,
			isVerified,
			bio: "",
			followers: 0,
			following: 0,
			accountCreatedAt: "",
			location: null,
			secondsAfterOriginal: 0,
			heuristicScore: 0,
			userFollows: false,
			mutualCount: 0,
			trustTier: "none",
			contentHash: hashText(replyText),
		};
	} catch {
		return null;
	}
}

/**
 * Best-effort original tweet text from the conversation context.
 * Prefer the main tweet on /status/ pages; else first ancestor article.
 * DOM-only — no X API.
 */
function extractOriginalTweetText(el) {
	try {
		const articles = document.querySelectorAll('article[data-testid="tweet"]');
		if (!articles.length) return "";

		// On a status page the first primary column tweet is usually the OP
		const primary = document.querySelector(
			'[data-testid="primaryColumn"] article[data-testid="tweet"]',
		);
		if (primary && primary !== el) {
			const text =
				primary.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ||
				"";
			if (text) return text.slice(0, 500);
		}

		// Fallback: previous sibling article in the same list
		let prev = el.previousElementSibling;
		while (prev) {
			if (prev.matches?.('article[data-testid="tweet"]')) {
				const text =
					prev.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ||
					"";
				if (text) return text.slice(0, 500);
			}
			prev = prev.previousElementSibling;
		}

		if (articles[0] && articles[0] !== el) {
			const text =
				articles[0]
					.querySelector('[data-testid="tweetText"]')
					?.textContent?.trim() || "";
			if (text) return text.slice(0, 500);
		}

		return "";
	} catch {
		return "";
	}
}

function hashText(text) {
	const s = String(text || "");
	if (!s) return "";
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(16);
}

// ============================================================================
// LOCAL TEMPLATE PREFILTER — zero network, takes load off backend + X
// ============================================================================

/** Exact / near-exact engagement-farm phrases */
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
		"need this",
		"more people need to see this",
		"this is the one",
		"the alpha here is crazy",
		"great thread",
		"great post",
		"amazing thread",
		"excellent thread",
		"love this",
		"this is fire",
		"absolute fire",
		"so based",
		"based take",
		"correct",
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
	/^(the\s+alpha\s+here\s+is\s+crazy)[\s!.]*$/i,
	/^(came\s+here\s+to\s+say\s+this)[\s!.]*$/i,
	/^(absolutely|100%|100)\s*(this|agree|correct)?[\s!.]*$/i,
	/^(gm|gn|wagmi|ngmi|lfg)[\s!.]*$/i,
];

const LLM_SLOP_PATTERNS = [
	/^as\s+someone\s+who\b/i,
	/^in\s+today'?s\s+(fast[- ]paced|digital|ever[- ]changing)\b/i,
	/\bit'?s\s+not\s+just\s+about\b.*\bit'?s\s+about\b/i,
	/\blet'?s\s+unpack\s+this\b/i,
	/\bat\s+the\s+end\s+of\s+the\s+day\b/i,
	/\bin\s+a\s+world\s+where\b/i,
];

/**
 * Cheap local classification. Returns a verdict or null if uncertain (needs AI).
 * Never fires for mutual / following hard-trust — short comments must not demote them.
 */
function localClassify(replyData) {
	const tier = String(replyData?.trustTier || "none");
	if (tier === "mutual" || tier === "following" || tier === "whitelist") {
		return null;
	}
	if (replyData?.userFollows === true) {
		return null;
	}
	// Belt-and-suspenders if caller forgot to stamp trustTier
	const u = String(replyData?.username || "").toLowerCase();
	if (
		u &&
		typeof window !== "undefined" &&
		window.BotLegitimacy?.isHardTrustTier?.(
			window.BotLegitimacy.getTrustTier?.(u),
		)
	) {
		return null;
	}

	const text = String(replyData?.replyText || "").trim();

	if (text) {
		const normalized = text
			.toLowerCase()
			.replace(/[“”"']/g, "")
			.replace(/\s+/g, " ")
			.trim();
		const stripped = normalized.replace(/[.!?…]+$/g, "").trim();

		if (EXACT_SLOP.has(stripped) || EXACT_SLOP.has(normalized)) {
			return makeLocalVerdict({
				isBot: true,
				isSlop: true,
				confidence: 0.88,
				category: "sycophant",
				reason: "Generic engagement phrase with no substance",
				signals: ["local_template_exact"],
			});
		}

		for (const re of SLOP_PATTERNS) {
			if (re.test(text) || re.test(normalized)) {
				return makeLocalVerdict({
					isBot: true,
					isSlop: true,
					confidence: 0.82,
					category: "sycophant",
					reason: "Matches known engagement-farm reply pattern",
					signals: ["local_template_pattern"],
				});
			}
		}

		// Emoji-only replies (no letters/digits)
		if (text.length <= 24 && !/[a-z0-9]/i.test(text) && /[\u{1F300}-\u{1FAFF}]/u.test(text)) {
			return makeLocalVerdict({
				isBot: true,
				isSlop: true,
				confidence: 0.8,
				category: "sycophant",
				reason: "Emoji-only engagement reply",
				signals: ["local_emoji_only"],
			});
		}

		// Very short vapid replies (≤3 tokens, no question, no @mention of substance)
		const tokens = stripped.split(/\s+/).filter(Boolean);
		if (
			tokens.length > 0 &&
			tokens.length <= 2 &&
			text.length <= 16 &&
			!/[?]/.test(text) &&
			!/@\w{2,}/.test(text)
		) {
			if (
				/^(yes|yep|yeah|yup|true|real|facts|this|same|agreed|agree|correct|exactly|based|valid|w|fire|based)$/i.test(
					stripped,
				)
			) {
				return makeLocalVerdict({
					isBot: true,
					isSlop: true,
					confidence: 0.78,
					category: "sycophant",
					reason: "Ultra-short vapid agreement",
					signals: ["local_short_vapid"],
				});
			}
		}

		for (const re of LLM_SLOP_PATTERNS) {
			if (re.test(text)) {
				return makeLocalVerdict({
					isBot: false,
					isSlop: true,
					confidence: 0.72,
					category: "llm_slop",
					reason: "Reads like generic LLM filler, not a specific reply",
					signals: ["local_llm_slop_pattern"],
				});
			}
		}
	}

	// Follow/follower ratio — high signal even when reply text is empty/unknown
	const ratioHit = classifyFollowRatio(replyData);
	if (ratioHit) return ratioHit;

	return null;
}

/**
 * following >> followers is a strong bot/farm prior: mass-follow to fish follows back.
 * Hard-trust accounts are already excluded by localClassify.
 *
 * Tiers (when follower/following counts are known from passive intercepts):
 * - extreme mass-follow with tiny audience
 * - very high ratio
 * - elevated ratio + thin engagement reply
 */
function classifyFollowRatio(replyData) {
	const followers = Math.max(0, Number(replyData?.followers) || 0);
	const following = Math.max(0, Number(replyData?.following) || 0);
	if (following < 150) return null;

	const ratio = following / Math.max(followers, 1);
	const text = String(replyData?.replyText || "").trim();
	const thin = text.length > 0 && text.length < 120 && !/[?]/.test(text);
	const veryThin = text.length > 0 && text.length < 60;
	const ratioLabel = `${Math.round(ratio)}:1`;

	// Classic follow-farm: thousands following, almost no audience
	if (following >= 1500 && followers < 200) {
		return makeLocalVerdict({
			isBot: true,
			isSlop: true,
			confidence: veryThin ? 0.92 : 0.88,
			category: "airdrop_farmer",
			reason: `Follow-farm profile: following ${following} vs ${followers} followers (${ratioLabel})`,
			signals: [
				"local_ratio_mass_follow",
				`following_${following}`,
				`followers_${followers}`,
			],
		});
	}

	// Extreme ratio — trying hard to get followed
	if (following >= 400 && ratio >= 20) {
		return makeLocalVerdict({
			isBot: true,
			isSlop: true,
			confidence: veryThin ? 0.9 : 0.84,
			category: "airdrop_farmer",
			reason: `Extreme following/followers ratio (${ratioLabel}) — follow-to-get-followed pattern`,
			signals: ["local_ratio_extreme", `ratio_${Math.round(ratio)}`],
		});
	}

	if (following >= 300 && ratio >= 12) {
		return makeLocalVerdict({
			isBot: true,
			isSlop: true,
			confidence: thin ? 0.8 : 0.74,
			category: "airdrop_farmer",
			reason: `High following/followers ratio (${ratioLabel}) typical of follow-farm accounts`,
			signals: ["local_ratio_high", `ratio_${Math.round(ratio)}`],
		});
	}

	// Elevated ratio only when the reply is also thin engagement
	if (following >= 200 && ratio >= 8 && (veryThin || (thin && !replyData?.isVerified))) {
		return makeLocalVerdict({
			isBot: true,
			isSlop: true,
			confidence: 0.72,
			category: "engagement_farmer",
			reason: `Elevated follow ratio (${ratioLabel}) with thin engagement-style reply`,
			signals: ["local_ratio_elevated", "local_thin_reply"],
		});
	}

	return null;
}

function makeLocalVerdict({
	isBot,
	isSlop,
	confidence,
	category,
	reason,
	signals,
}) {
	return {
		isBot: Boolean(isBot),
		isSlop: Boolean(isSlop),
		confidence: Number(confidence) || 0.5,
		category: category || "crypto_spam",
		reason: reason || "Local filter",
		signals: Array.isArray(signals) ? signals : [],
		source: "local",
		accountScore: null,
		replyScore: null,
	};
}

/**
 * Decide whether to classify. Whitelist / hard-trust handled by caller.
 */
function shouldClassify(replyData, isWhitelisted) {
	if (isWhitelisted) return { action: "skip", reason: "whitelisted" };
	return { action: "classify", reason: "needs_analysis" };
}

// Export
if (typeof window !== "undefined") {
	window.BotDetection = {
		extractReplyDataFromElement,
		extractOriginalTweetText,
		localClassify,
		classifyFollowRatio,
		shouldClassify,
		hashText,
	};
}
