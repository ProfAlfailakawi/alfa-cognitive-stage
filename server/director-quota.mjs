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
const HISTORY_DAYS = 14;
function fresh(day, history = []) {
  return { version: 2, day, callsUsed: 0, reportedCalls: 0,
    inputTokens: 0, outputTokens: 0, unknownUsageCalls: 0, spentMicros: 0, heldMicros: 0, history };
}
function validHistory(list) {
  return Array.isArray(list) && list.length <= HISTORY_DAYS && list.every((x) => x && typeof x.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.day) && ["calls", "inputTokens", "outputTokens", "estimatedMicros"].every((k) => healthyCounter(x[k])));
}
function validateData(value) {
  if (value && value.version === 1) value = { ...value, version: 2, spentMicros: 0, heldMicros: 0, history: [] };
  if (!value || value.version !== 2 || typeof value.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
      !["callsUsed", "reportedCalls", "inputTokens", "outputTokens", "unknownUsageCalls", "spentMicros", "heldMicros"]
        .every(key => healthyCounter(value[key])) || !validHistory(value.history) ||
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
      if (data.day === day) return data;
      // Keep a short, text-free daily summary of earlier days (calls, tokens, estimated dollars).
      const summary = { day: data.day, calls: data.callsUsed, inputTokens: data.inputTokens,
        outputTokens: data.outputTokens, estimatedMicros: data.spentMicros + data.heldMicros };
      return fresh(day, [...data.history, summary].slice(-HISTORY_DAYS));
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
  function status(maxCalls, capMicros = null) {
    const day = today(), max = boundedMax(maxCalls);
    try {
      const data = read(day);
      const estimatedMicros = data.spentMicros + data.heldMicros;
      return { ...data, maxCalls: max, estimatedMicros, capMicros,
        capRemainingMicros: capMicros === null ? null : Math.max(0, capMicros - estimatedMicros), callsRemaining: Math.max(0, max - data.callsUsed),
        unreportedCalls: data.callsUsed - data.reportedCalls, healthy: true, scope: "utc-day" };
    } catch {
      return { day, maxCalls: max, estimatedMicros: null, capMicros, capRemainingMicros: 0, history: [],
        spentMicros: null, heldMicros: null, callsUsed: null, callsRemaining: 0,
        inputTokens: null, outputTokens: null, unknownUsageCalls: null,
        unreportedCalls: null, healthy: false, scope: "utc-day" };
    }
  }
  // `budget` = { capMicros, worstMicros }. With a dollar cap, a request is allowed only when the
  // worst case it could cost still fits under the cap together with everything already spent or held.
  function reserve(maxCalls, budget = null) {
    const day = today();
    const data = read(day); // Corrupt or unreadable data fails closed.
    if (data.callsUsed >= boundedMax(maxCalls)) {
      throw new DirectorQuotaError("وصل المخرج إلى سقف طلبات API اليومي؛ استخدم المشاهد المحلية.", 429);
    }
    let held = 0;
    if (budget && budget.capMicros !== null && budget.capMicros !== undefined) {
      if (!healthyCounter(budget.worstMicros)) {
        throw new DirectorQuotaError("لا يوجد سعر موثوق للنموذج؛ لا يمكن ضمان سقف الدولار فأُوقف الطلب المدفوع.", 503);
      }
      if (data.spentMicros + data.heldMicros + budget.worstMicros > budget.capMicros) {
        throw new DirectorQuotaError("بلغ تقدير الإنفاق اليومي سقف الدولار المضبوط؛ استخدم المشاهد المحلية.", 429);
      }
      held = budget.worstMicros;
    }
    data.callsUsed++;
    data.heldMicros += held;
    persist(data); // No cloud call can happen unless this succeeds.
    return { day, heldMicros: held };
  }
  // `settle` = { heldMicros, costMicros }: release the hold and charge the actual cost, or the whole
  // hold (worst case) when the cost is unknown (costMicros === null).
  function report(day, usage, settle = null) {
    if (day !== today()) return false; // A call finishing after UTC midnight is not charged to tomorrow.
    const data = read(day);
    if (data.reportedCalls >= data.callsUsed) return false; // No double recording.
    const valid = usage && healthyCounter(usage.inputTokens) && healthyCounter(usage.outputTokens) &&
      Number.isSafeInteger(data.inputTokens + usage.inputTokens) &&
      Number.isSafeInteger(data.outputTokens + usage.outputTokens);
    data.reportedCalls++;
    if (settle && healthyCounter(settle.heldMicros)) {
      const charged = settle.costMicros === null || settle.costMicros === undefined
        ? settle.heldMicros : settle.costMicros;
      data.heldMicros = Math.max(0, data.heldMicros - settle.heldMicros);
      data.spentMicros += charged;
    }
    if (valid) {
      data.inputTokens += usage.inputTokens;
      data.outputTokens += usage.outputTokens;
    } else data.unknownUsageCalls++;
    persist(data);
    return true;
  }
  return { status, reserve, report };
}
