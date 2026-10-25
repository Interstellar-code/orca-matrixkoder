// Minimal types for Node 24's built-in node:sqlite (the installed @types/node 20 does not ship them).
declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;
  export type SQLOutputValue = null | number | bigint | string | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    run(...params: SQLInputValue[]): StatementResultingChanges;
    run(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): StatementResultingChanges;
    get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    get(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    all(...params: SQLInputValue[]): Record<string, SQLOutputValue>[];
    all(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): Record<string, SQLOutputValue>[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean; timeout?: number });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    readonly isOpen: boolean;
    readonly isTransaction: boolean;
  }
}
