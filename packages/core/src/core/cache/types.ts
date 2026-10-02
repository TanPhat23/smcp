export interface CacheEntry<T> {
  etag?: string;
  cachedAt: number;
  data: T;
}

export interface CacheOptions {
  ttlMs?: number;
  noCache?: boolean;
}
