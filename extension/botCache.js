// Bot Detection - Caching, local prefilter routing, server batching
// Goal: resolve as much as possible without hitting X or the backend

// ============================================================================
// Configuration
// ============================================================================

const BOT_CACHE_KEY = "bot_verdict_cache";
const BOT_ACCOUNT_KEY = "bot_account_scores";
const BOT_OVERRIDES_KEY = "bot_overrides";
// Scored strangers (AI/local) — rolling TTLs
const BOT_CACHE_EXPIRY_HIGH_CONF_DAYS = 30;
const BOT_CACHE_EXPIRY_MED_CONF_DAYS = 14;
const BOT_CACHE_EXPIRY_LOW_CONF_DAYS = 7;
// Pinned judgments must survive restarts and must never force recompute
const BOT_CACHE_EXPIRY_PINNED_DAYS = 3650; // ~10 years — overrides, whitelist, follows
const BOT_CACHE_SAVE_INTERVAL = 5000;
const BOT_BATCH_SIZE = 5;
const BOT_BATCH_DELAY = 500;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const BACKEND_URL = "https://x-bot-detector-production.up.railway.app";

// Account reputation: after N consistent hits, skip server
const ACCOUNT_PRIOR_MIN_SAMPLES = 3;
const ACCOUNT_PRIOR_CONF = 0.8;
/** Min conf for isBot anywhere (local/AI/account). Below this → human/slop. */
const BOT_MIN_CONF = 0.85;

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
			let purged = false;
			for (const [username, data] of Object.entries(result[BOT_CACHE_KEY])) {
				if (!data || isUnknownVerdict(data)) {
					purged = true;
					continue;
				}
				// Pinned (follow / your Human mark) always reload — never drop on TTL
				if (isHardPinnedVerdict(data)) {
					botVerdictCache.set(username.toLowerCase(), data);
					continue;
				}
				// Drop legacy over-aggressive bot FPs (old local "true"/"gm" = bot)
				const cleaned = sanitizeIncomingVerdict(data);
				if (
					data.isBot &&
					(!cleaned?.isBot ||
						data.source === "local" && Number(data.confidence) < 0.85)
				) {
					// Re-eval next sighting under human-default rules
					purged = true;
					continue;
				}
				if (data.expiry && data.expiry > now) {
					botVerdictCache.set(username.toLowerCase(), cleaned || data);
				} else {
					purged = true; // expired stranger score
				}
			}
			// Rewrite storage without legacy conf=0 poison / expired junk
			if (purged) {
				pendingCacheSave = setTimeout(async () => {
					await persistBotCache();
					pendingCacheSave = null;
				}, 250);
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

/** Unusable classify result — must not be persisted as a real human score of 0. */
function isUnknownVerdict(verdict) {
	if (!verdict) return true;
	if (verdict.unknown === true || verdict.source === "fallback") return true;
	if (verdict.isBot || verdict.isSlop) return false;
	if (
		verdict.source === "trust" ||
		verdict.source === "override" ||
		verdict.trustTier === "mutual" ||
		verdict.trustTier === "following" ||
		verdict.trustTier === "whitelist" ||
		verdict.trustTier === "override_human"
	) {
		return false;
	}
	const conf = Number(verdict.confidence);
	return !Number.isFinite(conf) || conf <= 0;
}

/**
 * Reply-level classify confidences (AI/local) vary by post. The chip must be
 * **account-level**: same @user → same number everywhere. We fold each reply
 * into a rolling bot-likeness, then derive one display verdict.
 */
function replyBotness(verdict) {
	const conf = Math.min(1, Math.max(0, Number(verdict?.confidence) || 0));
	if (verdict?.isBot) return conf;
	if (verdict?.isSlop) return Math.min(0.85, 0.4 + conf * 0.35);
	return 1 - conf; // high human conf → low bot-likeness
}

function clamp01(n, lo = 0, hi = 1) {
	return Math.min(hi, Math.max(lo, n));
}

function isHardPinnedVerdict(verdict) {
	if (!verdict) return false;
	if (verdict.pinned === true) return true;
	if (verdict.source === "trust" || verdict.source === "override") return true;
	const tier = verdict.trustTier;
	return (
		tier === "mutual" ||
		tier === "following" ||
		tier === "whitelist" ||
		tier === "override_human" ||
		tier === "override_bot" ||
		tier === "override_slop"
	);
}

/**
 * Accounts we must never send to AI / local recompute.
 * - Your Human/Bot/Slop mark (override)
 * - Whitelist
 * - You follow / mutual (live set or cached trust chip)
 */
function isPinnedAccount(username) {
	const key = String(username || "").toLowerCase();
	if (!key) return false;
	if (getOverride(key)) return true;
	if (isWhitelisted(key)) return true;
	const L = typeof window !== "undefined" ? window.BotLegitimacy : null;
	if (L?.isFollowedByUser?.(key) || L?.isMutualWithUser?.(key)) return true;
	const cached = botVerdictCache.get(key);
	if (cached && isHardPinnedVerdict(cached) && !isUnknownVerdict(cached)) {
		// Pinned entries ignore expiry for "do we recompute?" decisions
		return true;
	}
	return false;
}

/**
 * Pure lookup: verdict we already know for this @user.
 * Used as the first step of tweet processing — paint only, no network, no local AI.
 * Returns null only when we still need to classify.
 */
function getKnownVerdict(username) {
	const key = String(username || "").toLowerCase();
	if (!key) return null;
	const L = typeof window !== "undefined" ? window.BotLegitimacy : null;

	// 1. Explicit mark (Human / Bot / Slop) — permanent
	const overrideV = getOverrideVerdict(key);
	if (overrideV) return { ...overrideV, pinned: true };

	// 2. Whitelist
	if (isWhitelisted(key)) {
		return {
			isBot: false,
			isSlop: false,
			confidence: 1,
			category: "genuine",
			reason: "You marked this account as human",
			signals: ["whitelist"],
			source: "trust",
			trustTier: "whitelist",
			pinned: true,
		};
	}

	// 3. Live follow / mutual
	const liveTier = L?.getTrustTier?.(key);
	if (L?.isHardTrustTier?.(liveTier)) {
		const v =
			L.createTrustVerdict?.(key, liveTier) || {
				isBot: false,
				isSlop: false,
				confidence: 1,
				category: "genuine",
				reason: "You follow this account (hard trust — not scored)",
				signals: ["user_follows", "hard_trust"],
				source: "trust",
				trustTier: liveTier,
			};
		return { ...v, pinned: true };
	}

	// 4. Durable cache (including expired pinned — never recompute marks/follows)
	const cached = botVerdictCache.get(key);
	if (cached && !isUnknownVerdict(cached)) {
		if (isHardPinnedVerdict(cached)) {
			return { ...cached, pinned: true };
		}
		// Non-pinned scored accounts: honor TTL
		if (cached.expiry && cached.expiry > Date.now()) {
			return cached;
		}
	}

	return null;
}

/**
 * Account chip from latest seed + rolling score.
 * Simple rule: strong bot sticks only with strong conf; humans win ties.
 */
function stabilizeAccountVerdict(username, seed) {
	const key = String(username || "").toLowerCase();
	const existing = botVerdictCache.get(key);
	const score = accountScores.get(key);
	const seedN = normalizeVerdict(seed);
	const replyScore = replyBotness(seedN);

	if (isHardPinnedVerdict(seedN)) {
		return {
			...seedN,
			accountScore: seedN.isBot ? seedN.confidence : 1 - seedN.confidence,
			replyScore,
		};
	}
	if (existing && isHardPinnedVerdict(existing) && !isHardPinnedVerdict(seedN)) {
		return { ...normalizeVerdict(existing), replyScore };
	}

	const samples = score?.samples || 0;
	const avg = clamp01(Number(score?.avgBotConf) || replyScore);
	const strongBot =
		Boolean(seedN.isBot) && Number(seedN.confidence) >= BOT_MIN_CONF;

	// Account bot only if this seed is strong OR we already have 2+ strong hits
	const isBot =
		strongBot ||
		(Boolean(score?.isBot) && (score?.botHits || 0) >= 2 && avg >= 0.8);

	// Slop is optional mild label — never upgrades to bot here
	const isSlop =
		!isBot &&
		Boolean(seedN.isSlop) &&
		Number(seedN.confidence) >= 0.7 &&
		(samples <= 1 || (score?.slopHits || 0) >= 1);

	let confidence;
	if (isBot) {
		confidence = clamp01(
			Math.max(avg, Number(seedN.confidence) || 0),
			BOT_MIN_CONF,
			0.99,
		);
	} else if (isSlop) {
		confidence = clamp01(Number(seedN.confidence) || 0.7, 0.65, 0.9);
	} else {
		confidence = clamp01(1 - avg * 0.4, 0.8, 0.99);
	}

	return normalizeVerdict({
		isBot,
		isSlop,
		confidence,
		category: isBot
			? seedN.category || score?.lastCategory || "airdrop_farmer"
			: isSlop
				? "llm_slop"
				: "genuine",
		reason: seedN.reason || existing?.reason || "Account score",
		signals: Array.isArray(seedN.signals) ? seedN.signals.slice(0, 6) : [],
		source: samples >= 2 ? "account" : seedN.source || "ai",
		trustTier: seedN.trustTier || existing?.trustTier || "none",
		accountScore: avg,
		replyScore,
	});
}

/**
 * Persist + stabilize. Returns the **account-level** verdict that should be shown
 * on every post by this user (or null if skipped).
 *
 * Pinned (override / whitelist / follow) → ~10y TTL, never overwritten by AI/local.
 * Scored strangers → shorter TTL, account-stable confidence.
 */
function saveBotCache(username, verdict) {
	const key = String(username || "").toLowerCase();
	const now = Date.now();

	// Sanitize weak bot FPs before any persistence
	verdict = sanitizeIncomingVerdict(verdict);
	if (!verdict || isUnknownVerdict(verdict)) return null;

	// Never let short-reply / bot verdicts overwrite mutual or following hard-trust
	const existing = botVerdictCache.get(key);
	const L = typeof window !== "undefined" ? window.BotLegitimacy : null;
	const liveTier = L?.getTrustTier?.(key);

	// Pinned account already stored — refuse demotions / AI noise
	if (
		existing &&
		isHardPinnedVerdict(existing) &&
		!isHardPinnedVerdict(verdict) &&
		!existing.isBot
	) {
		return existing;
	}
	if (
		L?.isHardTrustTier?.(liveTier) &&
		(verdict.isBot || verdict.isSlop || verdict.source === "local")
	) {
		return (
			existing ||
			(L.createTrustVerdict?.(key, liveTier)
				? { ...L.createTrustVerdict(key, liveTier), pinned: true }
				: null)
		);
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
		return existing;
	}

	const incomingPinned = isHardPinnedVerdict(verdict);

	// Skip rewrite thrash: same pinned class already durable
	if (
		incomingPinned &&
		existing &&
		isHardPinnedVerdict(existing) &&
		Boolean(existing.isBot) === Boolean(verdict.isBot) &&
		Boolean(existing.isSlop) === Boolean(verdict.isSlop) &&
		existing.trustTier === (verdict.trustTier || existing.trustTier) &&
		existing.expiry &&
		existing.expiry > now + 30 * 24 * 60 * 60 * 1000
	) {
		return existing;
	}

	// Absorb this reply into rolling account reputation (not for pins)
	if (!incomingPinned) {
		updateAccountScore(key, verdict);
	}

	// One stable chip per account — not per post
	const stable = stabilizeAccountVerdict(key, verdict);
	const pinned = incomingPinned || isHardPinnedVerdict(stable);
	const confidence = stable.confidence || 0;

	let expiryDays;
	if (pinned) {
		expiryDays = BOT_CACHE_EXPIRY_PINNED_DAYS;
	} else if (confidence >= 0.75) {
		expiryDays = BOT_CACHE_EXPIRY_HIGH_CONF_DAYS;
	} else if (confidence >= 0.5) {
		expiryDays = BOT_CACHE_EXPIRY_MED_CONF_DAYS;
	} else {
		expiryDays = BOT_CACHE_EXPIRY_LOW_CONF_DAYS;
	}

	if (!pinned && stable.source === "local" && confidence < 0.85) {
		expiryDays = Math.min(expiryDays, 3);
	}
	if (!pinned && stable.source === "account") {
		expiryDays = Math.max(expiryDays, BOT_CACHE_EXPIRY_HIGH_CONF_DAYS);
	}

	const expiry = now + expiryDays * 24 * 60 * 60 * 1000;

	const stored = {
		...stable,
		pinned: pinned || undefined,
		expiry,
		cachedAt: now,
	};
	botVerdictCache.set(key, stored);

	if (!pendingCacheSave) {
		pendingCacheSave = setTimeout(async () => {
			await persistBotCache();
			pendingCacheSave = null;
		}, BOT_CACHE_SAVE_INTERVAL);
	}

	// Keep every visible tweet for this @user on the same chip
	syncAccountUI(key);
	return stored;
}

/** Push the cached account verdict onto every on-screen tweet for this user. */
function syncAccountUI(username) {
	const key = String(username || "").toLowerCase();
	const verdict = getCachedVerdict(key);
	if (!verdict) return;
	try {
		window.BotUI?.syncUsername?.(key, verdict);
	} catch {
		/* UI not ready */
	}
}

/**
 * Coerce weak bot labels → human/slop. Cuts the main false-positive path.
 */
function sanitizeIncomingVerdict(verdict) {
	if (!verdict || isUnknownVerdict(verdict)) return verdict;
	if (isHardPinnedVerdict(verdict)) return verdict;
	const conf = Math.min(1, Math.max(0, Number(verdict.confidence) || 0));
	if (verdict.isBot && conf < BOT_MIN_CONF) {
		const keepSlop = Boolean(verdict.isSlop) || conf >= 0.55;
		return {
			...verdict,
			isBot: false,
			isSlop: keepSlop,
			confidence: keepSlop ? Math.max(conf, 0.6) : Math.max(1 - conf, 0.75),
			category: keepSlop ? verdict.category || "llm_slop" : "genuine",
			reason: keepSlop
				? `${verdict.reason || "Weak bot signal"} (shown as slop, not bot)`
				: `${verdict.reason || "Weak bot signal"} (treated as human)`,
		};
	}
	return verdict;
}

function normalizeVerdict(verdict) {
	const v = sanitizeIncomingVerdict(verdict) || verdict || {};
	return {
		isBot: Boolean(v.isBot),
		isSlop: Boolean(v.isSlop),
		confidence: Math.min(1, Math.max(0, Number(v.confidence) || 0)),
		category: v.category || "genuine",
		reason: String(v.reason || ""),
		signals: Array.isArray(v.signals) ? v.signals.slice(0, 8) : [],
		source: v.source || "ai",
		trustTier: v.trustTier || "none",
		pinned: Boolean(v.pinned) || isHardPinnedVerdict(v) || undefined,
		accountScore: v.accountScore != null ? Number(v.accountScore) : null,
		replyScore: v.replyScore != null ? Number(v.replyScore) : null,
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
	if (!cached) return null;

	// Drop legacy conf=0 "human" poison
	if (isUnknownVerdict(cached)) {
		botVerdictCache.delete(key);
		return null;
	}

	// Pinned (your mark / follow trust) never expire for reads
	if (isHardPinnedVerdict(cached)) {
		return cached;
	}

	if (cached.expiry && cached.expiry > Date.now()) {
		return cached;
	}

	// Expired scored stranger — drop so we can re-evaluate later
	botVerdictCache.delete(key);
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

	// Only strong bot calls count as botHits (avoid one weak FP poisoning the account)
	const conf = Number(verdict.confidence) || 0;
	const strongBot = Boolean(verdict.isBot) && conf >= BOT_MIN_CONF;
	const samples = prev.samples + 1;
	const botHits = prev.botHits + (strongBot ? 1 : 0);
	const genuineHits =
		prev.genuineHits + (!verdict.isBot && !verdict.isSlop ? 1 : 0);
	const slopHits = prev.slopHits + (verdict.isSlop && !verdict.isBot ? 1 : 0);
	const botness = replyBotness({
		...verdict,
		// Weak bot labels contribute as mild slop-ish, not full bot
		isBot: strongBot,
		confidence: strongBot ? conf : conf,
	});
	const avgBotConf =
		(prev.avgBotConf * prev.samples + botness) / samples;

	// Account is bot only with repeated strong hits
	const isBot =
		(botHits >= 2 && avgBotConf >= 0.75) ||
		(botHits >= 3 && botHits > genuineHits);
	const isSlop =
		!isBot &&
		(slopHits >= 2 || (verdict.isSlop && conf >= 0.75 && slopHits >= 1));

	accountScores.set(key, {
		botHits,
		genuineHits,
		slopHits,
		samples,
		avgBotConf,
		lastCategory: strongBot
			? verdict.category || prev.lastCategory
			: prev.lastCategory || verdict.category || "genuine",
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
	const avg = clamp01(Number(score.avgBotConf) || 0);

	// Strong human prior: low bot-likeness across samples
	if (avg < ACCOUNT_PRIOR_CONF && !score.isBot) {
		if (score.genuineHits >= ACCOUNT_PRIOR_MIN_SAMPLES && !score.isBot) {
			const humanConf = clamp01(1 - avg * 0.5, 0.8, 0.99);
			return {
				isBot: false,
				isSlop: Boolean(score.isSlop) && score.slopHits >= 2,
				confidence: score.isSlop && score.slopHits >= 2
					? clamp01(0.65 + avg * 0.2, 0.65, 0.88)
					: humanConf,
				category:
					score.isSlop && score.slopHits >= 2 ? "llm_slop" : "genuine",
				reason:
					score.isSlop && score.slopHits >= 2
						? "Account often posts low-info replies (not labeled bot)"
						: "Consistent human across prior posts",
				signals: ["account_prior_human"],
				source: "account_prior",
				accountScore: avg,
				replyScore: null,
			};
		}
		return null;
	}
	// Bot prior: need repeated strong hits
	if (score.isBot && score.botHits >= 2 && avg >= 0.8) {
		return {
			isBot: true,
			isSlop: Boolean(score.isSlop),
			confidence: clamp01(avg, BOT_MIN_CONF, 0.99),
			category: score.lastCategory || "airdrop_farmer",
			reason: "Repeated strong bot pattern on this account",
			signals: ["account_prior_bot"],
			source: "account_prior",
			accountScore: avg,
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
 *
 * RULE STACK (first match wins — keep this short):
 *  0. getKnownVerdict (pinned + durable cache) → NEVER recompute
 *  1. Your override (Human / Bot / Slop mark)
 *  2. Whitelist
 *  3. Hard trust: mutual > you-follow  → blue ✓/↔, NEVER "?", NEVER AI
 *  4. Account cache (stable chip for this @user)
 *  5. Local profile/template signals (ratio, short spam) — strangers only
 *  6. Account prior (after enough samples)
 *  7. else → server AI
 *
 * People you follow / marked human must never re-enter AI or local spam filters.
 */
function resolveLocally(username, replyData, opts = {}) {
	const key = String(username || "").toLowerCase();
	const L = typeof window !== "undefined" ? window.BotLegitimacy : null;

	// 0. Already known (pinned or scored cache) — zero recompute
	if (opts.allowCache !== false) {
		const known = getKnownVerdict(key);
		if (known) {
			// Learn DOM/opts follow into live set without reclassifying
			if (
				(opts.userFollows === true || replyData?.userFollows === true) &&
				!L?.isFollowedByUser?.(key)
			) {
				L?.noteYouFollow?.(key);
			}
			return known;
		}
	}

	// 1. Personal override (explicit user judgment wins)
	const overrideV = getOverrideVerdict(key);
	if (overrideV) return { ...overrideV, pinned: true };

	// 2. Whitelist
	if (isWhitelisted(key)) {
		return {
			isBot: false,
			isSlop: false,
			confidence: 1,
			category: "genuine",
			reason: "You marked this account as human",
			signals: ["whitelist"],
			source: "trust",
			trustTier: "whitelist",
			pinned: true,
		};
	}

	// 3. Social hard-trust: mutual > following (list / DOM / GraphQL — any source)
	const userFollows =
		opts.userFollows === true ||
		replyData?.userFollows === true ||
		Boolean(L?.isFollowedByUser?.(key));
	const isMutual =
		opts.isMutual === true ||
		replyData?.trustTier === "mutual" ||
		Boolean(L?.isMutualWithUser?.(key));
	// Live tier wins if set already knows about them
	const liveTier = L?.getTrustTier?.(key);
	const trustTier =
		liveTier === "mutual" || liveTier === "following"
			? liveTier
			: opts.trustTier ||
				(isMutual ? "mutual" : userFollows ? "following" : "none");

	if (
		trustTier === "mutual" ||
		trustTier === "following" ||
		userFollows ||
		isMutual ||
		L?.isHardTrustTier?.(liveTier)
	) {
		const tier =
			isMutual || trustTier === "mutual" || liveTier === "mutual"
				? "mutual"
				: "following";
		// Learn follow into the live set for later tweets
		if (userFollows || tier === "following" || tier === "mutual") {
			L?.noteYouFollow?.(key);
		}
		const trustV =
			L?.createTrustVerdict?.(key, tier) || {
				isBot: false,
				isSlop: false,
				confidence: 1,
				category: "genuine",
				reason:
					tier === "mutual"
						? "Mutual — you follow each other (hard trust)"
						: "You follow this account (hard trust — not scored)",
				signals:
					tier === "mutual"
						? ["mutual_follow", "user_follows", "followed_by", "hard_trust"]
						: ["user_follows", "hard_trust"],
				source: "trust",
				trustTier: tier,
			};
		return { ...trustV, pinned: true };
	}

	// 4. Session/storage cache — always the **account** chip, not this reply's score
	const cached = getCachedVerdict(key);
	if (cached && opts.allowCache !== false) {
		// Pinned or high-trust cache: never re-run local filters
		if (isHardPinnedVerdict(cached) || cached.pinned) {
			return cached;
		}

		// Class upgrades only for unpinned strangers (human → slop/bot).
		// Never recompute people you already scored as solid human without new class change.
		const local = window.BotDetection?.localClassify?.(replyData);
		if (local && !isHardPinnedVerdict(cached)) {
			const upgradesBot = local.isBot && !cached.isBot;
			const upgradesSlop =
				local.isSlop && !cached.isBot && !cached.isSlop && !local.isBot;
			// Do not demote a confident human with a weak local hit
			const solidHuman =
				!cached.isBot &&
				!cached.isSlop &&
				Number(cached.confidence) >= 0.8 &&
				(cached.source === "ai" ||
					cached.source === "account" ||
					cached.source === "account_prior");
			if ((upgradesBot || upgradesSlop) && !solidHuman) {
				saveBotCache(key, local);
				return getCachedVerdict(key) || cached;
			}
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

	// Never enqueue people we already pinned / scored
	const known = getKnownVerdict(key);
	if (known) {
		return Promise.resolve(known);
	}

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
		// Always persist non-cache resolutions as account-stable chips
		if (localVerdict.source !== "cache" && !localVerdict.expiry) {
			const stable = saveBotCache(key, localVerdict);
			return Promise.resolve(stable || getCachedVerdict(key) || localVerdict);
		}
		return Promise.resolve(getCachedVerdict(key) || localVerdict);
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

			if (verdict && !isUnknownVerdict(verdict)) {
				verdict = mergeReplyAccountScores(item.username, verdict);
				const stable = saveBotCache(item.username, verdict);
				pendingBotRequests.delete(item.username);
				// Resolve with account-level score, not raw reply conf
				item.resolve(stable || getCachedVerdict(item.username) || verdict);
			} else if (verdict && isUnknownVerdict(verdict)) {
				// Server sent a zero-conf placeholder — surface as unknown, do not cache
				const fallback = {
					...createFallbackVerdict("server_unavailable"),
					reason: verdict.reason || "Classification unavailable",
				};
				pendingBotRequests.delete(item.username);
				item.resolve(fallback);
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
	// Keep reply fields for telemetry; display confidence is stabilized in saveBotCache
	const conf = Number(verdict.confidence) || 0;
	const replyScore = replyBotness(verdict);
	const score = accountScores.get(String(username || "").toLowerCase());
	return {
		...normalizeVerdict(verdict),
		replyScore,
		accountScore: score ? score.avgBotConf : replyScore,
		isSlop: Boolean(verdict.isSlop),
		// Preserve raw reply confidence until saveBotCache folds it into account
		confidence: conf,
	};
}

async function retryIndividual(item) {
	try {
		const verdict = await classifyWithRetry(
			sanitizeForServer(item.replyData),
			1,
		);
		if (verdict && !isUnknownVerdict(verdict)) {
			const merged = mergeReplyAccountScores(item.username, verdict);
			const stable = saveBotCache(item.username, merged);
			pendingBotRequests.delete(item.username);
			item.resolve(stable || getCachedVerdict(item.username) || merged);
		} else {
			const fallback = createFallbackVerdict(
				verdict ? "server_unavailable" : "retry_failed",
			);
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
		unknown: true,
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
	await setOverride(key, { forceHuman: true, forceBot: false, forceSlop: false });
	// Durable pin so we never recompute this account
	const verdict = getOverrideVerdict(key) || {
		isBot: false,
		isSlop: false,
		confidence: 1,
		category: "genuine",
		reason: "You marked this account as human",
		signals: ["whitelist", "user_override_human"],
		source: "override",
		trustTier: "override_human",
		pinned: true,
	};
	saveBotCache(key, verdict);

	try {
		await Promise.all([
			chrome.storage.local.set({ [WHITELIST_KEY]: Array.from(whitelistSet) }),
			persistBotCache(),
			persistOverrides(),
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
		getKnownVerdict,
		isPinnedAccount,
		isHardPinnedVerdict,
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
		isUnknownVerdict,
		stabilizeAccountVerdict,
		syncAccountUI,
		BACKEND_URL,
		isCircuitOpen,
		pendingCount: () => pendingBotRequests.size,
		queueLength: () => botClassificationQueue.length,
	};
}
