import { LRUCache } from "lru-cache";
import type { BotVerdict } from "../types.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 1000;

const cache = new LRUCache<string, BotVerdict>({
	max: MAX_CACHE_SIZE,
	ttl: CACHE_TTL_MS,
});

export function getCachedVerdict(key: string): BotVerdict | null {
	const verdict = cache.get(String(key || "").toLowerCase());
	return verdict ?? null;
}

export function setCachedVerdict(key: string, verdict: BotVerdict): void {
	cache.set(String(key || "").toLowerCase(), { ...verdict, source: "cache" });
}

export function getCacheStats() {
	return {
		size: cache.size,
		maxSize: MAX_CACHE_SIZE,
		ttlMs: CACHE_TTL_MS,
	};
}
