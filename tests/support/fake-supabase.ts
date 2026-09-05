/**
 * A minimal in-memory stand-in for the narrow slice of the Supabase client
 * that DesireDNA actually uses. It exists so the route handlers can be tested
 * end to end (create → read → compare → delete) without a live database, and
 * without mocking away the storage layer the routes depend on.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

interface Result<T> {
  data: T;
  error: { message: string } | null;
  count?: number | null;
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>();
  /** Set to force every operation to fail, simulating an unreachable database. */
  failure: string | null = null;
  private sequence = 0;

  reset() {
    this.tables.clear();
    this.failure = null;
    this.sequence = 0;
  }

  rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  from(table: string) {
    return new FakeQuery(this, table, () => `${++this.sequence}`);
  }
}

class FakeQuery implements PromiseLike<Result<Row[] | null>> {
  private filters: Filter[] = [];
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private inserted: Row[] = [];
  private patch: Row = {};
  private wantsCount = false;

  constructor(
    private readonly store: FakeSupabase,
    private readonly table: string,
    private readonly nextId: () => string,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.operation === "select") this.operation = "select";
    if (options?.count) this.wantsCount = true;
    return this;
  }

  insert(values: Row | Row[]) {
    this.operation = "insert";
    this.inserted = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: Row) {
    this.operation = "update";
    this.patch = values;
    return this;
  }

  delete(options?: { count?: string }) {
    this.operation = "delete";
    if (options?.count) this.wantsCount = true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  gt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) > value);
    return this;
  }

  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) >= value);
    return this;
  }

  lt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) < value);
    return this;
  }

  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) <= value);
    return this;
  }

  async single(): Promise<Result<Row | null>> {
    const result = await this.run();
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    if (rows.length !== 1) return { data: null, error: { message: "expected exactly one row" } };
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    const result = await this.run();
    if (result.error) return { data: null, error: result.error };
    const rows = result.data ?? [];
    if (rows.length > 1) return { data: null, error: { message: "expected at most one row" } };
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = Result<Row[] | null>, TResult2 = never>(
    onfulfilled?: ((value: Result<Row[] | null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => filter(row));
  }

  private async run(): Promise<Result<Row[] | null>> {
    if (this.store.failure) return { data: null, error: { message: this.store.failure }, count: null };

    const rows = this.store.rows(this.table);

    if (this.operation === "insert") {
      const created: Row[] = this.inserted.map((row) => ({
        id: row.id ?? this.nextId(),
        created_at: new Date().toISOString(),
        ...row,
      }));
      for (const row of created) {
        const clash = rows.find(
          (existing) =>
            (row.owner_token_hash !== undefined && existing.owner_token_hash === row.owner_token_hash) ||
            (row.share_code_hash !== undefined && existing.share_code_hash === row.share_code_hash),
        );
        if (clash) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        rows.push(row);
      }
      return { data: created, error: null, count: created.length };
    }

    const matched = rows.filter((row) => this.matches(row));

    if (this.operation === "update") {
      for (const row of matched) Object.assign(row, this.patch);
      return { data: matched, error: null, count: matched.length };
    }

    if (this.operation === "delete") {
      for (const row of matched) rows.splice(rows.indexOf(row), 1);
      return { data: matched, error: null, count: this.wantsCount ? matched.length : null };
    }

    return { data: matched, error: null, count: this.wantsCount ? matched.length : null };
  }
}
