// Local specialty profile distilled from the public teaching glossary/map.
// It steers scene choice only; it never invents facts or replaces speech.
import { normalizeArabic } from "./director-core.js";

const TOPICS = [
  { id: "educational-technology", label: "تكنولوجيا التعليم", objective: "تمييز تكنولوجيا التعليم بوصفها منظومة متكاملة لا مجرد أجهزة", aliases: ["تكنولوجيا التعليم", "التكنولوجيا التعليمية", "تقنيات التعليم", "وسائل التعليم", "edtech"], preferred: ["concept", "flow", "compare"], avoid: ["روبوتات عامة", "شاشات زرقاء بلا سياق", "دوائر إلكترونية زخرفية"] },
  { id: "instructional-design", label: "التصميم التعليمي", objective: "ربط التحليل والتصميم والتطوير والتنفيذ والتقويم", aliases: ["التصميم التعليمي", "تصميم التعليم", "تصميم التدريس", "ADDIE", "نماذج التصميم"], preferred: ["steps", "flow", "cycle"], avoid: ["أجهزة بلا هدف", "مخطط عام بلا أهداف"] },
  { id: "digital-learning", label: "التعلّم الرقمي", objective: "عرض التعلم الرقمي كتجربة تجمع المحتوى والتفاعل والتقويم", aliases: ["التعلم الرقمي", "التعليم الرقمي", "التعليم الإلكتروني", "التعلم الإلكتروني", "التعلم عن بعد"], preferred: ["flow", "compare", "timeline"], avoid: ["لابتوب على طاولة فقط", "أيقونات سحابية زخرفية"] },
  { id: "learning-games", label: "التلعيب والتعلّم القائم على الألعاب", objective: "التمييز بين عناصر الألعاب واللعبة التعليمية ذات الهدف", aliases: ["التلعيب", "التعلم باللعب", "التعلم القائم على الألعاب", "الألعاب التعليمية", "gamification"], preferred: ["steps", "compare", "activity"], avoid: ["ألعاب قتالية", "مظاهر طفولية", "منافسة عدائية"] },
  { id: "inclusive-education", label: "تكنولوجيا التعليم لذوي الاحتياجات الخاصة", objective: "اختيار التكنولوجيا المساعدة وفق حاجة المتعلم وهدف الموقف", aliases: ["ذوي الاحتياجات الخاصة", "التكنولوجيا المساعدة", "التعليم الدامج", "الإعاقة"], preferred: ["compare", "flow", "concept"], avoid: ["صور شفقة", "رموز طبية بلا سياق"] },
  { id: "virtual-learning", label: "الواقع الافتراضي والمعزز", objective: "ربط نوع البيئة الافتراضية بهدف تعلم واضح", aliases: ["الواقع الافتراضي", "الواقع المعزز", "العالم الافتراضي", "الواقع المختلط"], preferred: ["compare", "flow", "timeline"], avoid: ["مستقبلية عامة", "دوائر تقنية بلا معنى"] },
  { id: "smart-school", label: "المدرسة الذكية", objective: "إظهار المدرسة الذكية كنظام تعلم لا كمبنى مزود بأجهزة", aliases: ["المدرسة الذكية", "الفصول الذكية", "مدرسة المستقبل"], preferred: ["flow", "concept", "compare"], avoid: ["مبنى لامع بلا متعلم"] },
  { id: "educational-media", label: "الوسائل والاتصال التعليمي", aliases: ["الوسائل التعليمية", "الاتصال التعليمي", "نظرية الاتصال", "الرسالة التعليمية"], preferred: ["flow", "compare", "concept"], avoid: ["ميكروفون أو شاشة بلا علاقة بالرسالة"] },
];
const clean = (value) => normalizeArabic(String(value || "")).toLowerCase();
export function domainTopics() { return TOPICS.map((topic) => ({ ...topic, aliases: [...topic.aliases], preferred: [...topic.preferred], avoid: [...topic.avoid] })); }
export function matchDomainTopic(text) {
  const haystack = clean(text); let best = null;
  for (const topic of TOPICS) {
    const hits = topic.aliases.filter((alias) => haystack.includes(clean(alias)));
    if (!hits.length) continue;
    const score = hits.reduce((sum, hit) => sum + clean(hit).length, 0);
    if (!best || score > best.score) best = { ...topic, matchedAliases: hits, score };
  }
  return best;
}
export function domainSceneGuidance(text, type) {
  const topic = matchDomainTopic(text);
  return topic ? { topic: topic.id, label: topic.label, preferred: topic.preferred.includes(type), avoid: topic.avoid } : { topic: null, preferred: false, avoid: [] };
}
export function topicPrompt(text) { const topic = matchDomainTopic(text); return topic ? `موضوع المحاضرة: ${topic.label}` : ""; }
