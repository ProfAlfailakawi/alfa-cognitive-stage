// Local, no-transcript ledger for optional billed director requests.
// A daily reservation is written BEFORE any request to the cloud provider.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class DirectorQuotaError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
function healthyCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function fresh(day) {
  return { version: 1, day, callsUsed: 0, reportedCalls: 0,
    inputTokens: 0, outputTokens: 0, unknownUsageCalls: 0 };
}
function validateData(value) {
  if (!value || value.version !== 1 || typeof value.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
      !["callsUsed", "reportedCalls", "inputTokens", "outputTokens", "unknownUsageCalls"]
        .every(key => healthyCounter(value[key])) ||
      value.reportedCalls > value.callsUsed || value.unknownUsageCalls > value.reportedCalls)
    throw new DirectorQuotaError("ملف حدود API غير سليم؛ أوقفت الطلبات المدفوعة لحمايتك.");
  return value;
}
function boundedMax(maxCalls) {
  const n = Number(maxCalls);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : 0;
}
export function createDirectorQuota({ file, now = () => Date.now() }) {
  if (!file || typeof file !== "string") throw new TypeError("A quota file path is required");
  const today = () => new Date(now()).toISOString().slice(0, 10); // UTC, explicitly documented.
  function read(day) {
    try {
      if (!existsSync(file)) return fresh(day);
      const data = validateData(JSON.parse(readFileSync(file, "utf8")));
      return data.day === day ? data : fresh(day);
    } catch (error) {
      if (error instanceof DirectorQuotaError) throw error;
      throw new DirectorQuotaError("تعذر قراءة سجل حدود API؛ أوقفت الطلبات المدفوعة لحمايتك.");
    }
  }
  function persist(data) {
    const temp = file + "." + process.pid + "." + randomBytes(6).toString("hex") + ".tmp";
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
      renameSync(temp, file); // Atomic replacement on the same local volume.
    } catch {
      throw new DirectorQuotaError("تعذر حفظ سقف API اليومي؛ لن أرسل طلباً مدفوعاً.");
    } finally {
      try { unlinkSync(temp); } catch {}
    }
  }
  function status(maxCalls) {
    const day = today(), max = boundedMax(maxCalls);
    try {
      const data = read(day);
      return { ...data, maxCalls: max, callsRemaining: Math.max(0, max - data.callsUsed),
        unreportedCalls: data.callsUsed - data.reportedCalls, healthy: true, scope: "utc-day" };
    } catch {
      return { day, maxCalls: max, callsUsed: null, callsRemaining: 0,
        inputTokens: null, outputTokens: null, unknownUsageCalls: null,
        unreportedCalls: null, healthy: false, scope: "utc-day" };
    }
  }
  function reserve(maxCalls) {
    const day = today();
    const data = read(day); // Corrupt or unreadable data fails closed.
    if (data.callsUsed >= boundedMax(maxCalls)) {
      throw new DirectorQuotaError("وصل المخرج إلى سقف طلبات API اليومي؛ استخدم المشاهد المحلية.", 429);
    }
    data.callsUsed++;
    persist(data); // No cloud call can happen unless this succeeds.
    return { day };
  }
  function report(day, usage) {
    if (day !== today()) return false; // A call finishing after UTC midnight is not charged to tomorrow.
    const data = read(day);
    if (data.reportedCalls >= data.callsUsed) return false; // No double recording.
    const valid = usage && healthyCounter(usage.inputTokens) && healthyCounter(usage.outputTokens) &&
      Number.isSafeInteger(data.inputTokens + usage.inputTokens) &&
      Number.isSafeInteger(data.outputTokens + usage.outputTokens);
    data.reportedCalls++;
    if (valid) {
      data.inputTokens += usage.inputTokens;
      data.outputTokens += usage.outputTokens;
    } else data.unknownUsageCalls++;
    persist(data);
    return true;
  }
  return { status, reserve, report };
}
