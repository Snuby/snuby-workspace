// 关键诊断日志: 落盘到用户数据目录, 同时打到进程 stdout。
import fs from "node:fs";
import path from "node:path";
import { userDataPath } from "./user-data-paths";

const LOG_DIR = userDataPath("logs");
const LOG_FILE = path.join(LOG_DIR, "snuby-acp.log");

/** 北京时间时间戳 (Asia/Shanghai, 固定 UTC+8) */
function beijingStamp(d = new Date()): string {
  // sv-SE → "YYYY-MM-DD HH:mm:ss"
  const base = d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${base.replace(" ", "T")}.${ms}+08:00`;
}

/** 追加一行关键日志。失败静默, 不影响业务。 */
export function snubyLog(scope: string, line: string): void {
  const text = `[${beijingStamp()}] [${scope}] ${line}\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, text);
  } catch {
    // ignore
  }
  console.info(`[snuby:${scope}] ${line}`);
}

export function snubyLogPath(): string {
  return LOG_FILE;
}
