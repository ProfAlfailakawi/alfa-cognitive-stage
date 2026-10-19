// Anonymous aggregate distributions, not student-level profiles or learning diagnoses.
function identity(p) { return JSON.stringify([p.question, p.options]); }
const percentage=(n,total)=>total?100*n/total:0;
export function compareRounds(polls) {
  const groups=new Map();
  for (const p of (Array.isArray(polls)?polls:[])) {
    if (p.kind==="words") continue; // clouds have no fixed options to compare
    const key=identity(p);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(p);
  }
  const results=[];
  for (const sequence of groups.values()) {
    if (sequence.length<2) continue;
    sequence.sort((a,b)=>a.id-b.id);
    const first=sequence[0],last=sequence.at(-1);
    const a=first.total||0,b=last.total||0;
    if (!a || !b) continue;
    results.push({
      question:first.question,firstId:first.id,lastId:last.id,firstTotal:a,lastTotal:b,
      values:first.options.map((option,i)=>({
        option,
        firstPercent:Number(percentage(first.counts[i]||0,a).toFixed(1)),
        lastPercent:Number(percentage(last.counts[i]||0,b).toFixed(1)),
        deltaPoints:Number((percentage(last.counts[i]||0,b)-percentage(first.counts[i]||0,a)).toFixed(1))
      }))
    });
  }
  return results;
}

// Lecturer-only, deterministic guidance from anonymous counts.
// No correct answer or learning outcome is inferred from a vote distribution.
export function summarizePollDistribution(poll) {
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2 ||
      !Array.isArray(poll.counts) || poll.counts.length !== poll.options.length ||
      !Number.isSafeInteger(poll.total) || poll.total < 0 ||
      poll.counts.some(n => !Number.isSafeInteger(n) || n < 0) ||
      poll.counts.reduce((sum, n) => sum + n, 0) !== poll.total) return null;
  const total = poll.total;
  if (!total) return { kind: "empty",
    text: "لا توجد إجابات بعد؛ انتظر مشاركة الطلبة قبل تفسير التوزيع." };
  if (total < 8) return { kind: "small",
    text: "عدد المشاركات قليل؛ انتظر مزيداً من الإجابات قبل مناقشة نمط الاختيارات." };
  const sorted = [...poll.counts].sort((a,b) => b-a);
  const largest = sorted[0] / total;
  const runnerUp = sorted[1] / total;
  // Only describe concentration; popularity never implies an objectively correct answer.
  if (largest >= 0.75) return { kind: "concentrated",
    text: "معظم الإجابات اتجهت إلى اختيار واحد. اسأل عن الأسباب أو مثال مضاد؛ الأغلبية لا تثبت صحة الاختيار." };
  if (sorted[0] - sorted[1] <= total * 0.15 && sorted[0] + sorted[1] >= total * 0.65) return { kind: "divided",
    text: "هناك تقارب بين أكثر اختيارين. اطلب توضيح مبررات كل رأي قبل إعادة طرح السؤال." };
  return { kind: "varied",
    text: "الإجابات موزّعة على بدائل مختلفة. ناقش الفروق بين البدائل ثم أعد السؤال إن كان ذلك مفيداً." };
}

function escapeCsv(value){
  let s=String(value??"");
  if (/^[\s]*[=+\-@]/.test(s)) s="'"+s; // Prevent spreadsheet formula injection.
  return '"'+s.replace(/"/g,'""')+'"';
}
export function exportAggregateCsv(polls) {
  const rows=[["رمز الجولة","السؤال","الخيار","عدد الأصوات","إجمالي الجولة","النسبة المئوية","هدف التعلم"]];
  for (const p of polls) {
    const total=p.total||0;
    if (p.kind==="words") {
      // Aggregate word counts only (hidden words are left out): no student text beyond single moderated words.
      for (const w of (p.words||[]).filter(x=>!x.hidden)) rows.push([p.id,p.question,w.word,w.count,total,percentage(w.count,total).toFixed(1),p.objective||""]);
      continue;
    }
    p.options.forEach((option,i)=>rows.push([
      p.id,p.question,option,p.counts?.[i]||0,total,
      percentage(p.counts?.[i]||0,total).toFixed(1),p.objective||""
    ]));
  }
  return "\ufeff"+rows.map(row=>row.map(escapeCsv).join(",")).join("\r\n");
}

/** Only explicitly paired rounds, no assumed student-level matching or causal inference. */
export function compareLinkedBeforeAfter(polls) {
  const list = Array.isArray(polls) ? polls : [];
  const pairs = [];
  for (const before of list.filter((p) => p.pulsePhase === "before")) {
    const after = list.find((p) => p.pulsePair === before.id && p.pulsePhase === "after");
    if (!after || before.question !== after.question ||
        JSON.stringify(before.options) !== JSON.stringify(after.options)) continue;
    const a = before.total || 0, b = after.total || 0;
    pairs.push({ beforeId: before.id, afterId: after.id, question: before.question, firstTotal: a,
      lastTotal: b, correctIndex: before.correctIndex ?? null,
      values: before.options.map((option, i) => {
        const first = a ? 100 * (before.counts?.[i] || 0) / a : 0;
        const last = b ? 100 * (after.counts?.[i] || 0) / b : 0;
        return { option, firstPercent: +first.toFixed(1), lastPercent: +last.toFixed(1),
          deltaPoints: +(last - first).toFixed(1) };
      }),
      warning: Math.min(a, b) < 8
        ? "حجم المشاركات محدود؛ لا تعمم النتيجة. لا يوجد ربط بين هويات المشاركين."
        : "التغير في توزيع الإجابات ليس دليلاً سببياً على أثر الشرح، وقد يختلف المشاركون." });
  }
  return pairs;
}
