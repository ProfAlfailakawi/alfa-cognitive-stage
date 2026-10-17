// Anonymous aggregate distributions, not student-level profiles or learning diagnoses.
function identity(p) { return JSON.stringify([p.question, p.options]); }
const percentage=(n,total)=>total?100*n/total:0;
export function compareRounds(polls) {
  const groups=new Map();
  for (const p of (Array.isArray(polls)?polls:[])) {
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
function escapeCsv(value){
  let s=String(value??"");
  if (/^[\s]*[=+\-@]/.test(s)) s="'"+s; // Prevent spreadsheet formula injection.
  return '"'+s.replace(/"/g,'""')+'"';
}
export function exportAggregateCsv(polls) {
  const rows=[["رمز الجولة","السؤال","الخيار","عدد الأصوات","إجمالي الجولة","النسبة المئوية"]];
  for (const p of polls) {
    const total=p.total||0;
    p.options.forEach((option,i)=>rows.push([
      p.id,p.question,option,p.counts?.[i]||0,total,
      percentage(p.counts?.[i]||0,total).toFixed(1)
    ]));
  }
  return "\ufeff"+rows.map(row=>row.map(escapeCsv).join(",")).join("\r\n");
}
