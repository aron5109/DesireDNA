/**
 * A tiny in-memory stand-in for Supabase's PostgREST endpoint, used only by the
 * Playwright end-to-end run. It implements just enough of the protocol for
 * DesireDNA's two tables so the whole flow — encryption, cookies, server
 * rendering — can be exercised without a live database.
 *
 * It is a test fixture: no authentication, no persistence, no production use.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const tables = { quiz_profiles: [], rate_limit_events: [] };
let sequence = 0;

/** Parses PostgREST filters such as `expires_at=gt.2026-01-01T00:00:00.000Z`. */
function buildFilters(params) {
  const filters = [];
  for (const [column, raw] of params) {
    if (["select", "order", "limit", "offset"].includes(column)) continue;
    const separator = raw.indexOf(".");
    const operator = raw.slice(0, separator);
    const value = raw.slice(separator + 1);

    filters.push((row) => {
      const actual = row[column];
      switch (operator) {
        case "eq":
          return String(actual) === value;
        case "is":
          return value === "null" ? actual === null || actual === undefined : String(actual) === value;
        case "gt":
          return String(actual) > value;
        case "gte":
          return String(actual) >= value;
        case "lt":
          return String(actual) < value;
        case "lte":
          return String(actual) <= value;
        default:
          return true;
      }
    });
  }
  return filters;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body ? JSON.parse(body) : null));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const table = url.pathname.replace("/rest/v1/", "");
  const rows = tables[table];

  if (!rows) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `unknown table ${table}` }));
    return;
  }

  const filters = buildFilters(url.searchParams);
  const matches = (row) => filters.every((filter) => filter(row));
  const send = (status, payload, extraHeaders = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };

  if (req.method === "POST") {
    const body = await readBody(req);
    const inserted = (Array.isArray(body) ? body : [body]).map((row) => ({
      id: table === "quiz_profiles" ? randomUUID() : ++sequence,
      created_at: new Date().toISOString(),
      revoked_at: null,
      ...row,
    }));

    for (const row of inserted) {
      const clash = rows.some(
        (existing) =>
          (row.owner_token_hash && existing.owner_token_hash === row.owner_token_hash) ||
          (row.share_code_hash && existing.share_code_hash === row.share_code_hash),
      );
      if (clash) {
        send(409, { message: "duplicate key value violates unique constraint" });
        return;
      }
      rows.push(row);
    }
    send(201, inserted);
    return;
  }

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const updated = rows.filter(matches);
    for (const row of updated) Object.assign(row, body);
    send(200, updated);
    return;
  }

  if (req.method === "DELETE") {
    const removed = rows.filter(matches);
    for (const row of removed) rows.splice(rows.indexOf(row), 1);
    send(200, removed, { "content-range": `*/${removed.length}` });
    return;
  }

  const found = rows.filter(matches);
  const headers = { "content-range": `0-${Math.max(found.length - 1, 0)}/${found.length}` };
  if (req.method === "HEAD") {
    res.writeHead(200, { "content-type": "application/json", ...headers });
    res.end();
    return;
  }
  send(200, found, headers);
});

const port = Number(process.env.STUB_PORT ?? 54321);
server.listen(port, () => console.log(`postgrest stub listening on ${port}`));
