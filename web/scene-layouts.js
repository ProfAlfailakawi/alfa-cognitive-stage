// Additional lightweight, deterministic vector scenes.
const E = (value) => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
 .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const C={bg:"#f4f5f3",blue:"#3e5c78",ink:"#15161a",mute:"#5e6570",edge:"#d4d9da",gold:"#8f5a28",white:"#ffffff"};
function splitLines(value,limit=24,maxRows=3) {
 const words=String(value).split(/\s+/),rows=[];let current="";
 for(const w of words) {
  if(current && (current+" "+w).length>limit) {rows.push(current);current=w;}
  else current=(current+" "+w).trim();
 }
 if(current)rows.push(current);
 if(rows.length>maxRows) {
  const cut=rows.slice(0,maxRows);
  cut[maxRows-1]=cut[maxRows-1].slice(0,Math.max(1,limit-2))+"…";
  return cut;
 }
 return rows;
}
function label(value,x,y,{size=21,color=C.ink,limit=24,rows=3}={}) {
 return '<text x="'+x+'" y="'+y+'" fill="'+color+'" font-size="'+size+
  '" text-anchor="middle" direction="rtl">'+splitLines(value,limit,rows).map((t,i)=>
  '<tspan x="'+x+'" dy="'+(i?28:0)+'">'+E(t)+'</tspan>').join("")+'</text>';
}
function base(title,inside) {
 return '<svg viewBox="0 0 960 540" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="'+E(title)+'">'+
  '<rect width="960" height="540" fill="'+C.bg+'"/>'+
  label(title,480,75,{size:34,color:C.blue,limit:42,rows:2})+inside+'</svg>';
}
export function renderStructuredScene(type,title,lines) {
 if(type==="concept") {
  const nodes=lines.map((v,i)=>{
   const x=195+(i%3)*285,y=208+Math.floor(i/3)*175;
   return '<line x1="480" y1="121" x2="'+x+'" y2="'+(y-62)+'" stroke="'+C.edge+'" stroke-width="3"/>'+
    '<rect x="'+(x-126)+'" y="'+(y-56)+'" width="252" height="118" rx="16" fill="'+C.white+'" stroke="'+C.edge+'"/>'+
    label(v,x,y-12,{limit:22,rows:3});
  }).join("");
  return base(title,nodes);
 }
 if(type==="flow") {
  const step=380/lines.length;
  const nodes=lines.map((v,i)=>{
   const y=116+i*step,h=Math.min(65,step-7);
   return '<rect x="190" y="'+y+'" width="580" height="'+h+'" rx="14" fill="'+(i%2? "#e7eef1":C.white)+'" stroke="'+C.edge+'"/>'+
    '<circle cx="737" cy="'+(y+h/2)+'" r="15" fill="'+C.blue+'"/>'+
    label(String(i+1),737,y+h/2+6,{size:16,color:C.white})+
    label(v,480,y+h/2+5,{limit:40,size:20,rows:2});
  }).join("");
  return base(title,nodes);
 }
 if(type==="timeline") {
  const step=735/(lines.length-1);
  const nodes=lines.map((v,i)=>{
   const x=110+i*step;
   const above=i%2===0;
   return '<circle cx="'+x+'" cy="285" r="13" fill="'+C.gold+'" stroke="'+C.white+'" stroke-width="4"/>'+
    '<line x1="'+x+'" y1="'+(above?200:299)+'" x2="'+x+'" y2="'+(above?270:350)+'" stroke="'+C.edge+'" stroke-width="2"/>'+
    label(v,x,above?173:385,{limit:Math.max(12,Math.floor(75/lines.length)),size:Math.max(15,23-lines.length),rows:3});
  }).join("");
  return base(title,'<line x1="110" y1="285" x2="845" y2="285" stroke="'+C.blue+'" stroke-width="5"/>'+nodes);
 }
 if(type==="story") {
  // The story never generates people, events or conclusions: only symbolic icons.
  const marks=[
    {re:/(العاب|الألعاب|لعب|game)/i, d:"M7 9h10l3 8-4-2-3-3h-2l-3 3-4 2z M9 11v4 M7 13h4 M16 12h.1 M18 14h.1"},
    {re:/(الوقت|الساعات|ساعة|سا ع|ليل|الساعة)/i, d:"M12 3a9 9 0 1 1-.01 0 M12 6v6l4 3"},
    {re:/(دراس|الجامعة|المدرس|تعلم|التحصيل)/i, d:"M4 5h7a3 3 0 0 1 3 3v12H5a1 1 0 0 0-1 1z M20 5h-7a3 3 0 0 0-3 3v12h9a1 1 0 0 1 1 1z"},
    {re:/(علاقات|الاسرة|العزلة|صديق|مجتمع)/i, d:"M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M18 9a3 3 0 1 0 0-6 M18 15a6 6 0 0 1 4 6"},
    {re:/(تغير|تغيير|قرر|الفكرة|فهم|اكتشف)/i, d:"M9 18h6 M10 21h4 M12 2a7 7 0 0 0-4 12c1 1 2 2 2 3h4c0-1 1-2 2-3a7 7 0 0 0-4-12z"}
  ];
  const step=860/lines.length;
  const nodes=lines.map((v,i)=>{
   const x=50+i*step,w=step-12;
   const selected=marks.find((m)=>m.re.test(v));
   const icon=selected?.d || "M4 5h16v14H4z M7 9h10 M7 13h10";
   const cx=x+w/2;
   return '<rect x="'+x+'" y="147" width="'+w+'" height="299" rx="22" fill="'+C.white+'" stroke="'+C.edge+'"/>'+
    '<circle cx="'+cx+'" cy="209" r="36" fill="'+C.bg+'" stroke="'+C.edge+'"/>'+
    '<path d="'+icon+'" transform="translate('+(cx-14)+' 195) scale(1.16)" fill="none" stroke="'+C.blue+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'+
    label("المشهد "+String(i+1),cx,276,{limit:18,size:17,color:C.gold,rows:1})+
    label(v,cx,323,{limit:lines.length>3?15:24,size:19,rows:4});
  }).join("");
  return base(title,nodes);
 }
 if(type==="bars") {
  // Bars are scaled to the largest spoken value; every number is exactly what the lecturer said.
  const rows=lines.map((l)=>l.split("|").map((x)=>x.trim()));
  const values=rows.map(([,v])=>Number(v.slice(0,-1).replace(",",".")));
  const top=Math.max(...values,1);
  const rowH=Math.min(62,360/rows.length);
  const nodes=rows.map(([name,value],i)=>{
   const y=125+i*(rowH+10),w=Math.max(4,(values[i]/top)*430);
   return label(name,170,y+rowH/2+6,{size:20,limit:16,rows:2})+
    '<rect x="250" y="'+y+'" width="430" height="'+rowH+'" rx="10" fill="'+C.white+'" stroke="'+C.edge+'"/>'+
    '<rect x="250" y="'+y+'" width="'+w+'" height="'+rowH+'" rx="10" fill="'+(i%2?C.gold:C.blue)+'"/>'+
    label(value,740,y+rowH/2+8,{size:26,color:C.ink,limit:8,rows:1});
  }).join("");
  return base(title,nodes);
 }
 if(type==="cycle") {
  const n=lines.length,cx=480,cy=315,r=150;
  const pts=lines.map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];});
  const arcs=pts.map(([x,y],i)=>{const [nx,ny]=pts[(i+1)%n];
   return '<line x1="'+x.toFixed(1)+'" y1="'+y.toFixed(1)+'" x2="'+nx.toFixed(1)+'" y2="'+ny.toFixed(1)+'" stroke="'+C.blue+'" stroke-width="3" marker-end="url(#a)"/>';}).join("");
  const nodes=lines.map((v,i)=>{const [x,y]=pts[i];
   return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="26" fill="'+C.blue+'"/>'+label(String(i+1),x,y+7,{size:20,color:C.white,limit:3,rows:1})+
    label(v,x,y+(y<cy?-44:50),{size:18,limit:18,rows:2});}).join("");
  const defs='<defs><marker id="a" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="'+C.blue+'"/></marker></defs>';
  return base(title,defs+arcs+nodes);
 }
 if(type==="activity") {
  const dur=lines[1]||"";
  const nodes='<rect x="130" y="130" width="700" height="300" rx="26" fill="'+C.white+'" stroke="'+C.edge+'"/>'+
   '<circle cx="480" cy="190" r="34" fill="'+C.bg+'" stroke="'+C.edge+'"/>'+
   '<path d="M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" transform="translate('+(480-14)+' '+(190-14)+') scale(1.16)" fill="none" stroke="'+C.gold+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'+
   label(lines[0],480,285,{size:28,limit:34,rows:4})+
   (dur?label(dur,480,400,{size:24,color:C.gold,limit:30,rows:1}):"");
  return base(title,nodes);
 }
 throw new Error("نوع المشهد غير مدعوم");
}
