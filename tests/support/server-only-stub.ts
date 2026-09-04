/**
 * `server-only` throws when it is resolved outside a React Server Component
 * graph, which makes every module that imports it unloadable under Vitest.
 * Aliasing it to this empty module lets the server modules be unit tested
 * while production builds keep the real guard.
 */
export {};
