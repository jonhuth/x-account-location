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
let followingCacheExpiry = 0;
let followingUpdatedAt = 0;
let isLoadingFollowing = false;
let followingLoadPromise = null;
let followingComplete = false; // true when full pagination finished (or hit max)

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
	const prevSize = userFollowingSet?.size || 0;
	const set = new Set(
		(Array.isArray(list) ? list : []).map((u) => String(u).toLowerCase()),
	);
	// Merge so progressive pages only grow the set
	if (userFollowingSet) {
		for (const u of userFollowingSet) set.add(u);
	}
	userFollowingSet = set;
	// Notify content script so any early mis-flags can soft-correct without X load
	if (set.size > prevSize && typeof window !== "undefined") {
		try {
			window.dispatchEvent(
				new CustomEvent("botFollowingUpdated", {
					detail: { count: set.size },
				}),
			);
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
 * Trust tiers (cheap, no extra X calls):
 * - following: you follow them (strong)
 * - override_human / override_bot: personal feedback (handled in BotCache)
 * - none
 */
function getTrustTier(username) {
	if (isFollowedByUser(username)) return "following";
	return "none";
}

function getMutualFollowCount() {
	// Full mutuals need target follower lists — too expensive for X client.
	return 0;
}

async function getUserContext(username) {
	// Non-blocking: use in-memory set if ready; kick load if missing
	if (!userFollowingSet) {
		loadUserFollowing().catch(() => {});
	}
	const userFollows = isFollowedByUser(username);
	return {
		userFollows,
		mutualCount: 0,
		trustTier: userFollows ? "following" : "none",
	};
}

/**
 * Hard-trust verdict for accounts you follow — no server, no X API.
 */
function createFollowTrustVerdict(username) {
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
		getMutualFollowCount,
		getTrustTier,
		getUserContext,
		createFollowTrustVerdict,
		initLegitimacy,
		getFollowingSet: () => userFollowingSet,
		getFollowingCount: () => userFollowingSet?.size || 0,
		isFollowingComplete: () => followingComplete,
		isLoading: () => isLoadingFollowing,
	};
}
