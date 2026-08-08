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

// ============================================================================
// THREAD NEAR-DUPLICATE REPLIES (status / detail views only)
// Coordinated spam often rephrases the same take with low-follower alts.
// ============================================================================

const THREAD_STOPWORDS = new Set(
	(
		"the a an and or but in on at to for of is are was were be been being have has had " +
		"do does did will would could should may might must can need this that these those " +
		"i you he she it we they me him her us them my your his its our their what which who " +
		"whom whose where when why how all each every both few more most other some such no " +
		"nor not only own same so than too very just about into through during before after " +
		"above below from up down out off over under again further then once here there with " +
		"as by while if then else also get got like people time times way ways one two " +
		"really still even much many well back being going come came say says said think " +
		"thinking watch watching learn learns learning"
	).split(/\s+/),
);

/** @type {Map<string, Map<string, object>>} statusId -> username -> entry */
const threadRepliesByStatus = new Map();
let threadRegistryStatusId = null;

function isTweetDetailView() {
	try {
		return /\/status\/\d+/i.test(String(location?.pathname || ""));
	} catch {
		return false;
	}
}

function getStatusIdFromPath() {
	try {
		const m = String(location?.pathname || "").match(/\/status\/(\d+)/i);
		return m?.[1] || null;
	} catch {
		return null;
	}
}

function clearThreadReplyRegistry(reason) {
	threadRepliesByStatus.clear();
	threadRegistryStatusId = null;
	if (reason === "debug") {
		/* no-op */
	}
}

function ensureThreadRegistry(statusId) {
	if (threadRegistryStatusId && threadRegistryStatusId !== statusId) {
		threadRepliesByStatus.clear();
	}
	threadRegistryStatusId = statusId;
	if (!threadRepliesByStatus.has(statusId)) {
		threadRepliesByStatus.set(statusId, new Map());
	}
	return threadRepliesByStatus.get(statusId);
}

function normalizeReplyText(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/https?:\/\/\S+/gi, " ")
		.replace(/@\w+/g, " ")
		.replace(/#\w+/g, " ")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Light stem so learn/learns, holder/holders, eat/eats align for paraphrase spam. */
function lightStem(token) {
	let t = String(token || "").toLowerCase();
	if (t.length <= 3) return t;
	// Conservative lengths so "bleed" stays intact (not "ble")
	if (t.endsWith("ing") && t.length > 6) t = t.slice(0, -3);
	else if (t.endsWith("ers") && t.length > 6) t = t.slice(0, -1);
	else if (t.endsWith("ies") && t.length > 5) t = `${t.slice(0, -3)}y`;
	else if (t.endsWith("es") && t.length > 5 && !t.endsWith("ss")) t = t.slice(0, -2);
	else if (t.endsWith("ed") && t.length > 5) t = t.slice(0, -2);
	else if (t.endsWith("s") && !t.endsWith("ss") && t.length > 4) t = t.slice(0, -1);
	return t;
}

function contentTokens(norm) {
	return String(norm || "")
		.split(" ")
		.filter((t) => t.length > 2 && !THREAD_STOPWORDS.has(t))
		.map(lightStem);
}

function tokenBigrams(tokens) {
	const out = [];
	for (let i = 0; i < tokens.length - 1; i++) {
		out.push(`${tokens[i]} ${tokens[i + 1]}`);
	}
	return out;
}

function charNgrams(norm, n = 4) {
	const s = String(norm || "").replace(/\s+/g, "");
	if (s.length < n) return s ? [s] : [];
	const out = [];
	for (let i = 0; i <= s.length - n; i++) out.push(s.slice(i, i + n));
	return out;
}

function jaccard(listA, listB) {
	const A = new Set(listA);
	const B = new Set(listB);
	if (A.size === 0 && B.size === 0) return 0;
	let inter = 0;
	for (const x of A) {
		if (B.has(x)) inter++;
	}
	return inter / (A.size + B.size - inter);
}

function sharedDistinctiveCount(tokensA, tokensB) {
	const A = new Set(tokensA);
	const B = new Set(tokensB);
	let n = 0;
	for (const t of A) {
		// Prefer meaty terms + short tickers (vxx, spy, btc)
		if (!B.has(t)) continue;
		if (t.length >= 5 || (t.length >= 3 && t.length <= 5)) n++;
	}
	return n;
}

/**
 * Combined similarity in [0,1] for paraphrased spam on a thread.
 * Weights distinctive shared terms (contango, vxx, bleed…) heavily so
 * reworded copies of the same take still cluster.
 */
function replySimilarity(entryA, entryB) {
	const tj = jaccard(entryA.tokens, entryB.tokens);
	const bj = jaccard(entryA.bigrams, entryB.bigrams);
	const cj = jaccard(entryA.charGrams, entryB.charGrams);
	const shared = sharedDistinctiveCount(entryA.tokens, entryB.tokens);
	const minSize = Math.max(
		1,
		Math.min(new Set(entryA.tokens).size, new Set(entryB.tokens).size),
	);
	const dist = Math.min(1, shared / Math.min(6, minSize));
	// sharedCount bonus: 3+ distinctive stems almost always coordinated paraphrase
	const sharedBoost = shared >= 4 ? 0.22 : shared >= 3 ? 0.14 : shared >= 2 ? 0.06 : 0;
	return Math.min(1, tj * 0.28 + bj * 0.2 + cj * 0.22 + dist * 0.3 + sharedBoost);
}

function isLowFollowerProfile(followers) {
	if (followers == null || Number.isNaN(Number(followers))) return false;
	return Number(followers) < 150;
}

function buildReplyIndexEntry(username, replyData) {
	const text = String(replyData?.replyText || "").trim();
	const norm = normalizeReplyText(text);
	const tokens = contentTokens(norm);
	return {
		username: String(username || "").toLowerCase(),
		text: text.slice(0, 280),
		norm,
		tokens,
		bigrams: tokenBigrams(tokens),
		charGrams: charNgrams(norm, 4),
		followers:
			replyData?.followers != null && !Number.isNaN(Number(replyData.followers))
				? Number(replyData.followers)
				: null,
		registeredAt: Date.now(),
	};
}

/**
 * On /status/ pages only: detect near-duplicate replies from different accounts
 * (paraphrase spam rings). Soft-flags both sides; never overrides hard-trust.
 *
 * @returns {{ verdict: object, peerUsername: string, score: number } | null}
 */
function classifyThreadDuplicate(username, replyData) {
	if (!isTweetDetailView()) return null;

	const statusId = getStatusIdFromPath();
	if (!statusId) return null;

	const key = String(username || "").toLowerCase();
	if (!key) return null;

	// Hard-trust never demoted by thread clustering
	const tier = String(replyData?.trustTier || "none");
	if (tier === "mutual" || tier === "following" || tier === "whitelist") return null;
	if (replyData?.userFollows === true) return null;
	if (
		typeof window !== "undefined" &&
		window.BotLegitimacy?.isHardTrustTier?.(
			window.BotLegitimacy.getTrustTier?.(key),
		)
	) {
		return null;
	}

	const text = String(replyData?.replyText || "").trim();
	// Need enough substance for paraphrase matching (templates handled elsewhere)
	if (text.length < 48) return null;

	const self = buildReplyIndexEntry(key, replyData);
	if (self.tokens.length < 5) return null;

	const map = ensureThreadRegistry(statusId);

	let best = null;
	for (const [otherUser, entry] of map.entries()) {
		if (otherUser === key) continue;
		// Skip peers that became hard-trust later
		if (
			typeof window !== "undefined" &&
			window.BotLegitimacy?.isHardTrustTier?.(
				window.BotLegitimacy.getTrustTier?.(otherUser),
			)
		) {
			continue;
		}
		const score = replySimilarity(self, entry);
		if (!best || score > best.score) {
			best = { otherUser, score, entry };
		}
	}

	// Always register so the *next* similar reply can match us
	map.set(key, self);
	// Cap per thread
	if (map.size > 80) {
		const oldest = [...map.entries()].sort(
			(a, b) => (a[1].registeredAt || 0) - (b[1].registeredAt || 0),
		);
		while (map.size > 60 && oldest.length) {
			map.delete(oldest.shift()[0]);
		}
	}

	if (!best) return null;

	const selfLow = isLowFollowerProfile(self.followers);
	const peerLow = isLowFollowerProfile(best.entry.followers);
	const bothLow = selfLow && peerLow;
	const eitherLow = selfLow || peerLow;
	const score = best.score;

	// Thresholds: paraphrase spam + low-follower alts (detail view only)
	const sharedDist = sharedDistinctiveCount(self.tokens, best.entry.tokens);
	let hit = false;
	let confidence = 0;
	if (score >= 0.42 && bothLow) {
		hit = true;
		confidence = Math.min(0.95, 0.8 + score * 0.18);
	} else if (score >= 0.4 && eitherLow && sharedDist >= 3) {
		hit = true;
		confidence = Math.min(0.93, 0.76 + score * 0.2);
	} else if (score >= 0.5 && sharedDist >= 3) {
		// Strong paraphrase even without follower counts
		hit = true;
		confidence = Math.min(0.9, 0.72 + score * 0.2);
	} else if (score >= 0.38 && bothLow && sharedDist >= 3) {
		hit = true;
		confidence = Math.min(0.9, 0.74 + score * 0.2);
	}

	if (!hit) return null;

	const peer = best.otherUser;
	const pct = Math.round(score * 100);
	const verdict = makeLocalVerdict({
		isBot: true,
		isSlop: true,
		confidence,
		category: "engagement_farmer",
		reason: bothLow
			? `Near-duplicate reply to @${peer} in this thread (${pct}% similar) from low-follower accounts — coordinated spam pattern`
			: `Near-duplicate reply to @${peer} in this thread (${pct}% similar wording) — likely coordinated spam`,
		signals: [
			"thread_near_duplicate",
			`sim_${pct}`,
			`peer_${peer}`,
			...(bothLow ? ["low_followers_pair"] : eitherLow ? ["low_followers"] : []),
		],
	});

	return { verdict, peerUsername: peer, score };
}

/**
 * Re-apply a thread-duplicate verdict onto the peer's visible tweet cards.
 */
function applyThreadDuplicateToPeer(peerUsername, verdict) {
	if (!peerUsername || !verdict || typeof document === "undefined") return;
	const peer = String(peerUsername).toLowerCase();
	// Don't demote hard-trust peers
	if (
		typeof window !== "undefined" &&
		window.BotLegitimacy?.isHardTrustTier?.(
			window.BotLegitimacy.getTrustTier?.(peer),
		)
	) {
		return;
	}
	try {
		window.BotCache?.saveBotCache?.(peer, verdict);
	} catch {
		/* ignore */
	}
	document
		.querySelectorAll(`article[data-testid="tweet"][data-bot-username="${peer}"]`)
		.forEach((el) => {
			try {
				window.BotUI?.applyBotUI?.(el, verdict, peer);
				el.dataset.botProcessed = "bot";
			} catch {
				/* ignore */
			}
		});
}

// Export
if (typeof window !== "undefined") {
	window.BotDetection = {
		extractReplyDataFromElement,
		extractOriginalTweetText,
		localClassify,
		classifyFollowRatio,
		classifyThreadDuplicate,
		applyThreadDuplicateToPeer,
		isTweetDetailView,
		getStatusIdFromPath,
		clearThreadReplyRegistry,
		replySimilarity,
		buildReplyIndexEntry,
		shouldClassify,
		hashText,
	};
}
