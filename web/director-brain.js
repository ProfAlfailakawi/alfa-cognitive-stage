// Stateful, local-first director reasoning over what the lecturer says.
// Sources of truth: the lecturer's words, the slide text and the notes. Nothing is searched,
// nothing is invented: every scene line is quoted or derived from those inputs.
// This is NOT neural language understanding: it is explicit Kuwaiti/Gulf/MSA patterns plus
// context (rolling window, topic tracking, slide grounding, pacing). Measured by tests/director-corpus.mjs.
import { interpretSpeech, normalizeArabic, percentMention } from "./director-core.js";
import { lecturerComparison, lecturerRealityContrast, lecturerTakeaway, lecturerTeachingMove } from "./lecturer-profile.js";
import { matchDomainTopic } from "./domain-profile.js";

const WINDOW_MS = 60000;
const MAX_WINDOW = 8;
const STORY_MS = 75000;
const GAP_MS = 15000;          // quiet period after any scene
const MAX_PER_SLIDE = 4;

// ---- spoken Arabic numbers before a percent word: "خمسة وسبعين بالمية" -> 75 ----
const UNITS = { صفر: 0, واحد: 1, احد: 1, اثنين: 2, اثنان: 2, اتنين: 2, ثلاثه: 3, ثلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5,
  سته: 6, ست: 6, سبعه: 7, سبع: 7, ثمانيه: 8, ثمان: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10, حداشر: 11, احدعش: 11, اثنعش: 12, اطنعش: 12,
  ثلطعش: 13, ثلثطعش: 13, اربعطعش: 14, خمسطعش: 15, ستطعش: 16, سبعطعش: 17, ثمنطعش: 18, تسعطعش: 19 };
const TENS = { عشرين: 20, عشرون: 20, ثلاثين: 30, ثلاثون: 30, اربعين: 40, اربعون: 40, خمسين: 50, خمسون: 50,
  ستين: 60, ستون: 60, سبعين: 70, سبعون: 70, ثمانين: 80, ثمانون: 80, تسعين: 90, تسعون: 90 };
const HUNDRED = new Set(["ميه", "مئه", "مايه", "مائه", "ميت"]);
const PERCENT_WORD = /^(?:بالمئه|بالميه|بالمايه|بالمائه|%|في)$/;

function tokenValue(word) {
  const w = word.replace(/^و/, "");
  if (w in TENS) return TENS[w];
  if (HUNDRED.has(w)) return 100;
  if (w in UNITS) return UNITS[w];
  return null;
}
/** Replace spoken numbers that directly precede a percent word with digits. Anything unclear stays as spoken. */
export function numeralizePercents(raw) {
  const words = String(raw || "").split(/(\s+)/);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const token = normalizeArabic(words[i]);
    if (!token || /^\s+$/.test(words[i]) || tokenValue(token) === null) { out.push(words[i]); continue; }
    // Collect a number phrase: [unit] [و tens] or [tens] or hundred.
    let j = i, total = 0, parts = 0, valid = true;
    const used = [];
    while (j < words.length) {
      if (/^\s+$/.test(words[j])) { j++; continue; }
      const t = normalizeArabic(words[j]);
      const value = tokenValue(t);
      if (value === null) break;
      const isTens = t.replace(/^و/, "") in TENS;
      const isHundred = HUNDRED.has(t.replace(/^و/, ""));
      if (parts === 0) total = value;
      else if (isTens && total < 10 && t.startsWith("و")) total = value + total; // خمسه وسبعين
      else if (isTens && total >= 10) { valid = false; break; }
      else { valid = false; break; }
      parts++;
      used.push(j);
      j++;
      if (isHundred) break;
    }
    let k = j;
    while (k < words.length && /^\s+$/.test(words[k])) k++;
    let marker = k < words.length ? normalizeArabic(words[k]) : "";
    let markerEnd = k;
    if (marker === "في" && k + 2 < words.length) {
      const next = normalizeArabic(words[k + 2]);
      if (/^(?:الميه|المئه|المايه|المائه)$/.test(next)) { marker = "%"; markerEnd = k + 2; }
    }
    if (valid && parts > 0 && total <= 100 && PERCENT_WORD.test(marker) && marker !== "في") {
      out.push(String(total));
      i = used[used.length - 1];
      continue;
    }
    if (!valid) {
      // An unclear compound is left entirely as spoken, never half-converted.
      while (j < words.length && tokenValue(normalizeArabic(words[j])) !== null || (j < words.length && /^\s+$/.test(words[j]) && j + 1 < words.length && tokenValue(normalizeArabic(words[j + 1])) !== null)) j++;
      for (let x = i; x < j; x++) out.push(words[x]);
      i = j - 1;
      continue;
    }
    out.push(words[i]);
  }
  return out.join("");
}

// ---- keywords for topic tracking and slide grounding ----
const STOP = new Set(("في من الى على عن ان انه انها هو هي هذا هذه هذي ذلك اللي الي ما لا مو شنو وش ليش شلون كيف يعني زين طيب الحين " +
  "اليوم بس هاي هالشي هذا كان كانت يكون تكون عند عندنا عندكم لو اذا بعد قبل مع او ثم يا الا كل بعض كذا جذي مره لكن بينما اما هم احنا انتم انا نحن " +
  "يلا خلونا راح بنشوف نشوف شوفوا تذكرون فاهمين ماشي تمام والله اكيد صح").split(/\s+/));
export function keywords(text) {
  const normalized = normalizeArabic(text).toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ");
  const set = new Set();
  for (const word of normalized.split(" ")) {
    let w = word;
    if (w.startsWith("لل") && w.length > 4) w = w.slice(2);
    else if (/^(?:ال|بال|وال|لل)/.test(w) && w.length > 4) w = w.replace(/^(?:بال|وال|ال)/, "");
    if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) set.add(w);
  }
  return set;
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / Math.min(a.size, b.size);
}
function digitsOf(text) {
  return [...normalizeArabic(text).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", "."));
}

// ---- extra local detectors (explicit structure only) ----
const CLAUSE_TRIM = /^[\s،,:؛.\-]+|[\s،,:؛.\-]+$/gu;
function trimClause(text, max = 70) {
  const t = text.replace(CLAUSE_TRIM, "");
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
}
function detectContrast(raw) {
  // "X بينما Y" / "أما X وأما Y": both sides must be real clauses spoken by the lecturer.
  const text = raw.trim();
  const m = text.match(/^(?:اما\s+)?(.{12,}?)\s+(?:بينما|في المقابل|بالمقابل|على العكس|اما)\s+(.{12,})$/u);
  if (!m) return null;
  const left = trimClause(m[1]), right = trimClause(m[2].replace(/^(?:ال)?/, ""));
  if (left.split(/\s+/).length < 3 || right.split(/\s+/).length < 3) return null;
  return { type: "compare", title: "مقارنة", lines: [`${left} | ${right}`] };
}
// "التعلم النشط فيه نقاش والمحاضرة فيها استماع": two clauses, each "<subject> <has/relies-on verb> <thing>", joined by و.
// Both clauses are the lecturer's own words, shown as one comparison row; nothing is inferred or added.
const HAS = /^(?:فيه|فيها|عنده|عندها|يعتمد|تعتمد|يحتاج|تحتاج|يركز|تركز|يتميز|تتميز|يعطي|تعطي|يمنح|تمنح)$/;
function detectHasContrast(raw) {
  const words = raw.trim().replace(CLAUSE_TRIM, "").split(/\s+/);
  const verbAt = (from) => words.findIndex((w, i) => i >= from && HAS.test(normalizeArabic(w)));
  const v1 = verbAt(1);
  if (v1 < 1) return null;
  const v2 = verbAt(v1 + 2);
  if (v2 < 0) return null;
  // the second subject starts at a word carrying the joining و, 1-4 words before the second verb
  let k = -1;
  for (let i = v2 - 1; i > v1 + 1 && v2 - i <= 4; i--) if (/^و\S{2,}/u.test(words[i]) || words[i] === "و") k = i;
  if (k < 0) return null;
  const left = words.slice(0, k).join(" "), right = [words[k].replace(/^و/u, ""), ...words.slice(k + 1)].filter(Boolean).join(" ");
  if (left.split(" ").length < 3 || right.split(" ").length < 3 || words.length > 22) return null;
  return { type: "compare", title: "مقارنة", lines: [`${trimClause(left)} | ${trimClause(right)}`] };
}
// Explicit reported speech: "قال الطالب مو فاهم فرديت عليه راجع الشرح". Each turn is the words that follow a speech verb, up to the next one.
const SPEECH = /^(?:قال|قالت|يقول|تقول|سال|سالت|يسال|تسال|رد|ردت|يرد|ترد|اجاب|اجابت|يجيب|تجيب|فقال|فقالت|فرد|فردت|فاجاب)$/;
function detectDialogue(raw) {
  const words = raw.trim().replace(CLAUSE_TRIM, "").split(/\s+/);
  if (words.length > 60) return null;
  const marks = words.map((w, i) => (SPEECH.test(normalizeArabic(w).replace(/^و(?=\S{2,})/u, "")) ? i : -1)).filter((i) => i >= 0);
  if (marks.length < 2 || marks.length > 6) return null;
  const turns = marks.map((at, n) => {
    const end = n + 1 < marks.length ? marks[n + 1] : words.length;
    let body = words.slice(at + 1, end);
    while (body.length && /^(?:و|ف|ثم)$/u.test(body.at(-1))) body.pop();
    while (body.length > 2 && /^(?:عليه|عليها|عليهم|له|لها|لهم)$/u.test(normalizeArabic(body[0]))) body = body.slice(1);
    let who = "";
    if (body.length >= 3 && /^ال\S{2,}$/u.test(normalizeArabic(body[0]).replace(/^ال/, "ال")) ) { who = body[0]; body = body.slice(1); }
    return { who, text: body.join(" ").replace(CLAUSE_TRIM, "") };
  });
  if (turns.some((t) => t.text.split(" ").length < 2 || t.text.length > 90)) return null;
  const lines = turns.map((t) => (t.who ? `${t.who} | ${t.text}` : t.text));
  return { type: "dialogue", title: "حوار", lines };
}
const YEAR = /(?:^|[\s(])((?:19|20)\d{2})(?=$|[\s،,.):])/g;
function detectTimeline(raw) {
  const text = normalizeArabic(raw);
  const hits = [...text.matchAll(YEAR)].map((m) => ({ year: m[1], at: m.index + m[0].indexOf(m[1]), end: m.index + m[0].length }));
  if (hits.length < 2 || hits.length > 6) return null;
  for (let i = 1; i < hits.length; i++) if (Number(hits[i].year) <= Number(hits[i - 1].year)) return null;
  const lines = hits.map((h, i) => {
    const stop = i + 1 < hits.length ? hits[i + 1].at : text.length;
    const clause = text.slice(h.end, stop).replace(/^\s*(?:كان|كانت|صار|صارت)?\s*/, "")
      .replace(/(?:^|\s)(?:في|وفي|سنه|عام|وسنه|وعام)\s*$/u, "").replace(CLAUSE_TRIM, "");
    return clause.length >= 4 ? `${h.year} — ${trimClause(clause, 60)}` : null;
  });
  if (lines.some((l) => !l)) return null;
  return { type: "timeline", title: "تسلسل زمني", lines };
}
// ---- labelled percentages -> bars: "الفئة أ 40% والفئة ب 35% والفئة ج 25%" ----
const LABEL_NOISE = new Set(["و", "في", "كانت", "كان", "نسبه", "نسبة", "ثم", "اللي", "الي", "عند", "عن", "من", "الى", "إلى", "بينما", "اما", "أما", "حوالي", "تقريبا", "تقريباً", "هي", "هو", "يمثلون", "تمثل", "يشكلون", "تشكل", "بلغت", "وصلت", "منهم", "فقط", "كذلك", "وايضا", "أيضا"]);
const PERCENT_MARK = /^(?:%|بالمئه|بالميه|بالمايه|بالمائه|بالمية|بالمئة|بالمائة)$/;
function detectBars(spoken) {
  const tokens = spoken.split(/\s+/).filter(Boolean);
  const spans = []; // { value, words } where words are the candidate label words before the number
  let labelStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const digit = normalizeArabic(tokens[i]);
    const joined = /^\d+(?:[.,]\d+)?%$/.test(digit);
    const numeric = joined || /^\d+(?:[.,]\d+)?$/.test(digit);
    const marker = joined || (numeric && i + 1 < tokens.length && PERCENT_MARK.test(normalizeArabic(tokens[i + 1])));
    if (!marker) continue;
    const number = Number(digit.replace(/%$/, "").replace(",", "."));
    if (!Number.isFinite(number) || number < 0 || number > 100) return null;
    const words = tokens.slice(labelStart, i).map((t) => t.replace(/^و(?=[\u0621-\u064a]{3,})/u, ""))
      .filter((t) => t && !LABEL_NOISE.has(t) && !LABEL_NOISE.has(normalizeArabic(t)) && !/^\d/.test(normalizeArabic(t)));
    spans.push({ value: String(number), words });
    labelStart = i + (joined ? 1 : 2);
    i = labelStart - 1;
  }
  if (spans.length < 3 || spans.length > 6) return null;
  // Later labels start right after the previous number, so they are clean. The first one drags the
  // sentence preamble along; trim it to the typical label length of the others.
  const sizes = spans.slice(1).map((x) => Math.min(3, x.words.length)).sort((a, b) => a - b);
  const typical = Math.max(1, sizes[Math.floor(sizes.length / 2)] || 1);
  const items = spans.map((x, index) => ({ label: x.words.slice(-(index === 0 ? typical : 3)).join(" ").replace(CLAUSE_TRIM, ""), value: x.value }));
  if (items.some((x) => x.label.length < 2)) return null;
  const labels = items.map((x) => x.label);
  if (new Set(labels).size !== labels.length) return null;
  return { type: "bars", title: "توزيع النسب", lines: items.map((x) => x.label + " | " + x.value + "%") };
}
const ACTIVITY = /(?:^|\s)(?:ناقشوا|ناقش|تناقشون|فكروا|اشتغلوا|شاركوا زميلكم|خلونا نسوي نشاط|عندنا نشاط|نشاط سريع|كل واحد يكتب|اكتبوا)(?=\s|$)/;
const MINUTE_WORDS = { دقيقه: 1, دقيقتين: 2, ثلاث: 3, اربع: 4, خمس: 5, ست: 6, سبع: 7, ثمان: 8, تسع: 9, عشر: 10 };
function detectActivity(spoken) {
  const normalized = normalizeArabic(spoken);
  if (!ACTIVITY.test(normalized)) return null;
  const words = spoken.trim().split(/\s+/);
  if (words.length < 4) return null;
  let minutes = null;
  const digit = normalized.match(/(\d{1,3})\s*(?:دقيقه|دقايق|دقائق)/);
  if (digit) minutes = Number(digit[1]);
  else {
    const word = normalized.match(/(دقيقتين|(?:ثلاث|اربع|خمس|ست|سبع|ثمان|تسع|عشر)\w*)\s*(?:دقيقه|دقايق|دقائق)?/);
    if (word) { const key = word[1] === "دقيقتين" ? "دقيقتين" : Object.keys(MINUTE_WORDS).find((k) => word[1].startsWith(k)); minutes = MINUTE_WORDS[key] ?? null; }
    if (!/دقيق|دقايق|دقائق/.test(normalized)) minutes = null;
  }
  if (minutes !== null && (minutes < 1 || minutes > 60)) minutes = null;
  const instruction = trimClause(spoken, 110);
  const lines = [instruction];
  if (minutes !== null) lines.push("المدة: " + minutes + (minutes === 1 ? " دقيقة" : minutes === 2 ? " دقيقتان" : minutes <= 10 ? " دقائق" : " دقيقة"));
  return { type: "activity", title: "نشاط", lines };
}
const CYCLIC = /(?:دوره|حلقه|يتكرر|مستمره|دائريه|مره ثانيه ونرجع للاول)/;
const SHIFT_MARKER = /(?:الحين نتكلم عن|الحين نتحدث عن|ننتقل الى|نروح لموضوع|موضوع ثاني|نغير الموضوع|نبدا موضوع|نتكلم الحين عن)/;
const EXAMPLE = /(?:مثلا|على سبيل المثال|على سبيل الافتراض|خلوني اعطيكم مثال|خذوا مثال|تخيلوا|تخيل|لو افترضنا|فرضا|اتذكر مره من المرات)/;
const CONCEPT = /(?:المقصود ب|نقصد ب|نعني ب|تعريف|يعرف ب|مفهوم)/;
const NARRATIVE = /(?:مره (?:واحد|وحده|كنت|كان)|صار لي موقف|تذكرون|قصه صارت|عندي حاله|خلوني احكي|كان في شخص|كان هناك شخص|بقولكم قصه|احكيلكم قصه|بعطيكم قصه)/;
const CORRECTION = /(?:عفوا|اقصد|قصدي|التصحيح|اصحح|مو قصدي|بل الصحيح|لا غلطت|غلطت)/;
const RETRACT = /(?:انسوا اللي قلت|انسوا هالمعلومه|مو صحيح اللي قلت|تراجع عن|المعلومه غلط|الرقم غلط|هذا غلط)/;

export function createDirectorBrain({ now = () => Date.now() } = {}) {
  let window = [];
  let story = null;
  let topic = new Set();
  let topicStack = [];
  let offTopicStreak = 0;
  let lastShownAt = 0, lastKey = "", lastKeyAt = 0;
  let pendingStat = null; // "25% مقارنة مع…" left hanging, waiting for the second number
  const perSlide = new Map();

  function status(decision, why) { decision.why.push(why); return decision; }
  function blank(extra = {}) {
    return { action: "none", kind: null, spec: null, reason: "", confidence: 0, why: [], domain: null, topic: { shifted: false, returnedTo: null },
      opportunity: null, ...extra };
  }
  function trackTopic(text, d) {
    const words = keywords(text);
    if (words.size < 3) return;
    if (!topic.size) { topic = words; return; }
    const same = overlap(words, topic);
    // An explicit announcement of a new subject is trusted at once.
    if (SHIFT_MARKER.test(normalizeArabic(text)) && same < 0.5) {
      topicStack.push(topic); if (topicStack.length > 5) topicStack.shift();
      topic = words; offTopicStreak = 0; d.topic.shifted = true; story = null;
      return;
    }
    if (same >= 0.2) { for (const w of words) topic.add(w); offTopicStreak = 0; if (topic.size > 40) topic = new Set([...topic].slice(-30)); return; }
    const back = topicStack.findIndex((t) => overlap(words, t) >= 0.34);
    offTopicStreak++;
    if (back >= 0) {
      topicStack.push(topic); topic = topicStack.splice(back, 1)[0]; offTopicStreak = 0;
      d.topic.returnedTo = [...topic].slice(0, 3).join(" ");
      story = null;
    } else if (offTopicStreak >= (story ? 3 : 2)) {
      topicStack.push(topic); if (topicStack.length > 5) topicStack.shift();
      topic = words; offTopicStreak = 0; d.topic.shifted = true; story = null;
    }
  }

  function observe(rawInput, ctx = {}) {
    const raw = String(rawInput || "").trim().slice(0, 950);
    const d = blank();
    if (!raw) return d;
    const t = now();
    const slideIndex = ctx.slide?.index ?? 0;
    const mode = ctx.mode || "balanced";
    const slideDigits = new Set([...digitsOf(ctx.slide?.text || ""), ...digitsOf(ctx.slide?.notes || "")]);
    window.push({ text: raw, at: t, used: false, slide: slideIndex });
    window = window.filter((w) => t - w.at < WINDOW_MS).slice(-MAX_WINDOW);
    const spoken = numeralizePercents(raw);
    const spoken0 = spoken;
    // Earlier sentences may complete a statistic ("في دراسة…" + "ونسبتهم ٦٨ بالمية"), but only when the new
    // sentence itself carries a number, and never sentences that already produced a scene.
    const carriesNumber = /\d|%|بالمي|بالمئ|في المي|في المئ/.test(normalizeArabic(spoken0));
    const recent = carriesNumber
      ? window.filter((w) => t - w.at < 25000 && !w.used).slice(-3).map((w) => numeralizePercents(w.text)).join(" ")
      : "";
    const normalized = normalizeArabic(spoken);

    // Keep the specialty context explicit for the UI and logs. A single alias
    // does not force a scene; it only grounds a scene that the speech rules
    // already accepted.
    const domain = matchDomainTopic([raw, ctx.slide?.text || "", ctx.slide?.notes || ""].join(" "));
    if (domain) d.domain = { id: domain.id, label: domain.label, aliases: domain.matchedAliases };

    trackTopic(spoken, d);
    if (d.topic.shifted) { d.why.push("تغيّر الموضوع؛ أُغلقت القصة المفتوحة"); }

    // 1. Returns are always honoured, even during video or quiet periods.
    let direct = interpretSpeech(spoken);
    // A lecturer asking "شنو الفرق بين ...؟" has not supplied an answer yet.
    if (direct?.kind === "compare" && /(?:شنو|ايش|وش)\s+(?:هو\s+)?الفرق|[؟?]$/.test(normalizeArabic(raw)))
      direct = { kind: "question", confidence: 0.81, utterance: raw };
    if (direct?.kind === "return" || direct?.kind === "return-level") {
      story = null;
      return { ...d, action: direct.kind, kind: direct.kind, confidence: direct.confidence, reason: "عودة مطلوبة من المحاضر" };
    }
    if (ctx.mediaPlaying) {
      // Video speech must never be stitched to the first subsequent lecturer sentence.
      window = []; story = null; pendingStat = null;
      return status(d, "الفيديو يعمل؛ الصمت أفضل");
    }

    // 2. Retractions and corrections are handled carefully: never auto-replace a visible scene.
    if (RETRACT.test(normalized) && ctx.overlay) {
      return { ...d, action: "propose", kind: "retract", spec: null, retract: true, confidence: 0.9,
        reason: "تراجعت عن معلومة؛ هل أخفي المشهد الظاهر؟" };
    }
    const correcting = CORRECTION.test(normalized);
    const withSpecial = direct || (recent ? interpretSpeech(recent) : null);
    const moment = withSpecial;
    const showing = ctx.overlay?.lines?.join(" ") || "";
    if (correcting && ctx.overlay && moment?.spec && digitsOf(showing).join() !== digitsOf(moment.spec.lines.join(" ")).join()) {
      return { ...d, action: "propose", kind: "correction", spec: moment.spec, confidence: 0.9, replace: true,
        reason: "تصحيح الرقم: يحتاج موافقتك قبل استبدال المشهد الظاهر" };
    }

    // 2b. The second half of a comparison the lecturer left hanging ("٢٥٪ مقارنة مع" … "٦٠٪ في المحاضرة"):
    // the two spoken numbers become two bars, each labelled with the lecturer's own words when there are any.
    if (pendingStat && (t - pendingStat.at > 25000 || pendingStat.slide !== slideIndex)) pendingStat = null;
    const second = pendingStat ? percentMention(spoken) : null;
    if (second && second.value !== pendingStat.value) {
      const first = pendingStat; pendingStat = null;
      const names = [first.words || "النسبة الأولى", second.words && second.words !== first.words ? second.words : "النسبة الثانية"];
      const spec = { type: "bars", title: "مقارنة النسب", lines: [`${names[0]} | ${first.value}`, `${names[1]} | ${second.value}`] };
      for (const w of window) w.used = true;
      lastKey = "bars:" + spec.lines[0]; lastKeyAt = t;
      if (mode === "shadow") return status({ ...d, kind: "bars", spec, confidence: 0.96, action: "observe" }, "وضع الظل");
      return { ...d, kind: "bars", spec, confidence: 0.96, action: mode === "safe" ? "propose" : "auto", utterance: first.utterance + " " + raw,
        reason: "أكملتَ المقارنة: الرقمان كما نطقتهما" };
    }

    // 3. Story already in progress: accumulate what was actually said.
    if (moment?.kind === "stat" && moment.dangling) {
      const p = percentMention(spoken);
      pendingStat = { value: moment.spec.lines[0], words: p?.words && p.words.split(" ").length >= 2 ? p.words : "", at: t, slide: slideIndex, utterance: raw };
    }
    if (story && (story.slide !== slideIndex || t - story.started > STORY_MS)) story = null;
    if (story && !moment) {
      const clean = raw.trim();
      if (clean.length >= 15 && story.last !== clean) {
        story.last = clean; story.events.push(clean.slice(0, 100)); story.events = story.events.slice(0, 4);
        if (story.events.length >= 2) {
          const spec = { type: "story", title: "قصة", lines: [...story.events] };
          return finalize({ ...d, kind: "story", spec, confidence: mode === "creative" ? 0.9 : 0.8,
            reason: "قصة من حديثك كما نطقتها دون اختراع أحداث. راجع النص قبل إظهاره.", storyAuto: true, utterance: story.events.join(" ") });
        }
      }
      return status(d, "قصة جارية؛ بانتظار المزيد");
    }

    // 4. Local structure detectors without an API.
    let found = moment;
    const exactDifference = lecturerComparison(raw) || lecturerRealityContrast(raw);
    if (exactDifference && (!found || found.kind === "compare"))
      found = { kind: "compare", confidence: 0.86, spec: exactDifference, utterance: raw };
    if (!found || (found.kind === "compare" && !found.spec)) {
      const timeline = detectTimeline(spoken);
      if (timeline) found = { kind: "timeline", confidence: 0.9, spec: timeline, utterance: raw };
      else {
        const prev = window.at(-2);
        const earlier = prev && prev.slide === slideIndex && !prev.used && t - prev.at <= 16000 ? prev.text : "";
        const contrast = detectContrast(spoken) || detectHasContrast(spoken) || lecturerComparison(raw, earlier);
        if (contrast) found = { kind: "compare", confidence: 0.86, spec: contrast, utterance: raw };
      }
    }
    if (found?.kind === "steps" && found.spec && CYCLIC.test(normalized)) {
      found = { ...found, kind: "cycle", confidence: 0.9, spec: { ...found.spec, type: "cycle", title: "دورة" } };
    }
    if (!found) {
      const bars = detectBars(spoken);
      if (bars) found = { kind: "bars", confidence: 0.88, spec: bars, utterance: raw };
      else {
        const activity = detectActivity(spoken);
        if (activity) found = { kind: "activity", confidence: 0.84, spec: activity, utterance: raw };
        else {
          const dialogue = detectDialogue(spoken);
          if (dialogue) found = { kind: "dialogue", confidence: 0.8, spec: dialogue, utterance: raw };
        }
      }
    }
    if (!found) {
      const takeaway = lecturerTakeaway(raw);
      if (takeaway) found = { kind: "quote", confidence: 0.84, spec: takeaway, utterance: raw };
    }
    if (!found) {
      const teachingMove = lecturerTeachingMove(raw);
      if (teachingMove.kind === "question") found = { kind: "question", confidence: 0.82, utterance: raw };
    }
    if (!found) {
      if (NARRATIVE.test(normalized)) found = { kind: "story", confidence: 0.85, utterance: raw };
      else if (CONCEPT.test(normalized)) found = { kind: "concept", confidence: 0.7, utterance: raw };
      else if (EXAMPLE.test(normalized)) found = { kind: "example", confidence: 0.65, utterance: raw };
    }
    if (!found) return status(d, "لا فرصة بصرية واضحة");

    if (found.kind === "story") {
      story = { slide: slideIndex, started: t, last: raw, events: [raw.slice(0, 100)] };
    }
    d.kind = found.kind; d.confidence = found.confidence; d.spec = found.spec || null; d.utterance = found.utterance || raw;
    if (d.spec) for (const w of window) w.used = true;
    if (found.kind === "question") d.reason = "سؤال موجه للطلبة";

    // 5. Redundancy: a statistic already printed on the slide adds nothing.
    if (d.spec && (d.kind === "stat" || d.kind === "compare") && slideDigits.size) {
      const shown = digitsOf(d.spec.lines.join(" "));
      if (shown.length && shown.every((n) => slideDigits.has(n))) return status({ ...d, action: "none", spec: null }, "الرقم ظاهر أصلاً في الشريحة");
    }

    // 6. Pacing and duplicates.
    const key = d.kind + ":" + (d.spec?.lines?.[0] || raw.slice(0, 35));
    if (key === lastKey && t - lastKeyAt < 15000) return status({ ...d, action: "none" }, "تكرار قريب");
    lastKey = key; lastKeyAt = t;
    return finalize(d);

    function finalize(decision) {
      decision.utterance = decision.utterance || raw;
      if (!decision.spec) {
        decision.action = "none";
        decision.opportunity = decision.kind;
        return status(decision, "فرصة بدون بيانات كافية لبناء مشهد محلي");
      }
      if (mode === "shadow") return status({ ...decision, action: "observe" }, "وضع الظل");
      const count = perSlide.get(slideIndex) || 0;
      if (count >= MAX_PER_SLIDE) return status({ ...decision, action: "none" }, "بلغ الحد الأعلى لاقتراحات هذه الشريحة");
      if (t - lastShownAt < GAP_MS && decision.kind !== "steps") return status({ ...decision, action: "none" }, "فترة هدوء بعد المشهد السابق");
      const auto = (mode === "balanced" && decision.confidence >= 0.95 && ["stat", "steps"].includes(decision.kind) ||
        mode === "balanced" && decision.confidence >= 0.96 && decision.kind === "bars" && decision.spec.lines.length === 2 ||
        mode === "balanced" && decision.confidence >= 0.95 && decision.kind === "compare" && decision.spec.lines.length === 1 && /^(?:من|كانت)/.test(decision.spec.lines[0]) ||
        mode === "creative" && (decision.storyAuto && decision.kind === "story" || decision.confidence >= 0.95));
      decision.action = auto ? "auto" : "propose";
      return decision;
    }
  }

  return {
    observe,
    // Reversible navigation commands may act on a stable interim transcript; nothing else may.
    peekReturn(text) {
      const kind = interpretSpeech(numeralizePercents(String(text || "")))?.kind;
      return kind === "return" || kind === "return-level" ? kind : null;
    },
    noteShown(slideIndex) {
      lastShownAt = now();
      perSlide.set(slideIndex, (perSlide.get(slideIndex) || 0) + 1);
    },
    resetSlide() { story = null; },
    reset() { window = []; story = null; topic = new Set(); topicStack = []; perSlide.clear(); lastShownAt = 0; },
    snapshot: () => ({ window: window.length, topicWords: topic.size, topics: topicStack.length, storyOpen: Boolean(story) }),
  };
}
