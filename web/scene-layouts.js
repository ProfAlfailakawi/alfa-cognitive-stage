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
  const step=860/lines.length;
  const nodes=lines.map((v,i)=>{
   const x=50+i*step,w=step-12;
   return '<rect x="'+x+'" y="147" width="'+w+'" height="299" rx="22" fill="'+C.white+'" stroke="'+C.edge+'"/>'+
    '<circle cx="'+(x+w/2)+'" cy="205" r="30" fill="'+(i%2?C.gold:C.blue)+'"/>'+
    label(String(i+1),x+w/2,214,{size:24,color:C.white})+
    label(v,x+w/2,270,{limit:lines.length>3?15:24,size:19,rows:4});
  }).join("");
  return base(title,nodes);
 }
 throw new Error("نوع المشهد غير مدعوم");
}
