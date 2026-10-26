/** mk-data.db migration 2 (C10): the scenario a task's brief is rendered from. Nullable, so existing rows stay NULL. */
export const SCHEMA_V2 = "ALTER TABLE plan_task ADD COLUMN scenario TEXT CHECK(scenario IS NULL OR scenario IN ('investigate','implement','subdispatch','review','fix'))";
