import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { ArenaService } from "./service.js";

export class PostgresArenaService extends ArenaService {
  constructor(config, connectionString, options) {
    super(config, null, options);
    this.pool = new pg.Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000 });
    this.transactions = new AsyncLocalStorage();
  }

  async init() {
    await this.pool.query("SELECT 1 FROM arena.records LIMIT 1");
    return this;
  }

  query(sql, values) {
    return (this.transactions.getStore() || this.pool).query(sql, values);
  }

  async serial(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('airspace-arena'))");
      const result = await this.transactions.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async save(folder, id, value) {
    await this.query(
      "INSERT INTO arena.records(folder,id,data) VALUES ($1,$2,$3) ON CONFLICT(folder,id) DO UPDATE SET data=excluded.data",
      [folder, id, value],
    );
  }

  async loadRecord(folder, id) {
    const result = await this.query("SELECT data FROM arena.records WHERE folder=$1 AND id=$2", [folder, id]);
    if (!result.rowCount) throw Object.assign(new Error("Unknown record"), { code: "ENOENT" });
    return result.rows[0].data;
  }

  async *records(folder) {
    const result = await this.query("SELECT data FROM arena.records WHERE folder=$1", [folder]);
    for (const row of result.rows) yield row.data;
  }

  async cleanup() {
    await this.query("DELETE FROM arena.records WHERE folder='sessions' AND (data->>'expiresAt')::bigint < $1", [Date.now()]);
    const result = await this.query("SELECT count(*)::integer AS count FROM arena.records WHERE folder='sessions'");
    return result.rows[0].count;
  }
}
