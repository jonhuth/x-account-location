// Bot Legitimacy Signals
// Following-list trust graph — load carefully so we never thrash X

// Configuration
const FOLLOWING_CACHE_KEY = "user_following_cache";
const FOLLOWING_CACHE_EXPIRY_HOURS = 24;
// Soft revalidate after 12h in background only when idle
const FOLLOWING_SOFT_REFRESH_HOURS = 12;
// Hard caps to protect X client
const FOLLOWING_MAX_PAGES = 8; // 8 * ~200 = ~1600 accounts
const FOLLOWING_PAGE_DELAY_MS = 1800;
const FOLLOWING_START_DELAY_MS = 4000; // wait after page load before hitting Following API

// State
let userFollowingSet = null;
// People who follow *you* (from passive intercepts / relationship fields)
let followedBySet = new Set();
let followingCacheExpiry = 0;
let followingUpdatedAt = 0;
let isLoadingFollowing = false;
let followingLoadPromise = null;
let followingComplete = false; // true when full pagination finished (or hit max)

// Trust rank: higher = stronger positive signal (never demoted by short-reply local filters)
const TRUST_RANK = {
	none: 0,
	following: 1,
	mutual: 2,
	whitelist: 3,
	override_human: 4,
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function loadCachedFollowing() {
	try {
		const result = await chrome.storage.local.get(FOLLOWING_CACHE_KEY);
		if (result[FOLLOWING_CACHE_KEY]) {
			const cached = result[FOLLOWING_CACHE_KEY];
			if (cached.expiry && cached.expiry > Date.now()) {
				userFollowingSet = new Set(
					(Array.isArray(cached.usernames) ? cached.usernames : []).map((u) =>
						String(u).toLowerCase(),
					),
				);
				followingCacheExpiry = cached.expiry;
				followingUpdatedAt = cached.updatedAt || 0;
				followingComplete = Boolean(cached.complete);
				return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}

async function saveFollowingCache(usernames, complete = false) {
	try {
		const now = Date.now();
		const expiry = now + FOLLOWING_CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
		const list = Array.from(usernames);
		await chrome.storage.local.set({
			[FOLLOWING_CACHE_KEY]: {
				usernames: list,
				expiry,
				updatedAt: now,
				complete: Boolean(complete),
				count: list.length,
			},
		});
		followingCacheExpiry = expiry;
		followingUpdatedAt = now;
		followingComplete = Boolean(complete);
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Fetch via pageScript (authenticated, throttled pagination)
// ---------------------------------------------------------------------------

function applyFollowingList(list) {
	const prev = userFollowingSet || new Set();
	const set = new Set(
		(Array.isArray(list) ? list : []).map((u) => String(u).toLowerCase()),
	);
	// Merge so progressive pages only grow the set
	for (const u of prev) set.add(u);
	const newlyFollowed = [];
	for (const u of set) {
		if (!prev.has(u)) newlyFollowed.push(u);
	}
	userFollowingSet = set;
	// Notify content script so any early mis-flags can soft-correct without X load
	if (newlyFollowed.length > 0 && typeof window !== "undefined") {
		try {
			window.dispatchEvent(
				new CustomEvent("botFollowingUpdated", {
					detail: { count: set.size, newlyFollowed },
				}),
			);
			// Newly discovered follows that already follow us → mutual soft-correct
			for (const u of newlyFollowed) {
				if (followedBySet.has(u)) {
					window.dispatchEvent(
						new CustomEvent("botTrustUpdated", {
							detail: { username: u, trustTier: "mutual" },
						}),
					);
				}
			}
		} catch {
			/* ignore */
		}
	}
}

async function fetchUserFollowing() {
	return new Promise((resolve) => {
		const requestId = Date.now() + Math.random();
		let responded = false;

		const handler = (event) => {
			if (event.source !== window) return;
			if (!event.data || event.data.requestId !== requestId) return;

			// Progressive pages — update set immediately for hard-trust mid-crawl
			if (event.data.type === "__followingProgress") {
				applyFollowingList(event.data.following);
				// Persist partial so reloads still benefit
				saveFollowingCache(userFollowingSet, false).catch(() => {});
				return;
			}

			if (event.data.type === "__followingResponse") {
				responded = true;
				window.removeEventListener("message", handler);
				if (event.data.error) {
					resolve({ following: [], complete: false, error: event.data.error });
				} else {
					resolve({
						following: Array.isArray(event.data.following)
							? event.data.following
							: [],
						complete: Boolean(event.data.complete),
						error: null,
					});
				}
			}
		};

		window.addEventListener("message", handler);

		window.postMessage(
			{
				type: "__fetchFollowing",
				requestId,
				maxPages: FOLLOWING_MAX_PAGES,
				pageDelayMs: FOLLOWING_PAGE_DELAY_MS,
			},
			"*",
		);

		// Long timeout: pagination can take a while; never hang forever
		const timeoutMs =
			FOLLOWING_START_DELAY_MS +
			FOLLOWING_MAX_PAGES * (FOLLOWING_PAGE_DELAY_MS + 5000) +
			15000;
		setTimeout(() => {
			if (!responded) {
				window.removeEventListener("message", handler);
				resolve({ following: [], complete: false, error: "timeout" });
			}
		}, timeoutMs);
	});
}

/**
 * Load following set. Prefers cache; background-refreshes without blocking.
 * forceRefresh: ignore cache expiry (still respects in-flight lock).
 */
async function loadUserFollowing(forceRefresh = false) {
	if (isLoadingFollowing && followingLoadPromise) {
		return followingLoadPromise;
	}

	if (
		!forceRefresh &&
		userFollowingSet &&
		followingCacheExpiry > Date.now()
	) {
		maybeSoftRefresh();
		return userFollowingSet;
	}

	if (!forceRefresh) {
		const cachedLoaded = await loadCachedFollowing();
		if (cachedLoaded && userFollowingSet) {
			maybeSoftRefresh();
			return userFollowingSet;
		}
	}

	isLoadingFollowing = true;
	followingLoadPromise = (async () => {
		try {
			// Stagger first hit so we don't pile on with location API
			await new Promise((r) => setTimeout(r, FOLLOWING_START_DELAY_MS));
			const { following, complete } = await fetchUserFollowing();
			const set = new Set(
				(Array.isArray(following) ? following : []).map((u) =>
					String(u).toLowerCase(),
				),
			);
			// Merge with any prior cache so a partial page doesn't erase known follows
			if (userFollowingSet && userFollowingSet.size > set.size) {
				for (const u of userFollowingSet) set.add(u);
			}
			userFollowingSet = set;
			await saveFollowingCache(userFollowingSet, complete);
			return userFollowingSet;
		} catch {
			userFollowingSet = userFollowingSet || new Set();
			return userFollowingSet;
		} finally {
			isLoadingFollowing = false;
			followingLoadPromise = null;
		}
	})();

	return followingLoadPromise;
}

function maybeSoftRefresh() {
	if (isLoadingFollowing) return;
	if (!followingUpdatedAt) return;
	const age = Date.now() - followingUpdatedAt;
	if (age < FOLLOWING_SOFT_REFRESH_HOURS * 60 * 60 * 1000) return;
	// Idle soft refresh — fire and forget
	if (typeof requestIdleCallback !== "undefined") {
		requestIdleCallback(
			() => {
				loadUserFollowing(true).catch(() => {});
			},
			{ timeout: 30000 },
		);
	} else {
		setTimeout(() => {
			loadUserFollowing(true).catch(() => {});
		}, 10000);
	}
}

// ---------------------------------------------------------------------------
// Trust queries
// ---------------------------------------------------------------------------

function isFollowedByUser(username) {
	if (!userFollowingSet) return false;
	return userFollowingSet.has(String(username || "").toLowerCase());
}

/**
 * Record that `username` follows you (passive GraphQL relationship fields).
 * Combined with isFollowedByUser → mutual hard-trust (highest positive signal).
 */
function noteFollowedBy(username) {
	const key = String(username || "").toLowerCase();
	if (!key) return false;
	const had = followedBySet.has(key);
	followedBySet.add(key);
	if (!had && isFollowedByUser(key)) {
		try {
			window.dispatchEvent(
				new CustomEvent("botTrustUpdated", {
					detail: { username: key, trustTier: "mutual" },
				}),
			);
		} catch {
			/* ignore */
		}
	}
	return !had;
}

function isFollowedByThem(username) {
	return followedBySet.has(String(username || "").toLowerCase());
}

/** Mutual = you follow them AND they follow you. Highest positive social signal we can get offline. */
function isMutualWithUser(username) {
	const key = String(username || "").toLowerCase();
	return isFollowedByUser(key) && isFollowedByThem(key);
}

/**
 * Trust tiers (cheap, no extra X calls):
 * - mutual: you follow each other (highest positive — never demoted by short-reply local filters)
 * - following: you follow them (hard-trust)
 * - override_*: personal feedback (handled in BotCache)
 * - none
 */
function getTrustTier(username) {
	if (isMutualWithUser(username)) return "mutual";
	if (isFollowedByUser(username)) return "following";
	return "none";
}

function trustRank(tier) {
	return TRUST_RANK[String(tier || "none")] ?? 0;
}

/** True when tier is social hard-trust (mutual or following) — short comments must not override. */
function isHardTrustTier(tier) {
	return tier === "mutual" || tier === "following";
}

function getMutualFollowCount() {
	if (!userFollowingSet) return 0;
	let n = 0;
	for (const u of userFollowingSet) {
		if (followedBySet.has(u)) n++;
	}
	return n;
}

async function getUserContext(username) {
	// Non-blocking: use in-memory set if ready; kick load if missing
	if (!userFollowingSet) {
		loadUserFollowing().catch(() => {});
	}
	const userFollows = isFollowedByUser(username);
	const mutual = isMutualWithUser(username);
	return {
		userFollows,
		mutualCount: mutual ? 1 : 0,
		trustTier: mutual ? "mutual" : userFollows ? "following" : "none",
	};
}

/**
 * Hard-trust verdict for mutual / following — no server, no X API.
 * Short engagement replies must never replace this.
 */
function createTrustVerdict(username, tier) {
	const t = tier === "mutual" || isMutualWithUser(username) ? "mutual" : "following";
	if (t === "mutual") {
		return {
			isBot: false,
			isSlop: false,
			confidence: 0.99,
			category: "genuine",
			reason: "Mutual follow — highest trust signal",
			signals: ["mutual_follow", "user_follows", "followed_by", "hard_trust"],
			source: "trust",
			trustTier: "mutual",
			accountScore: 0,
			replyScore: 0,
		};
	}
	return {
		isBot: false,
		isSlop: false,
		confidence: 0.96,
		category: "genuine",
		reason: "Account you follow",
		signals: ["user_follows", "hard_trust"],
		source: "trust",
		trustTier: "following",
		accountScore: 0,
		replyScore: 0,
	};
}

/** @deprecated use createTrustVerdict — kept for call sites */
function createFollowTrustVerdict(username) {
	return createTrustVerdict(username, getTrustTier(username));
}

async function initLegitimacy() {
	// Cache first (instant), then background fill if needed
	const hadCache = await loadCachedFollowing();
	if (!hadCache || !followingComplete) {
		// Don't await — never block bot processing on full following crawl
		loadUserFollowing(!hadCache).catch(() => {});
	} else {
		maybeSoftRefresh();
	}
}

if (typeof window !== "undefined") {
	window.BotLegitimacy = {
		loadUserFollowing,
		isFollowedByUser,
		isFollowedByThem,
		isMutualWithUser,
		noteFollowedBy,
		getMutualFollowCount,
		getTrustTier,
		trustRank,
		isHardTrustTier,
		getUserContext,
		createTrustVerdict,
		createFollowTrustVerdict,
		initLegitimacy,
		getFollowingSet: () => userFollowingSet,
		getFollowedBySet: () => followedBySet,
		getFollowingCount: () => userFollowingSet?.size || 0,
		isFollowingComplete: () => followingComplete,
		isLoading: () => isLoadingFollowing,
	};
}
