// Bot Detection - Client extraction + cheap local prefilter
// Heavy scoring stays on the server; local filters avoid API/X load

// ============================================================================
// DATA EXTRACTION
// ============================================================================

/**
 * Best-effort: does the DOM say YOU follow this account?
 * Used as instant hard-trust so we never paint "?" on people you follow
 * while the Following list crawl is still loading.
 */
function detectYouFollowFromDom(el) {
	if (!el) return false;
	try {
		// Unfollow control only exists when you already follow them
		if (el.querySelector('[data-testid$="-unfollow"]')) return true;
		if (el.querySelector('[data-testid="userFollowIndicator"]')) return true;
		// Profile header / card "Following" button
		const buttons = el.querySelectorAll('button, [role="button"]');
		for (const btn of buttons) {
			const label = String(
				btn.getAttribute("aria-label") || btn.textContent || "",
			).toLowerCase();
			// Exact-ish: "Following @x" / button text "Following" (not "Followers")
			if (label.includes("unfollow")) return true;
			if (
				(label === "following" || label.startsWith("following @")) &&
				!label.includes("followers")
			) {
				return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}

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

		const userFollowsDom = detectYouFollowFromDom(el);

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
			userFollows: userFollowsDom,
			mutualCount: 0,
			trustTier: userFollowsDom ? "following" : "none",
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
// LOCAL SCORE — simple high-signal gates only (see docs/agent/scoring.md)
//
// Ultimate browser-extension setup (research-backed, keep it tiny):
//   1. Hard-trust / override (caller) — never score
//   2. Profile metadata — hardest for farms to fake cheaply:
//        extreme following/followers ratio, very new + mass-follow + default avatar
//   3. Coordination — thread near-duplicate clusters (separate module)
//   4. AI last — text-only judgments; human-default; conf ≥ 0.85 for is_bot
//
// Text content alone is NOT scored locally (short chat is human noise).
// ============================================================================

function hasKnownProfileCounts(replyData) {
	const followers = Number(replyData?.followers);
	const following = Number(replyData?.following);
	// 0/0 usually means "not loaded yet", not a real zero-follower farm
	return (
		(Number.isFinite(followers) && followers > 0) ||
		(Number.isFinite(following) && following > 0)
	);
}

function accountAgeDays(createdAt) {
	if (!createdAt) return null;
	const t = Date.parse(String(createdAt));
	if (!Number.isFinite(t)) return null;
	return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

/**
 * Local classify: profile gates only. Returns null → AI or leave unknown.
 * Never fires for hard-trust (caller + belt-and-suspenders).
 */
function localClassify(replyData) {
	const tier = String(replyData?.trustTier || "none");
	if (tier === "mutual" || tier === "following" || tier === "whitelist") {
		return null;
	}
	if (replyData?.userFollows === true) return null;
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
	if (replyData?.isVerified) return null;

	// Gate A — extreme follow-farm ratio (classic metadata signal)
	const ratioHit = classifyExtremeFarmProfile(replyData);
	if (ratioHit) return ratioHit;

	// Gate B — brand-new mass-follow shell (age + ratio + default avatar)
	const shellHit = classifyNewShellFarm(replyData);
	if (shellHit) return shellHit;

	return null;
}

/**
 * Gate A: following ≫ followers at extreme scale.
 * Mild high-following is normal (media, founders) — not a bot.
 */
function classifyExtremeFarmProfile(replyData) {
	if (!hasKnownProfileCounts(replyData)) return null;
	const followers = Math.max(0, Number(replyData?.followers) || 0);
	const following = Math.max(0, Number(replyData?.following) || 0);
	if (following < 2500) return null;
	const ratio = following / Math.max(followers, 1);
	if (!(followers < 120 && ratio >= 30)) return null;

	const ratioLabel = `${Math.round(ratio)}:1`;
	return makeLocalVerdict({
		isBot: true,
		isSlop: true,
		confidence: 0.9,
		category: "airdrop_farmer",
		reason: `Extreme follow-farm profile: following ${following} vs ${followers} followers (${ratioLabel})`,
		signals: [
			"profile_ratio_extreme",
			`following_${following}`,
			`followers_${followers}`,
		],
	});
}

/**
 * Gate B: very new account + mass following + tiny audience + default avatar.
 * Stacked signals only — any missing field → no call.
 */
function classifyNewShellFarm(replyData) {
	if (!hasKnownProfileCounts(replyData)) return null;
	if (replyData?.hasCustomAvatar !== false) return null; // need known default avatar
	const age = accountAgeDays(replyData?.accountCreatedAt);
	if (age == null || age > 45) return null;

	const followers = Math.max(0, Number(replyData?.followers) || 0);
	const following = Math.max(0, Number(replyData?.following) || 0);
	if (following < 1500 || followers >= 80) return null;
	const ratio = following / Math.max(followers, 1);
	if (ratio < 20) return null;

	return makeLocalVerdict({
		isBot: true,
		isSlop: true,
		confidence: 0.88,
		category: "airdrop_farmer",
		reason: `New shell account (~${Math.round(age)}d) mass-following with default avatar`,
		signals: [
			"profile_new_shell",
			`age_days_${Math.round(age)}`,
			`ratio_${Math.round(ratio)}`,
		],
	});
}

/** @deprecated use classifyExtremeFarmProfile — kept for imports/tests */
function classifyFollowRatio(replyData) {
	return classifyExtremeFarmProfile(replyData);
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

/** Whether (self, peer) should join the same look-alike spam cluster. */
function isThreadMatch(self, peerEntry, score) {
	const sharedDist = sharedDistinctiveCount(self.tokens, peerEntry.tokens);
	const selfLow = isLowFollowerProfile(self.followers);
	const peerLow = isLowFollowerProfile(peerEntry.followers);
	const bothLow = selfLow && peerLow;
	const eitherLow = selfLow || peerLow;
	// Easier join if peer is already in a spam cluster (3rd/4th alt in a ring)
	const peerInCluster = Boolean(peerEntry.clusterId);
	const joinBoost = peerInCluster ? 0.06 : 0;

	if (score >= 0.42 - joinBoost && bothLow) return { hit: true, bothLow, eitherLow, sharedDist };
	if (score >= 0.4 - joinBoost && eitherLow && sharedDist >= 3) {
		return { hit: true, bothLow, eitherLow, sharedDist };
	}
	if (score >= 0.5 - joinBoost && sharedDist >= 3) {
		return { hit: true, bothLow, eitherLow, sharedDist };
	}
	if (score >= 0.38 && bothLow && sharedDist >= 3) {
		return { hit: true, bothLow, eitherLow, sharedDist };
	}
	// Already-clustered peer + solid paraphrase → absorb into ring
	if (peerInCluster && score >= 0.34 && sharedDist >= 3) {
		return { hit: true, bothLow, eitherLow, sharedDist };
	}
	return { hit: false, bothLow, eitherLow, sharedDist };
}

function isHardTrustUser(username) {
	if (
		typeof window !== "undefined" &&
		window.BotLegitimacy?.isHardTrustTier?.(
			window.BotLegitimacy.getTrustTier?.(username),
		)
	) {
		return true;
	}
	return false;
}

/**
 * Expand to full cluster: all accounts already sharing a clusterId with any match,
 * plus every direct match above threshold (handles 3+ paraphrased alts).
 */
function collectClusterMembers(map, key, self, directMatches) {
	const members = new Set([key]);
	const clusterIds = new Set();

	for (const m of directMatches) {
		members.add(m.otherUser);
		if (m.entry.clusterId) clusterIds.add(m.entry.clusterId);
	}
	if (self.clusterId) clusterIds.add(self.clusterId);

	// Union everyone already tagged with those cluster ids
	if (clusterIds.size > 0) {
		for (const [user, entry] of map.entries()) {
			if (entry.clusterId && clusterIds.has(entry.clusterId)) {
				members.add(user);
			}
		}
	}

	// Transitive: anyone matching any current member at a relaxed threshold
	let grew = true;
	while (grew) {
		grew = false;
		const snapshot = [...members];
		for (const [user, entry] of map.entries()) {
			if (members.has(user) || isHardTrustUser(user)) continue;
			for (const memberUser of snapshot) {
				const memberEntry = memberUser === key ? self : map.get(memberUser);
				if (!memberEntry) continue;
				const score = replySimilarity(entry, memberEntry);
				const sharedDist = sharedDistinctiveCount(entry.tokens, memberEntry.tokens);
				// Relaxed expansion once we have a seed pair (cluster rings)
				if (
					(score >= 0.36 && sharedDist >= 3) ||
					(score >= 0.4 && sharedDist >= 2) ||
					(score >= 0.34 &&
						isLowFollowerProfile(entry.followers) &&
						isLowFollowerProfile(memberEntry.followers) &&
						sharedDist >= 3)
				) {
					members.add(user);
					grew = true;
					break;
				}
			}
		}
	}

	return [...members].filter((u) => !isHardTrustUser(u));
}

/**
 * On /status/ pages only: detect near-duplicate reply *clusters* (2+ alts).
 * Soft-flags the whole ring; never overrides hard-trust.
 *
 * @returns {{ verdict: object, peerUsernames: string[], clusterSize: number, score: number } | null}
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
	if (isHardTrustUser(key)) return null;

	const text = String(replyData?.replyText || "").trim();
	// Need enough substance for paraphrase matching (templates handled elsewhere)
	if (text.length < 48) return null;

	const self = buildReplyIndexEntry(key, replyData);
	if (self.tokens.length < 5) return null;

	const map = ensureThreadRegistry(statusId);
	// Preserve prior cluster membership if re-processing
	const prior = map.get(key);
	if (prior?.clusterId) self.clusterId = prior.clusterId;

	/** @type {{ otherUser: string, score: number, entry: object, match: object }[]} */
	const directMatches = [];
	for (const [otherUser, entry] of map.entries()) {
		if (otherUser === key) continue;
		if (isHardTrustUser(otherUser)) continue;
		const score = replySimilarity(self, entry);
		const match = isThreadMatch(self, entry, score);
		if (match.hit) {
			directMatches.push({ otherUser, score, entry, match });
		}
	}

	// Always register so later alts can join the ring
	map.set(key, self);
	if (map.size > 80) {
		const oldest = [...map.entries()].sort(
			(a, b) => (a[1].registeredAt || 0) - (b[1].registeredAt || 0),
		);
		while (map.size > 60 && oldest.length) {
			map.delete(oldest.shift()[0]);
		}
	}

	if (directMatches.length === 0) return null;

	directMatches.sort((a, b) => b.score - a.score);
	const bestScore = directMatches[0].score;
	const clusterMembers = collectClusterMembers(map, key, self, directMatches);
	if (clusterMembers.length < 2) return null;

	const clusterId =
		self.clusterId ||
		directMatches.find((m) => m.entry.clusterId)?.entry.clusterId ||
		`c_${statusId}_${Date.now().toString(36)}`;

	// Tag entire ring
	for (const member of clusterMembers) {
		const entry = map.get(member);
		if (entry) entry.clusterId = clusterId;
	}
	self.clusterId = clusterId;
	map.set(key, self);

	const peers = clusterMembers.filter((u) => u !== key);
	const lowCount = clusterMembers.filter((u) => {
		const e = u === key ? self : map.get(u);
		return isLowFollowerProfile(e?.followers);
	}).length;
	const mostlyLow = lowCount >= Math.ceil(clusterMembers.length * 0.6);
	const pct = Math.round(bestScore * 100);
	const size = clusterMembers.length;
	const peerSample = peers
		.slice(0, 4)
		.map((p) => `@${p}`)
		.join(", ");
	const more = peers.length > 4 ? ` +${peers.length - 4}` : "";

	const confidence = Math.min(
		0.96,
		0.78 + bestScore * 0.12 + Math.min(0.08, (size - 2) * 0.03),
	);

	const verdict = makeLocalVerdict({
		isBot: true,
		isSlop: true,
		confidence,
		category: "engagement_farmer",
		reason:
			size >= 3
				? `Coordinated reply cluster (${size} look-alikes in this thread, ~${pct}% similar) — ${peerSample}${more}`
				: mostlyLow
					? `Near-duplicate reply cluster with @${peers[0]} in this thread (${pct}% similar) from low-follower accounts`
					: `Near-duplicate reply to @${peers[0]} in this thread (${pct}% similar wording)`,
		signals: [
			"thread_near_duplicate",
			`cluster_size_${size}`,
			`sim_${pct}`,
			...peers.slice(0, 5).map((p) => `peer_${p}`),
			...(mostlyLow ? ["low_followers_cluster"] : []),
		],
	});

	return {
		verdict,
		peerUsernames: peers,
		peerUsername: peers[0] || null, // back-compat
		clusterSize: size,
		clusterId,
		score: bestScore,
	};
}

/**
 * Re-apply a thread-duplicate verdict onto one peer's visible tweet cards.
 */
function applyThreadDuplicateToPeer(peerUsername, verdict) {
	if (!peerUsername || !verdict || typeof document === "undefined") return;
	const peer = String(peerUsername).toLowerCase();
	if (isHardTrustUser(peer)) return;
	let display = verdict;
	try {
		display = window.BotCache?.saveBotCache?.(peer, verdict) || verdict;
	} catch {
		/* ignore */
	}
	document
		.querySelectorAll(`article[data-testid="tweet"][data-bot-username="${peer}"]`)
		.forEach((el) => {
			try {
				window.BotUI?.applyBotUI?.(el, display, peer);
				el.dataset.botProcessed = "bot";
			} catch {
				/* ignore */
			}
		});
}

/** Flag every member of a look-alike cluster (2, 3, N…). */
function applyThreadDuplicateToCluster(peerUsernames, verdict) {
	const peers = Array.isArray(peerUsernames) ? peerUsernames : [];
	for (const peer of peers) {
		applyThreadDuplicateToPeer(peer, verdict);
	}
}

// Export
if (typeof window !== "undefined") {
	window.BotDetection = {
		extractReplyDataFromElement,
		extractOriginalTweetText,
		detectYouFollowFromDom,
		localClassify,
		classifyFollowRatio,
		classifyExtremeFarmProfile,
		classifyNewShellFarm,
		classifyThreadDuplicate,
		applyThreadDuplicateToPeer,
		applyThreadDuplicateToCluster,
		isTweetDetailView,
		getStatusIdFromPath,
		clearThreadReplyRegistry,
		replySimilarity,
		buildReplyIndexEntry,
		shouldClassify,
		hashText,
	};
}
