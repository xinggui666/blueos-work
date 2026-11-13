/** 积分账户：预扣 → 确认 / 释放，每次变动写流水（规格 12.4）。调用方负责放在事务里。 */
import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import type { QuotaKind } from "./policy";

function id(prefix: string): string {
  return prefix + randomBytes(8).toString("hex");
}

export async function ensureQuota(sql: Sql, userId: string, kind: QuotaKind) {
  await sql.query(
    "insert into quota_accounts (user_id, kind, balance, reserved) values ($1,$2,0,0) on conflict (user_id, kind) do nothing",
    [userId, kind],
  );
}

export async function ledger(sql: Sql, userId: string, kind: string, delta: number, phase: string, ref: string, note: string) {
  await sql.query(
    "insert into quota_ledger (id, user_id, kind, delta, phase, ref, note) values ($1,$2,$3,$4,$5,$6,$7)",
    [id("q"), userId, kind, delta, phase, ref, note],
  );
}

export async function grantQuota(sql: Sql, userId: string, kind: QuotaKind, amount: number, phase: "grant" | "adjust", ref: string, note: string) {
  if (!Number.isInteger(amount) || amount === 0) return;
  await ensureQuota(sql, userId, kind);
  const updated = await sql.query(
    "update quota_accounts set balance = balance + $3 where user_id = $1 and kind = $2 and balance + $3 >= reserved returning balance",
    [userId, kind, amount],
  );
  if (!updated.length) throw new Error("额度不足，不能扣成负数");
  await ledger(sql, userId, kind, amount, phase, ref, note);
}

export async function reserve(sql: Sql, userId: string, kind: QuotaKind, ref: string): Promise<boolean> {
  await ensureQuota(sql, userId, kind);
  const updated = await sql.query(
    "update quota_accounts set reserved = reserved + 1 where user_id = $1 and kind = $2 and balance - reserved >= 1 returning reserved",
    [userId, kind],
  );
  if (!updated.length) return false;
  await ledger(sql, userId, kind, 1, "reserve", ref, "预留 1");
  return true;
}

export async function commitQuota(sql: Sql, userId: string, kind: QuotaKind, ref: string) {
  const updated = await sql.query(
    "update quota_accounts set balance = balance - 1, reserved = reserved - 1 where user_id = $1 and kind = $2 and reserved >= 1 and balance >= 1 returning balance",
    [userId, kind],
  );
  if (!updated.length) throw new Error("额度确认失败");
  await ledger(sql, userId, kind, -1, "commit", ref, "确认消耗 1");
}

export async function release(sql: Sql, userId: string, kind: QuotaKind, ref: string, note: string) {
  const updated = await sql.query(
    "update quota_accounts set reserved = reserved - 1 where user_id = $1 and kind = $2 and reserved >= 1 returning reserved",
    [userId, kind],
  );
  if (updated.length) await ledger(sql, userId, kind, -1, "release", ref, note);
}

