// Page script - intercepts Twitter API responses and handles authenticated requests
// Design: prefer passive intercepts; any active fetch is throttled and capped
(function () {
	"use strict";

	// ============================================================================
	// State
	// ============================================================================

	let twitterHeaders = null;
	let headersReady = false;

	// Passive cache of user data from Twitter's own API traffic — no extra cost
	const userDataCache = new Map();
	const USER_CACHE_MAX = 2000;

	// Global throttle for active GraphQL we initiate (location + following)
	let lastActiveFetchAt = 0;
	const MIN_ACTIVE_FETCH_GAP_MS = 1200;

	// ============================================================================
	// Intercept Twitter API responses to extract user data
	// ============================================================================

	const originalFetch = window.fetch;
	window.fetch = async function (...args) {
		const url = String(args[0] || "");
		const options = args[1] || {};

		if (url.includes("x.com/i/api/graphql") && options.headers && !headersReady) {
			captureHeaders(options.headers);
		}

		const response = await originalFetch.apply(this, args);

		if (url.includes("x.com/i/api/graphql")) {
			try {
				const cloned = response.clone();
				const data = await cloned.json().catch(() => null);
				if (data) extractUsersFromResponse(data);
			} catch {
				/* never break Twitter */
			}
		}

		return response;
	};

	function captureHeaders(headers) {
		const headerObj = {};
		if (headers instanceof Headers) {
			headers.forEach((v, k) => {
				headerObj[k] = v;
			});
		} else if (typeof headers === "object") {
			Object.assign(headerObj, headers);
		}
		if (Object.keys(headerObj).length > 0) {
			twitterHeaders = headerObj;
			headersReady = true;
		}
	}

	function cacheUser(entry) {
		if (!entry?.username) return;
		const key = String(entry.username).toLowerCase();
		userDataCache.set(key, { ...entry, fetchedAt: Date.now() });
		// Bound memory — drop oldest half when over cap
		if (userDataCache.size > USER_CACHE_MAX) {
			const keys = Array.from(userDataCache.keys());
			const drop = Math.floor(keys.length / 2);
			for (let i = 0; i < drop; i++) userDataCache.delete(keys[i]);
		}
	}

	function extractUsersFromResponse(obj, depth = 0) {
		if (!obj || typeof obj !== "object" || depth > 15) return;

		if (obj.legacy?.screen_name && obj.rest_id) {
			const legacy = obj.legacy;
			const username = String(legacy.screen_name || "").toLowerCase();
			if (username) {
				cacheUser({
					id: obj.rest_id,
					username: legacy.screen_name,
					displayName: legacy.name || "",
					followers: legacy.followers_count || 0,
					following: legacy.friends_count || 0,
					tweets: legacy.statuses_count || 0,
					createdAt: legacy.created_at || null,
					verified: legacy.verified || obj.is_blue_verified || false,
					protected: legacy.protected || false,
					bio: legacy.description || "",
					location: legacy.location || "",
					hasCustomAvatar: !String(
						legacy.profile_image_url_https || "",
					).includes("default_profile"),
					// Relationship fields when present (rare in timeline payloads)
					followedBy: Boolean(
						obj.legacy?.followed_by || obj.relationship?.followed_by,
					),
					followingMe: Boolean(obj.legacy?.following),
				});
			}
		}

		if (Array.isArray(obj)) {
			for (const item of obj) extractUsersFromResponse(item, depth + 1);
		} else {
			for (const key of Object.keys(obj)) {
				extractUsersFromResponse(obj[key], depth + 1);
			}
		}
	}

	async function throttleActiveFetch() {
		const now = Date.now();
		const wait = Math.max(0, MIN_ACTIVE_FETCH_GAP_MS - (now - lastActiveFetchAt));
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastActiveFetchAt = Date.now();
	}

	// ============================================================================
	// Message handlers for content script
	// ============================================================================

	window.addEventListener("message", async function (event) {
		if (!event.data?.type) return;

		if (event.data.type === "__getUserData") {
			const { username, requestId } = event.data;
			const cached = userDataCache.get(String(username || "").toLowerCase());
			window.postMessage(
				{
					type: "__userDataResponse",
					username,
					userData: cached || null,
					requestId,
				},
				"*",
			);
			return;
		}

		if (event.data.type === "__getBulkUserData") {
			const { usernames, requestId } = event.data;
			const results = {};
			for (const u of usernames || []) {
				const cached = userDataCache.get(String(u || "").toLowerCase());
				if (cached) results[String(u).toLowerCase()] = cached;
			}
			window.postMessage(
				{
					type: "__bulkUserDataResponse",
					userData: results,
					requestId,
				},
				"*",
			);
			return;
		}

		if (event.data.type === "__fetchLocation") {
			const { screenName, requestId } = event.data;
			await handleLocationRequest(screenName, requestId);
			return;
		}

		if (event.data.type === "__fetchFollowing") {
			const { requestId, maxPages, pageDelayMs } = event.data;
			await handleFollowingRequest(requestId, maxPages, pageDelayMs);
			return;
		}
	});

	// ============================================================================
	// Location request handler
	// ============================================================================

	async function handleLocationRequest(screenName, requestId) {
		if (!headersReady) {
			for (let i = 0; i < 20 && !headersReady; i++) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}

		try {
			await throttleActiveFetch();
			const variables = JSON.stringify({ screenName });
			const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;

			const response = await originalFetch(url, {
				method: "GET",
				credentials: "include",
				headers: twitterHeaders || { Accept: "application/json" },
				referrer: window.location.href,
			});

			let location = null;
			const isRateLimited = response.status === 429;

			if (response.ok) {
				const data = await response.json();
				location =
					data?.data?.user_result_by_screen_name?.result?.about_profile
						?.account_based_in || null;
			}

			window.postMessage(
				{
					type: "__locationResponse",
					screenName,
					location,
					requestId,
					isRateLimited,
				},
				"*",
			);
		} catch {
			window.postMessage(
				{
					type: "__locationResponse",
					screenName,
					location: null,
					requestId,
				},
				"*",
			);
		}
	}

	// ============================================================================
	// Following list — paginated, delayed, hard-capped
	// ============================================================================

	async function handleFollowingRequest(
		requestId,
		maxPages = 8,
		pageDelayMs = 1800,
	) {
		if (!headersReady) {
			for (let i = 0; i < 20 && !headersReady; i++) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}

		try {
			const currentUser = getCurrentUsername();
			if (!currentUser) throw new Error("Could not determine current user");

			await throttleActiveFetch();
			const userId = await getUserId(currentUser);
			if (!userId) throw new Error("Could not get user ID");

			const pages = Math.min(Math.max(Number(maxPages) || 8, 1), 10);
			const delay = Math.max(Number(pageDelayMs) || 1800, 1000);

			const all = [];
			const seen = new Set();
			let cursor = null;
			let complete = false;

			for (let page = 0; page < pages; page++) {
				if (page > 0) {
					await new Promise((r) => setTimeout(r, delay));
				}
				await throttleActiveFetch();

				const { following, nextCursor, ok } = await fetchFollowingPage(
					userId,
					cursor,
				);
				if (!ok) break;

				for (const u of following) {
					const key = String(u).toLowerCase();
					if (!seen.has(key)) {
						seen.add(key);
						all.push(key);
					}
				}

				// Progressive update so client can hard-trust early without waiting
				window.postMessage(
					{
						type: "__followingProgress",
						following: all.slice(),
						page: page + 1,
						requestId,
					},
					"*",
				);

				if (!nextCursor) {
					complete = true;
					break;
				}
				cursor = nextCursor;
			}

			window.postMessage(
				{
					type: "__followingResponse",
					following: all,
					complete,
					requestId,
				},
				"*",
			);
		} catch (error) {
			window.postMessage(
				{
					type: "__followingResponse",
					following: [],
					complete: false,
					error: error?.message || "error",
					requestId,
				},
				"*",
			);
		}
	}

	function getCurrentUsername() {
		const switcher = document.querySelector(
			'[data-testid="SideNav_AccountSwitcher_Button"]',
		);
		if (switcher) {
			const text = switcher.textContent || "";
			const match = text.match(/@([a-zA-Z0-9_]+)/);
			if (match) return match[1];
		}

		const profileLink = document.querySelector(
			'[data-testid="AppTabBar_Profile_Link"]',
		);
		if (profileLink) {
			const href = profileLink.getAttribute("href");
			if (href) return href.replace("/", "");
		}

		return null;
	}

	async function getUserId(screenName) {
		const features = {
			hidden_profile_subscriptions_enabled: true,
			responsive_web_graphql_exclude_directive_enabled: true,
			verified_phone_label_enabled: false,
			responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
			responsive_web_graphql_timeline_navigation_enabled: true,
		};

		const url = `https://x.com/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({ screen_name: screenName }))}&features=${encodeURIComponent(JSON.stringify(features))}`;

		const response = await originalFetch(url, {
			method: "GET",
			credentials: "include",
			headers: twitterHeaders || { Accept: "application/json" },
			referrer: window.location.href,
		});

		if (!response.ok) return null;

		const data = await response.json();
		return data?.data?.user?.result?.rest_id || null;
	}

	async function fetchFollowingPage(userId, cursor = null) {
		const variables = {
			userId,
			count: 200,
			includePromotedContent: false,
		};
		if (cursor) variables.cursor = cursor;

		const features = {
			responsive_web_graphql_exclude_directive_enabled: true,
			verified_phone_label_enabled: false,
			responsive_web_graphql_timeline_navigation_enabled: true,
			responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
		};

		const url = `https://x.com/i/api/graphql/iSicc7LrzWGBgDPL0tM_TQ/Following?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

		const response = await originalFetch(url, {
			method: "GET",
			credentials: "include",
			headers: twitterHeaders || { Accept: "application/json" },
			referrer: window.location.href,
		});

		if (!response.ok) {
			return { following: [], nextCursor: null, ok: false };
		}

		const data = await response.json();
		const following = [];
		let nextCursor = null;

		const instructions =
			data?.data?.user?.result?.timeline?.timeline?.instructions || [];
		for (const instruction of instructions) {
			for (const entry of instruction.entries || []) {
				const entryId = String(entry.entryId || "");
				// Cursor entries
				if (
					entryId.startsWith("cursor-bottom") ||
					entry.content?.cursorType === "Bottom" ||
					entry.content?.itemContent?.cursorType === "Bottom"
				) {
					const c =
						entry.content?.value ||
						entry.content?.itemContent?.value ||
						null;
					if (c) nextCursor = c;
					continue;
				}

				const user = entry.content?.itemContent?.user_results?.result;
				if (user?.legacy?.screen_name) {
					following.push(user.legacy.screen_name.toLowerCase());
					// Opportunistically cache profile fields from following list
					extractUsersFromResponse(user);
				}
			}
		}

		return { following, nextCursor, ok: true };
	}

	setTimeout(() => {
		if (!headersReady) {
			twitterHeaders = {
				Accept: "application/json",
				"Content-Type": "application/json",
			};
			headersReady = true;
		}
	}, 3000);

	window.__botDetectionCacheSize = () => userDataCache.size;
})();
