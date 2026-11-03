// Live search and ghost completion policy. Keep limits aligned with the API config.
export const TEMPLATE_SEARCH_CONFIG = Object.freeze({ debounceMs: 300, maxResults: 500 });
export const GHOST_POLICY = Object.freeze({ minCompared: 3, minCoverage: 0.6, minScore: 70, minMargin: 5 });
