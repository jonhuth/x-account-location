// Bot Detection - Caching, local prefilter routing, server batching
// Goal: resolve as much as possible without hitting X or the backend

// ============================================================================
// Configuration
// ============================================================================

const BOT_CACHE_KEY = "bot_verdict_cache";
const BOT_ACCOUNT_KEY = "bot_account_scores";
const BOT_OVERRIDES_KEY = "bot_overrides";
const BOT_CACHE_EXPIRY_HIGH_CONF_DAYS = 30;
const BOT_CACHE_EXPIRY_MED_CONF_DAYS = 14;
const BOT_CACHE_EXPIRY_LOW_CONF_DAYS = 7;
const BOT_CACHE_SAVE_INTERVAL = 5000;
const BOT_BATCH_SIZE = 5;
const BOT_BATCH_DELAY = 500;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const BACKEND_URL = "https://x-bot-detector-production.up.railway.app";

// Account reputation: after N consistent hits, skip server
const ACCOUNT_PRIOR_MIN_SAMPLES = 3;
const ACCOUNT_PRIOR_CONF = 0.8;

// ============================================================================
// Cache State
// ============================================================================

const botVerdictCache = new Map(); // username -> last verdict (account-oriented)
const accountScores = new Map(); // username -> rolling reputation
const overrides = new Map(); // username -> { forceHuman, forceBot, forceSlop, updatedAt }
let pendingCacheSave = null;
let pendingAccountSave = null;
let pendingOverrideSave = null;

// ============================================================================
// Batching State
// ============================================================================

const pendingBotRequests = new Map();
const botClassificationQueue = [];
let batchTimeout = null;

// ============================================================================
// Circuit Breaker
// ============================================================================

let backendCircuitOpen = false;
let circuitOpenUntil = 0;
let consecutiveErrors = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BASE_MS = 60000;

// ============================================================================
// Cache Operations
// ============================================================================

async function loadBotCache() {
	try {
		const result = await chrome.storage.local.get([
			BOT_CACHE_KEY,
			BOT_ACCOUNT_KEY,
			BOT_OVERRIDES_KEY,
		]);
		const now = Date.now();

		if (result[BOT_CACHE_KEY]) {
			for (const [username, data] of Object.entries(result[BOT_CACHE_KEY])) {
				if (data?.expiry && data.expiry > now) {
					botVerdictCache.set(username.toLowerCase(), data);
				}
			}
		}

		if (result[BOT_ACCOUNT_KEY]) {
			for (const [username, data] of Object.entries(result[BOT_ACCOUNT_KEY])) {
				if (data) accountScores.set(username.toLowerCase(), data);
			}
		}

		if (result[BOT_OVERRIDES_KEY]) {
			for (const [username, data] of Object.entries(result[BOT_OVERRIDES_KEY])) {
				if (data) overrides.set(username.toLowerCase(), data);
			}
		}
	} catch {
		/* storage error */
	}
}

function saveBotCache(username, verdict) {
	const key = String(username || "").toLowerCase();
	const now = Date.now();
	const confidence = verdict.confidence || 0;

	// Never let short-reply / bot verdicts overwrite mutual or following hard-trust
	const existing = botVerdictCache.get(key);
	const L = typeof window !== "undefined" ? window.BotLegitimacy : null;
	const liveTier = L?.getTrustTier?.(key);
	if (
		L?.isHardTrustTier?.(liveTier) &&
		(verdict.isBot || verdict.isSlop || verdict.source === "local")
	) {
		return;
	}
	if (
		existing &&
		L?.isHardTrustTier?.(existing.trustTier) &&
		!existing.isBot &&
		(verdict.isBot || verdict.isSlop) &&
		verdict.source !== "trust" &&
		verdict.trustTier !== "mutual" &&
		verdict.trustTier !== "following"
	) {
		return;
	}

	let expiryDays;
	if (confidence >= 0.75) expiryDays = BOT_CACHE_EXPIRY_HIGH_CONF_DAYS;
	else if (confidence >= 0.5) expiryDays = BOT_CACHE_EXPIRY_MED_CONF_DAYS;
	else expiryDays = BOT_CACHE_EXPIRY_LOW_CONF_DAYS;

	// Local/trust verdicts are personal — cache but shorter for low-conf local
	if (verdict.source === "local" && confidence < 0.85) {
		expiryDays = Math.min(expiryDays, 3);
	}
	if (verdict.source === "trust" || verdict.source === "override") {
		expiryDays = BOT_CACHE_EXPIRY_HIGH_CONF_DAYS;
	}

	const expiry = now + expiryDays * 24 * 60 * 60 * 1000;

	botVerdictCache.set(key, {
		...normalizeVerdict(verdict),
		expiry,
		cachedAt: now,
	});

	updateAccountScore(key, verdict);

	if (!pendingCacheSave) {
		pendingCacheSave = setTimeout(async () => {
			await persistBotCache();
			pendingCacheSave = null;
		}, BOT_CACHE_SAVE_INTERVAL);
	}
}

function normalizeVerdict(verdict) {
	return {
		isBot: Boolean(verdict.isBot),
		isSlop: Boolean(verdict.isSlop),
		confidence: Math.min(1, Math.max(0, Number(verdict.confidence) || 0)),
		category: verdict.category || "genuine",
		reason: String(verdict.reason || ""),
		signals: Array.isArray(verdict.signals) ? verdict.signals.slice(0, 8) : [],
		source: verdict.source || "ai",
		trustTier: verdict.trustTier || "none",
		accountScore:
			verdict.accountScore != null ? Number(verdict.accountScore) : null,
		replyScore: verdict.replyScore != null ? Number(verdict.replyScore) : null,
	};
}

async function persistBotCache() {
	try {
		const cacheObj = {};
		for (const [username, data] of botVerdictCache.entries()) {
			cacheObj[username] = data;
		}
		await chrome.storage.local.set({ [BOT_CACHE_KEY]: cacheObj });
	} catch {
		/* storage error */
	}
}

function getCachedVerdict(username) {
	const key = String(username || "").toLowerCase();
	const cached = botVerdictCache.get(key);

	if (cached && cached.expiry && cached.expiry > Date.now()) {
		return cached;
	}

	if (cached) botVerdictCache.delete(key);
	return null;
}

// ============================================================================
// Account reputation (reply vs account split)
// ============================================================================

function updateAccountScore(username, verdict) {
	const key = username.toLowerCase();
	const prev = accountScores.get(key) || {
		botHits: 0,
		genuineHits: 0,
		slopHits: 0,
		samples: 0,
		avgBotConf: 0,
		lastCategory: "genuine",
		isBot: false,
		isSlop: false,
		updatedAt: 0,
	};

	const conf = Number(verdict.confidence) || 0;
	const samples = prev.samples + 1;
	const botHits = prev.botHits + (verdict.isBot ? 1 : 0);
	const genuineHits = prev.genuineHits + (!verdict.isBot ? 1 : 0);
	const slopHits = prev.slopHits + (verdict.isSlop ? 1 : 0);
	const avgBotConf =
		(prev.avgBotConf * prev.samples + (verdict.isBot ? conf : 1 - conf)) /
		samples;

	const isBot = botHits > genuineHits && botHits >= 2;
	const isSlop = slopHits >= 2 || (verdict.isSlop && conf >= 0.8);

	accountScores.set(key, {
		botHits,
		genuineHits,
		slopHits,
		samples,
		avgBotConf,
		lastCategory: verdict.category || prev.lastCategory,
		isBot,
		isSlop,
		updatedAt: Date.now(),
	});

	if (!pendingAccountSave) {
		pendingAccountSave = setTimeout(async () => {
			await persistAccountScores();
			pendingAccountSave = null;
		}, BOT_CACHE_SAVE_INTERVAL);
	}
}

async function persistAccountScores() {
	try {
		const obj = {};
		for (const [k, v] of accountScores.entries()) obj[k] = v;
		await chrome.storage.local.set({ [BOT_ACCOUNT_KEY]: obj });
	} catch {
		/* ignore */
	}
}

/**
 * Strong account prior — skip server when we already know this account well.
 * Does not apply to overrides / follows (caller handles those first).
 */
function getAccountPriorVerdict(username) {
	const key = String(username || "").toLowerCase();
	const score = accountScores.get(key);
	if (!score || score.samples < ACCOUNT_PRIOR_MIN_SAMPLES) return null;
	if (score.avgBotConf < ACCOUNT_PRIOR_CONF && !score.isBot) {
		// Strong human prior
		if (score.genuineHits >= ACCOUNT_PRIOR_MIN_SAMPLES && !score.isBot) {
			return {
				isBot: false,
				isSlop: Boolean(score.isSlop),
				confidence: Math.min(0.9, 0.55 + score.avgBotConf * 0.4),
				category: score.isSlop ? "llm_slop" : "genuine",
				reason: score.isSlop
					? "Account often posts slop (local prior)"
					: "Consistent human prior from prior replies",
				signals: ["account_prior_human"],
				source: "account_prior",
				accountScore: score.avgBotConf,
				replyScore: null,
			};
		}
		return null;
	}
	if (score.isBot && score.botHits >= ACCOUNT_PRIOR_MIN_SAMPLES) {
		return {
			isBot: true,
			isSlop: Boolean(score.isSlop),
			confidence: Math.min(0.92, score.avgBotConf),
			category: score.lastCategory || "crypto_spam",
			reason: "Repeated bot/slop pattern on this account",
			signals: ["account_prior_bot"],
			source: "account_prior",
			accountScore: score.avgBotConf,
			replyScore: null,
		};
	}
	return null;
}

function getAccountScore(username) {
	return accountScores.get(String(username || "").toLowerCase()) || null;
}

// ============================================================================
// Personal overrides (feedback loop)
// ============================================================================

async function setOverride(username, patch) {
	const key = String(username || "").toLowerCase();
	const prev = overrides.get(key) || {};
	const next = {
		forceHuman: false,
		forceBot: false,
		forceSlop: false,
		...prev,
		...patch,
		updatedAt: Date.now(),
	};
	// Mutual exclusion
	if (next.forceHuman) {
		next.forceBot = false;
	}
	if (next.forceBot) {
		next.forceHuman = false;
	}
	overrides.set(key, next);
	botVerdictCache.delete(key);

	if (!pendingOverrideSave) {
		pendingOverrideSave = setTimeout(async () => {
			await persistOverrides();
			pendingOverrideSave = null;
		}, 200);
	} else {
		await persistOverrides();
	}

	return next;
}

async function clearOverride(username) {
	overrides.delete(String(username || "").toLowerCase());
	await persistOverrides();
}

async function persistOverrides() {
	try {
		const obj = {};
		for (const [k, v] of overrides.entries()) obj[k] = v;
		await chrome.storage.local.set({ [BOT_OVERRIDES_KEY]: obj });
	} catch {
		/* ignore */
	}
}

function getOverride(username) {
	return overrides.get(String(username || "").toLowerCase()) || null;
}

function getOverrideVerdict(username) {
	const o = getOverride(username);
	if (!o) return null;
	if (o.forceHuman) {
		return {
			isBot: false,
			isSlop: Boolean(o.forceSlop),
			confidence: 0.99,
			category: o.forceSlop ? "llm_slop" : "genuine",
			reason: "You marked this account as human",
			signals: ["user_override_human"],
			source: "override",
			trustTier: "override_human",
		};
	}
	if (o.forceBot) {
		return {
			isBot: true,
			isSlop: true,
			confidence: 0.99,
			category: "crypto_spam",
			reason: "You marked this account as bot",
			signals: ["user_override_bot"],
			source: "override",
			trustTier: "override_bot",
		};
	}
	if (o.forceSlop) {
		return {
			isBot: false,
			isSlop: true,
			confidence: 0.9,
			category: "llm_slop",
			reason: "You marked this account as slop",
			signals: ["user_override_slop"],
			source: "override",
			trustTier: "override_slop",
		};
	}
	return null;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

function isCircuitOpen() {
	if (!backendCircuitOpen) return false;
	if (Date.now() >= circuitOpenUntil) {
		backendCircuitOpen = false;
		return false;
	}
	return true;
}

function recordSuccess() {
	consecutiveErrors = 0;
	backendCircuitOpen = false;
}

function recordError() {
	consecutiveErrors++;
	if (consecutiveErrors >= CIRCUIT_THRESHOLD && !backendCircuitOpen) {
		backendCircuitOpen = true;
		const backoffMs =
			CIRCUIT_BASE_MS * Math.pow(2, consecutiveErrors - CIRCUIT_THRESHOLD);
		circuitOpenUntil = Date.now() + Math.min(backoffMs, 300000);
	}
}

// ============================================================================
// Fetch helpers
// ============================================================================

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		clearTimeout(timeout);
		return response;
	} catch (e) {
		clearTimeout(timeout);
		if (e.name === "AbortError") throw new Error("Request timeout");
		throw e;
	}
}

async function classifyWithRetry(replyData, retries = MAX_RETRIES) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const response = await fetchWithTimeout(`${BACKEND_URL}/api/classify`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ replies: [replyData] }),
			});

			if (!response.ok) throw new Error(`Server error: ${response.status}`);

			const data = await response.json();
			return data.verdicts?.[0] || null;
		} catch (e) {
			if (attempt === retries) throw e;
			await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
		}
	}
	return null;
}

// ============================================================================
// Main resolve path — local first, then server
// ============================================================================

/**
 * Resolve a verdict with zero X load and minimal backend load.
 * Order: override → whitelist → mutual/follow hard-trust → cache → local template → account prior → server
 *
 * Mutual follow is the strongest positive signal we have. Short engagement
 * templates (localClassify) and reply-level slop must never demote mutuals or
 * accounts you follow.
 */
function resolveLocally(username, replyData, opts = {}) {
	const key = String(username || "").toLowerCase();
	const L = typeof window !== "undefined" ? window.BotLegitimacy : null;

	// 1. Personal override (explicit user judgment wins)
	const overrideV = getOverrideVerdict(key);
	if (overrideV) return overrideV;

	// 2. Whitelist
	if (isWhitelisted(key)) {
		return {
			isBot: false,
			isSlop: false,
			confidence: 1,
			category: "genuine",
			reason: "Whitelisted",
			signals: ["whitelist"],
			source: "trust",
			trustTier: "whitelist",
		};
	}

	// 3. Social hard-trust: mutual > following (personalized — never multi-tenant)
	const userFollows =
		opts.userFollows === true ||
		replyData?.userFollows === true ||
		Boolean(L?.isFollowedByUser?.(key));
	const isMutual =
		opts.isMutual === true ||
		replyData?.trustTier === "mutual" ||
		Boolean(L?.isMutualWithUser?.(key));
	const trustTier =
		opts.trustTier ||
		(isMutual ? "mutual" : userFollows ? "following" : L?.getTrustTier?.(key) || "none");

	if (trustTier === "mutual" || trustTier === "following" || userFollows || isMutual) {
		const tier = isMutual || trustTier === "mutual" ? "mutual" : "following";
		return (
			L?.createTrustVerdict?.(key, tier) ||
			L?.createFollowTrustVerdict?.(key) || {
				isBot: false,
				isSlop: false,
				confidence: tier === "mutual" ? 0.99 : 0.96,
				category: "genuine",
				reason:
					tier === "mutual"
						? "Mutual follow — highest trust signal"
						: "Account you follow",
				signals:
					tier === "mutual"
						? ["mutual_follow", "user_follows", "followed_by", "hard_trust"]
						: ["user_follows", "hard_trust"],
				source: "trust",
				trustTier: tier,
			}
		);
	}

	// 4. Session/storage cache
	const cached = getCachedVerdict(key);
	if (cached && opts.allowCache !== false) {
		// Never keep a cached bot/slop if we somehow have hard-trust on the verdict already
		if (
			(cached.trustTier === "mutual" ||
				cached.trustTier === "following" ||
				cached.source === "trust") &&
			!cached.isBot
		) {
			return cached;
		}

		// Short-reply local filters may upgrade *strangers* from stale human → slop,
		// but must never run against hard-trust tiers (handled above).
		const local = window.BotDetection?.localClassify?.(replyData);
		if (local && local.isSlop && !cached.isBot && !cached.isSlop) {
			// Guard: if cached says trust, keep trust
			if (L?.isHardTrustTier?.(cached.trustTier)) {
				return cached;
			}
			return { ...local, accountScore: cached.accountScore };
		}
		return cached;
	}

	// 5. Local template prefilter (short comments / engagement farm) — strangers only
	const local = window.BotDetection?.localClassify?.(replyData);
	if (local) return local;

	// 6. Strong account prior (never applied to hard-trust — already returned)
	const prior = getAccountPriorVerdict(key);
	if (prior) return prior;

	return null; // needs server
}

function queueForClassification(username, replyData) {
	const key = String(username || "").toLowerCase();

	// Coalesce
	if (pendingBotRequests.has(key)) {
		return pendingBotRequests.get(key);
	}

	// Fast path — no network
	const localVerdict = resolveLocally(key, replyData, {
		userFollows: replyData?.userFollows,
	});
	if (localVerdict && localVerdict.source !== "cache") {
		// cache hits also return from resolveLocally with full object
	}
	if (localVerdict) {
		// Always persist non-cache resolutions
		if (localVerdict.source !== "cache" && !localVerdict.expiry) {
			saveBotCache(key, localVerdict);
		}
		return Promise.resolve(localVerdict);
	}

	// Also handle pure cache from resolveLocally when allowCache default
	// (already returned above if present)

	const promise = new Promise((resolve) => {
		botClassificationQueue.push({
			username: key,
			replyData,
			resolve,
		});

		if (botClassificationQueue.length >= BOT_BATCH_SIZE) {
			if (batchTimeout) {
				clearTimeout(batchTimeout);
				batchTimeout = null;
			}
			setTimeout(dispatchBatch, 0);
		} else if (!batchTimeout) {
			batchTimeout = setTimeout(dispatchBatch, BOT_BATCH_DELAY);
		}
	});

	pendingBotRequests.set(key, promise);
	return promise;
}

async function dispatchBatch() {
	if (batchTimeout) {
		clearTimeout(batchTimeout);
		batchTimeout = null;
	}

	const batch = botClassificationQueue.splice(0, BOT_BATCH_SIZE);
	if (batch.length === 0) return;

	if (isCircuitOpen()) {
		batch.forEach((item) => {
			const fallback = createFallbackVerdict("circuit_open");
			pendingBotRequests.delete(item.username);
			item.resolve(fallback);
		});
		return;
	}

	try {
		// Strip personalized fields that shouldn't poison multi-tenant server cache
		const payload = batch.map((b) => sanitizeForServer(b.replyData));

		const response = await fetchWithTimeout(`${BACKEND_URL}/api/classify`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ replies: payload }),
		});

		if (!response.ok) throw new Error(`Backend error: ${response.status}`);

		const data = await response.json();
		recordSuccess();

		const verdicts = data.verdicts || [];

		for (let i = 0; i < batch.length; i++) {
			const item = batch[i];
			let verdict = verdicts[i];

			if (verdict) {
				verdict = mergeReplyAccountScores(item.username, verdict);
				saveBotCache(item.username, verdict);
				pendingBotRequests.delete(item.username);
				item.resolve(verdict);
			} else {
				retryIndividual(item);
			}
		}
	} catch {
		recordError();
		for (const item of batch) retryIndividual(item);
	}
}

function sanitizeForServer(replyData) {
	// Never send userFollows to shared backend cache path — follow trust is client-only.
	// Keep original tweet + profile fields for better classification.
	const r = replyData || {};
	return {
		username: String(r.username || "").toLowerCase(),
		displayName: r.displayName || r.username || "",
		replyText: r.replyText || "",
		originalTweetText: r.originalTweetText || "",
		bio: r.bio || "",
		followers: Number(r.followers) || 0,
		following: Number(r.following) || 0,
		accountCreatedAt: r.accountCreatedAt || r.createdAt || "",
		hasCustomAvatar: r.hasCustomAvatar ?? true,
		isVerified: Boolean(r.isVerified),
		location: r.location || null,
		secondsAfterOriginal: Number(r.secondsAfterOriginal) || 0,
		heuristicScore: Number(r.heuristicScore) || 0,
		userFollows: false,
		mutualCount: 0,
	};
}

function mergeReplyAccountScores(username, verdict) {
	const score = accountScores.get(username.toLowerCase());
	const conf = Number(verdict.confidence) || 0;
	const replyScore = verdict.isBot ? conf : 1 - conf;
	const accountScore = score
		? score.avgBotConf
		: replyScore;
	return {
		...normalizeVerdict(verdict),
		replyScore,
		accountScore,
		isSlop: Boolean(verdict.isSlop),
	};
}

async function retryIndividual(item) {
	try {
		const verdict = await classifyWithRetry(
			sanitizeForServer(item.replyData),
			1,
		);
		if (verdict) {
			const merged = mergeReplyAccountScores(item.username, verdict);
			saveBotCache(item.username, merged);
			pendingBotRequests.delete(item.username);
			item.resolve(merged);
		} else {
			const fallback = createFallbackVerdict("retry_failed");
			pendingBotRequests.delete(item.username);
			item.resolve(fallback);
		}
	} catch {
		const fallback = createFallbackVerdict("error");
		pendingBotRequests.delete(item.username);
		item.resolve(fallback);
	}
}

function createFallbackVerdict(source) {
	return {
		isBot: false,
		isSlop: false,
		confidence: 0,
		category: "genuine",
		reason: `Classification unavailable (${source})`,
		signals: [],
		source: "fallback",
	};
}

// ============================================================================
// Lookup (popup)
// ============================================================================

async function lookupUsername(username, context = {}) {
	const key = String(username || "").toLowerCase();

	const local = resolveLocally(
		key,
		{
			username: key,
			displayName: context.displayName || username,
			replyText: context.replyText || "",
			userFollows: context.userFollows,
		},
		{ userFollows: context.userFollows },
	);
	if (local) return { ...local, cached: local.source === "cache" || !!local.expiry };

	if (isCircuitOpen()) {
		return { ...createFallbackVerdict("circuit_open"), cached: false };
	}

	try {
		const verdict = await classifyWithRetry(
			sanitizeForServer({
				username: key,
				displayName: context.displayName || username,
				replyText: context.replyText || "",
				bio: context.bio || "",
				followers: context.followers || 0,
				following: context.following || 0,
				hasCustomAvatar: context.hasCustomAvatar ?? true,
				isVerified: context.isVerified ?? false,
			}),
		);

		if (verdict) {
			const merged = mergeReplyAccountScores(key, verdict);
			saveBotCache(key, merged);
			recordSuccess();
			return { ...merged, cached: false };
		}

		return { ...createFallbackVerdict("no_verdict"), cached: false };
	} catch {
		recordError();
		return { ...createFallbackVerdict("error"), cached: false };
	}
}

// ============================================================================
// Whitelist
// ============================================================================

const WHITELIST_KEY = "bot_whitelist";
let whitelistSet = new Set();

async function loadWhitelist() {
	try {
		const result = await chrome.storage.local.get(WHITELIST_KEY);
		if (result[WHITELIST_KEY]) {
			whitelistSet = new Set(
				result[WHITELIST_KEY].map((u) => String(u).toLowerCase()),
			);
		}
	} catch {
		/* storage error */
	}
}

async function addToWhitelist(username) {
	const key = String(username || "").toLowerCase();
	whitelistSet.add(key);
	botVerdictCache.delete(key);
	await setOverride(key, { forceHuman: true, forceBot: false, forceSlop: false });

	try {
		await Promise.all([
			chrome.storage.local.set({ [WHITELIST_KEY]: Array.from(whitelistSet) }),
			persistBotCache(),
		]);
	} catch {
		/* storage error */
	}
}

async function removeFromWhitelist(username) {
	const key = String(username || "").toLowerCase();
	whitelistSet.delete(key);
	await clearOverride(key);
	try {
		await chrome.storage.local.set({
			[WHITELIST_KEY]: Array.from(whitelistSet),
		});
	} catch {
		/* storage error */
	}
}

function isWhitelisted(username) {
	return whitelistSet.has(String(username || "").toLowerCase());
}

function getWhitelist() {
	return Array.from(whitelistSet);
}

// ============================================================================
// Stats
// ============================================================================

function getBotStats() {
	let bots = 0;
	let humans = 0;
	let slop = 0;
	const categories = {};

	for (const [, verdict] of botVerdictCache.entries()) {
		if (verdict.isBot) {
			bots++;
			const cat = verdict.category || "unknown";
			categories[cat] = (categories[cat] || 0) + 1;
		} else {
			humans++;
		}
		if (verdict.isSlop) slop++;
	}

	return { bots, humans, slop, categories, total: bots + humans };
}

// ============================================================================
// Export
// ============================================================================

if (typeof window !== "undefined") {
	window.BotCache = {
		loadBotCache,
		loadWhitelist,
		getCachedVerdict,
		saveBotCache,
		persistBotCache,
		queueForClassification,
		resolveLocally,
		lookupUsername,
		addToWhitelist,
		removeFromWhitelist,
		isWhitelisted,
		getWhitelist,
		getBotStats,
		setOverride,
		clearOverride,
		getOverride,
		getOverrideVerdict,
		getAccountScore,
		getAccountPriorVerdict,
		BACKEND_URL,
		isCircuitOpen,
		pendingCount: () => pendingBotRequests.size,
		queueLength: () => botClassificationQueue.length,
	};
}
