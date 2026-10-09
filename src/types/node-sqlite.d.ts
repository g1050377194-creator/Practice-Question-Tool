declare module "node:sqlite" {
  interface StatementResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  type SqlValue = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    run(...params: SqlValue[]): StatementResult;
    get(...params: SqlValue[]): unknown;
    all(...params: SqlValue[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
