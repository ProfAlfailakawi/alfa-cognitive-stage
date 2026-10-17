// Browser-only video codec/playback preflight. Quiet (muted), never sends video/audio to AI.
// A file that exists is not marked successful until its first decoded frame is available.
export function lectureMediaList(slides, bundle) {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(String(bundle))) return [];
  const items = [];
  for (const slide of Array.isArray(slides) ? slides : []) {
    for (let clipIndex = 0; clipIndex < (slide.videos || []).length; clipIndex++) {
      const clip = slide.videos[clipIndex];
      if (!clip?.src && !clip?.webm) continue;
      const paths = [];
      for (const [type,path] of [["video/mp4",clip.src],["video/webm",clip.webm]]) {
        if (typeof path !== "string" || !/^media\/[a-zA-Z0-9_.-]+$/.test(path)) continue;
        paths.push({type,src:"/bundles/"+bundle+"/"+path});
      }
      if (paths.length) items.push({slide:slide.index,clipIndex,sources:paths});
    }
  }
  return items;
}

export function probeMedia({sources}, {createVideo, mount, timeoutMs=7000, signal}={}) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({status:"cancelled"});
    let video;
    try {
      video = createVideo ? createVideo() : document.createElement("video");
    } catch { return resolve({status:"failed",message:"لا يمكن إنشاء مشغل الفيديو"}); }
    let completed=false;
    let timer;
    const clean=()=>{
      clearTimeout(timer);
      signal?.removeEventListener("abort",onAbort);
      video.removeEventListener("loadeddata",onLoaded);
      video.removeEventListener("error",onError);
      try { video.pause(); } catch {}
      try { video.remove(); } catch {}
    };
    const finish=(status,message="")=>{
      if(completed) return;
      completed=true;
      const source=video.currentSrc||"";
      const readyState=video.readyState||0;
      clean();
      resolve({status,message,source,readyState});
    };
    const onAbort=()=>finish("cancelled");
    const onLoaded=()=>{
      if(video.videoWidth>0 && video.readyState>=2) finish("ready");
    };
    const onError=()=>finish("failed","المتصفح لم يستطع فك ترميز الفيديو");
    const timeout=Math.max(750,Math.min(20000,Number(timeoutMs)||7000));
    timer=setTimeout(()=>finish("timeout","لم يُحمّل الفيديو خلال "+Math.ceil(timeout/1000)+" ثوانٍ"),timeout);
    video.addEventListener("loadeddata",onLoaded);
    video.addEventListener("error",onError);
    signal?.addEventListener("abort",onAbort,{once:true});
    video.muted=true;
    video.playsInline=true;
    video.preload="auto";
    video.style.cssText="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0";
    for (const source of sources||[]) {
      if (!["video/mp4","video/webm"].includes(source.type) ||
          typeof source.src !== "string" || !source.src.startsWith("/bundles/")) continue;
      const child=(video.ownerDocument||document).createElement("source");
      child.type=source.type; child.src=source.src;
      video.appendChild(child);
    }
    if(!video.querySelector("source")) return finish("failed","لا يوجد مصدر فيديو قابل للفحص");
    try {
      (mount||document.body).appendChild(video);
      video.load();
      Promise.resolve(video.play()).catch((error)=>{
        if(error?.name==="NotAllowedError") finish("blocked","المتصفح منع التشغيل الآلي؛ اختبر الفيديو يدوياً");
        else finish("failed","تعذر تشغيل الفيديو: "+String(error?.name||"unknown"));
      });
    } catch (error) { finish("failed",String(error?.message||"تعذر فتح الفيديو")); }
  });
}

export async function testLectureMedia(slides,bundle,{onProgress,signal,timeoutMs,maxClips=100,...videoOptions}={}) {
  const all=lectureMediaList(slides,bundle);
  const selected=all.slice(0,Math.max(1,Math.min(100,maxClips)));
  const results=[];
  for(const entry of selected) {
    if(signal?.aborted) break;
    const result=await probeMedia(entry,{timeoutMs,signal,...videoOptions});
    const row={slide:entry.slide,clipIndex:entry.clipIndex+1,...result};
    results.push(row);
    onProgress?.(row,results.length,all.length);
    if(result.status==="cancelled") break;
  }
  return {total:all.length,tested:results.length,results,
    passed:results.filter(x=>x.status==="ready").length,
    failed:results.filter(x=>x.status==="failed"||x.status==="timeout"||x.status==="blocked").length,
    cancelled:Boolean(signal?.aborted)};
}
