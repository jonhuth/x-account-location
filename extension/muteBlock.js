// Mute / Block manager — bulk words & accounts, stemming, AI/local suggestions
// Persists in chrome.storage.local. Optional client-side hide on timeline.
// Apply-to-X helpers run via popup scripting on settings pages (desktop).

const MUTE_BLOCK_KEY = "mute_block_lists";
const MUTE_BLOCK_BACKEND =
	"https://x-bot-detector-production.up.railway.app";

/** @typedef {{ id: string, term: string, source?: string, addedAt?: number }} MuteWord */
/** @typedef {{ id: string, username: string, source?: string, addedAt?: number }} MuteAccount */

const DEFAULT_STATE = () => ({
	muteWords: /** @type {MuteWord[]} */ ([]),
	muteAccounts: /** @type {MuteAccount[]} */ ([]),
	blockAccounts: /** @type {MuteAccount[]} */ ([]),
	settings: {
		/** Hide matching tweets in the timeline (client-side) */
		hideMatchingTweets: true,
		/** Match whole words only */
		wholeWord: false,
		/** Case-sensitive word match */
		caseSensitive: false,
	},
	updatedAt: 0,
});

// ---------------------------------------------------------------------------
// Local suggestion packs (offline) + light stemming
// ---------------------------------------------------------------------------

/** Seed → related mute terms (spam / engagement farm / crypto noise) */
const STEM_PACKS = {
	crypto: [
		"crypto",
		"cryptocurrency",
		"cryptocurrencies",
		"blockchain",
		"web3",
		"defi",
		"btc",
		"eth",
		"solana",
		"sol",
	],
	nft: ["nft", "nfts", "mint", "minting", "opensea", "pfp"],
	airdrop: [
		"airdrop",
		"airdrops",
		"airdropped",
		"claim airdrop",
		"free airdrop",
		"whitelist spot",
	],
	giveaway: ["giveaway", "giveaways", "rt to win", "retweet to win", "tag friends"],
	follow: [
		"follow me",
		"follow back",
		"followback",
		"f4f",
		"follow for follow",
		"gain followers",
	],
	gm: ["gm", "gn", "gmgm", "wagmi", "ngmi", "lfq", "lfg"],
	ai: ["chatgpt", "gpt", "midjourney", "ai art", "generated with ai"],
	spam: ["click here", "link in bio", "dm me", "check my bio", "limited time"],
	casino: ["casino", "slots", "betting", "odds boost", "sportsbook"],
	porn: ["onlyfans", "of ", "subscribe to my", "spicy content"],
};

/** Simple morphological expansions when no pack matches */
function morphologicalVariants(term) {
	const t = String(term || "").trim().toLowerCase();
	if (!t || t.length < 2) return [];
	const out = new Set([t]);
	// plurals
	if (t.endsWith("y") && t.length > 3) {
		out.add(`${t.slice(0, -1)}ies`);
	} else if (t.endsWith("s")) {
		out.add(t.slice(0, -1));
	} else {
		out.add(`${t}s`);
		if (!t.endsWith("e")) out.add(`${t}es`);
	}
	// -ing / -ed
	if (t.endsWith("ing") && t.length > 5) {
		out.add(t.slice(0, -3));
		out.add(`${t.slice(0, -3)}e`);
	} else if (t.endsWith("ed") && t.length > 4) {
		out.add(t.slice(0, -2));
		out.add(t.slice(0, -1));
	} else {
		out.add(`${t}ing`);
		out.add(`${t}ed`);
	}
	return [...out].filter((w) => w.length >= 2);
}

function packExpand(term) {
	const t = String(term || "").trim().toLowerCase();
	if (!t) return [];
	const hits = new Set();
	if (STEM_PACKS[t]) {
		for (const x of STEM_PACKS[t]) hits.add(x);
	}
	for (const [seed, list] of Object.entries(STEM_PACKS)) {
		if (t.includes(seed) || seed.includes(t)) {
			for (const x of list) hits.add(x);
		}
		for (const item of list) {
			if (item === t || item.includes(t) || t.includes(item)) {
				for (const x of list) hits.add(x);
			}
		}
	}
	for (const v of morphologicalVariants(t)) hits.add(v);
	hits.delete(t); // seed itself is "add", expand returns extras
	return [...hits];
}

// ---------------------------------------------------------------------------
// Parse / ids
// ---------------------------------------------------------------------------

function uid(prefix = "m") {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUsername(raw) {
	return String(raw || "")
		.trim()
		.replace(/^@+/, "")
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, "");
}

/**
 * Bulk paste: lines, commas, or double-spaces.
 * @param {string} text
 * @param {{ prefer?: 'words' | 'accounts' }} [opts]
 *   prefer=words (default): only @handles become accounts
 *   prefer=accounts: bare tokens become handles too
 * @returns {{ words: string[], accounts: string[] }}
 */
function parseBulkInput(text, opts = {}) {
	const prefer = opts.prefer === "accounts" ? "accounts" : "words";
	const raw = String(text || "");
	const tokens = raw
		.split(/[\n,;|]+/)
		.flatMap((line) => line.split(/\s{2,}/))
		.map((s) => s.trim())
		.filter(Boolean);
	const words = [];
	const accounts = [];
	for (const tok of tokens) {
		if (tok.startsWith("@")) {
			const u = normalizeUsername(tok);
			if (u) accounts.push(u);
			continue;
		}
		if (prefer === "accounts" && /^[A-Za-z0-9_]{1,15}$/.test(tok)) {
			const u = normalizeUsername(tok);
			if (u) accounts.push(u);
			continue;
		}
		const w = tok.replace(/^["']|["']$/g, "").trim();
		if (w) words.push(w);
	}
	return {
		words: [...new Set(words.map((w) => w.trim()).filter(Boolean))],
		accounts: [...new Set(accounts)],
	};
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function loadMuteBlockState() {
	const base = DEFAULT_STATE();
	try {
		const result = await chrome.storage.local.get(MUTE_BLOCK_KEY);
		const data = result[MUTE_BLOCK_KEY];
		if (!data || typeof data !== "object") return base;
		return {
			muteWords: Array.isArray(data.muteWords) ? data.muteWords : [],
			muteAccounts: Array.isArray(data.muteAccounts) ? data.muteAccounts : [],
			blockAccounts: Array.isArray(data.blockAccounts) ? data.blockAccounts : [],
			settings: { ...base.settings, ...(data.settings || {}) },
			updatedAt: Number(data.updatedAt) || 0,
		};
	} catch {
		return base;
	}
}

async function saveMuteBlockState(state) {
	const next = {
		muteWords: Array.isArray(state.muteWords) ? state.muteWords : [],
		muteAccounts: Array.isArray(state.muteAccounts) ? state.muteAccounts : [],
		blockAccounts: Array.isArray(state.blockAccounts) ? state.blockAccounts : [],
		settings: { ...DEFAULT_STATE().settings, ...(state.settings || {}) },
		updatedAt: Date.now(),
	};
	try {
		await chrome.storage.local.set({ [MUTE_BLOCK_KEY]: next });
	} catch {
		/* Safari storage */
	}
	return next;
}

function hasWord(state, term) {
	const t = String(term || "").toLowerCase();
	return state.muteWords.some((w) => String(w.term || "").toLowerCase() === t);
}

function hasAccount(list, username) {
	const u = normalizeUsername(username);
	return list.some((a) => a.username === u);
}

async function addMuteWords(terms, source = "manual") {
	const state = await loadMuteBlockState();
	const now = Date.now();
	let added = 0;
	for (const raw of Array.isArray(terms) ? terms : [terms]) {
		const term = String(raw || "").trim();
		if (!term || hasWord(state, term)) continue;
		state.muteWords.push({
			id: uid("w"),
			term,
			source,
			addedAt: now,
		});
		added++;
	}
	await saveMuteBlockState(state);
	return { state, added };
}

async function addMuteAccounts(usernames, source = "manual") {
	const state = await loadMuteBlockState();
	const now = Date.now();
	let added = 0;
	for (const raw of Array.isArray(usernames) ? usernames : [usernames]) {
		const username = normalizeUsername(raw);
		if (!username || hasAccount(state.muteAccounts, username)) continue;
		state.muteAccounts.push({
			id: uid("ma"),
			username,
			source,
			addedAt: now,
		});
		added++;
	}
	await saveMuteBlockState(state);
	return { state, added };
}

async function addBlockAccounts(usernames, source = "manual") {
	const state = await loadMuteBlockState();
	const now = Date.now();
	let added = 0;
	for (const raw of Array.isArray(usernames) ? usernames : [usernames]) {
		const username = normalizeUsername(raw);
		if (!username || hasAccount(state.blockAccounts, username)) continue;
		state.blockAccounts.push({
			id: uid("ba"),
			username,
			source,
			addedAt: now,
		});
		added++;
	}
	await saveMuteBlockState(state);
	return { state, added };
}

async function removeByIds(kind, ids) {
	const state = await loadMuteBlockState();
	const set = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
	if (kind === "words") {
		state.muteWords = state.muteWords.filter((w) => !set.has(w.id));
	} else if (kind === "muteAccounts") {
		state.muteAccounts = state.muteAccounts.filter((a) => !set.has(a.id));
	} else if (kind === "blockAccounts") {
		state.blockAccounts = state.blockAccounts.filter((a) => !set.has(a.id));
	}
	await saveMuteBlockState(state);
	return state;
}

async function clearList(kind) {
	const state = await loadMuteBlockState();
	if (kind === "words") state.muteWords = [];
	else if (kind === "muteAccounts") state.muteAccounts = [];
	else if (kind === "blockAccounts") state.blockAccounts = [];
	else if (kind === "all") {
		state.muteWords = [];
		state.muteAccounts = [];
		state.blockAccounts = [];
	}
	await saveMuteBlockState(state);
	return state;
}

async function updateSettings(patch) {
	const state = await loadMuteBlockState();
	state.settings = { ...state.settings, ...(patch || {}) };
	await saveMuteBlockState(state);
	return state;
}

/**
 * Expand selected (or all) words with stem packs + morphology. Adds new terms.
 */
async function expandStems(wordIds = null) {
	const state = await loadMuteBlockState();
	const targets =
		wordIds && wordIds.length
			? state.muteWords.filter((w) => wordIds.includes(w.id))
			: state.muteWords;
	const toAdd = new Set();
	for (const w of targets) {
		for (const v of packExpand(w.term)) {
			if (!hasWord(state, v)) toAdd.add(v);
		}
	}
	return addMuteWords([...toAdd], "stem");
}

/**
 * Local + optional Railway AI suggestions for a seed term.
 */
async function suggestFromSeed(seed, { useAi = true, limit = 16 } = {}) {
	const s = String(seed || "").trim();
	if (!s) return { suggestions: [], source: "none" };

	const local = packExpand(s).slice(0, limit);
	if (!useAi) {
		return { suggestions: local, source: "local" };
	}

	try {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), 10000);
		const res = await fetch(`${MUTE_BLOCK_BACKEND}/api/suggest-mutes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ seed: s, kind: "word", limit }),
			signal: controller.signal,
		});
		clearTimeout(t);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		const ai = Array.isArray(data.suggestions)
			? data.suggestions.map((x) => String(x || "").trim()).filter(Boolean)
			: [];
		// Merge: AI first, then local fills
		const seen = new Set();
		const merged = [];
		for (const x of [...ai, ...local]) {
			const k = x.toLowerCase();
			if (seen.has(k) || k === s.toLowerCase()) continue;
			seen.add(k);
			merged.push(x);
			if (merged.length >= limit) break;
		}
		return { suggestions: merged, source: ai.length ? "ai" : "local" };
	} catch {
		return { suggestions: local, source: "local" };
	}
}

// ---------------------------------------------------------------------------
// Client-side match (timeline hide)
// ---------------------------------------------------------------------------

function compileWordMatchers(state) {
	const words = (state?.muteWords || []).map((w) => String(w.term || "").trim()).filter(Boolean);
	const caseSensitive = Boolean(state?.settings?.caseSensitive);
	const wholeWord = Boolean(state?.settings?.wholeWord);
	return words.map((term) => {
		const flags = caseSensitive ? "g" : "gi";
		const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
		try {
			return new RegExp(pattern, flags);
		} catch {
			return null;
		}
	}).filter(Boolean);
}

function tweetMatchesMute(el, state) {
	if (!state?.settings?.hideMatchingTweets) return false;
	const username =
		el?.dataset?.botUsername ||
		(el.querySelector?.('a[href^="/"]')?.getAttribute("href") || "")
			.replace(/^\//, "")
			.split(/[/?]/)[0]
			?.toLowerCase();

	if (username && hasAccount(state.muteAccounts || [], username)) return true;
	if (username && hasAccount(state.blockAccounts || [], username)) return true;

	const text =
		el.querySelector?.('[data-testid="tweetText"]')?.textContent ||
		el.textContent ||
		"";
	if (!text) return false;
	const matchers = compileWordMatchers(state);
	return matchers.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Page inject helpers (run in tab via executeScript)
// ---------------------------------------------------------------------------

/**
 * Try to add muted keywords on x.com/settings/muted_keywords
 * X UI changes often — best-effort, returns counts.
 */
function applyMutedKeywordsOnPage(words) {
	const list = (Array.isArray(words) ? words : []).map(String).filter(Boolean);
	if (!list.length) {
		return { success: false, message: "No words to add", added: 0 };
	}
	const href = location.href || "";
	if (!/muted_keywords|muted\/keywords|mute_and_block/i.test(href)) {
		return {
			success: false,
			message: "Open x.com/settings/muted_keywords first, then retry Apply",
			added: 0,
		};
	}

	let added = 0;
	const input =
		document.querySelector('input[name="keyword"]') ||
		document.querySelector('input[placeholder*="keyword" i]') ||
		document.querySelector('input[placeholder*="word" i]') ||
		document.querySelector('input[type="text"]');

	if (!input) {
		return {
			success: false,
			message: "Could not find keyword input on this page (X UI may have changed)",
			added: 0,
		};
	}

	const setNativeValue = (el, value) => {
		const proto = Object.getPrototypeOf(el);
		const desc = Object.getOwnPropertyDescriptor(proto, "value");
		if (desc?.set) desc.set.call(el, value);
		else el.value = value;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
	};

	// Sequential add is flaky; we fill first word and click Save if present
	// For bulk, user can paste — we also copy list to clipboard when possible
	const joined = list.join("\n");
	try {
		void navigator.clipboard?.writeText?.(joined);
	} catch {
		/* ignore */
	}

	// Add first few interactively (cap to avoid lockups)
	const cap = Math.min(list.length, 25);
	for (let i = 0; i < cap; i++) {
		const w = list[i];
		setNativeValue(input, w);
		const save =
			document.querySelector('[data-testid="settingsDetailSave"]') ||
			[...document.querySelectorAll("button")].find((b) =>
				/save|mute|add/i.test(b.textContent || ""),
			);
		if (save) {
			save.click();
			added++;
		}
	}

	return {
		success: added > 0 || list.length > 0,
		message:
			added > 0
				? `Triggered add for ${added} word(s). Full list also copied to clipboard.`
				: `List (${list.length}) copied to clipboard — paste into X mute keywords if auto-add missed.`,
		added,
	};
}

// ---------------------------------------------------------------------------
// Export for popup + content
// ---------------------------------------------------------------------------

const MuteBlock = {
	MUTE_BLOCK_KEY,
	DEFAULT_STATE,
	STEM_PACKS,
	loadMuteBlockState,
	saveMuteBlockState,
	parseBulkInput,
	normalizeUsername,
	addMuteWords,
	addMuteAccounts,
	addBlockAccounts,
	removeByIds,
	clearList,
	updateSettings,
	expandStems,
	suggestFromSeed,
	packExpand,
	morphologicalVariants,
	tweetMatchesMute,
	compileWordMatchers,
	applyMutedKeywordsOnPage,
	hasWord,
	hasAccount,
};

if (typeof window !== "undefined") {
	window.MuteBlock = MuteBlock;
}
if (typeof globalThis !== "undefined") {
	globalThis.MuteBlock = MuteBlock;
}
