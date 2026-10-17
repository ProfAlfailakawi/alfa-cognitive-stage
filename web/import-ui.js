// Presenter-only PowerPoint importer: zero prompts, file never served from the student web root.
export function mountImportPanel(mount, { empty = false } = {}) {
  if (!mount) return;
  const root = document.createElement(empty ? "section" : "details");
  root.className = "import-panel";
  const heading = document.createElement(empty ? "h2" : "summary");
  heading.textContent = empty ? "ابدأ برفع محاضرتك (PowerPoint أو PDF أو Keynote)" : "رفع محاضرة جديدة (PPTX / PDF / Keynote)";
  root.append(heading);
  const form = document.createElement("form");
  form.className = "import-fields";
  const secret = document.createElement("input");
  secret.type = "password";
  secret.placeholder = "رمز المحاضر الظاهر في Terminal";
  secret.autocomplete = "off";
  secret.setAttribute("aria-label", "رمز المحاضر");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".pptx,.pdf,.key,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";
  file.setAttribute("aria-label", "ملف PowerPoint أو PDF أو Keynote");
  const actions = document.createElement("div");
  actions.className = "import-actions";
  const check = document.createElement("button");
  check.type = "button";
  check.textContent = "فحص أدوات التحويل";
  const run = document.createElement("button");
  run.type = "submit";
  run.textContent = "استيراد وفتح المحاضرة";
  run.className = "primary";
  actions.append(check, run);
  const report = document.createElement("p");
  report.className = "import-report";
  report.setAttribute("role", "status");
  report.textContent = "PowerPoint هو الأفضل (حركات النقر والفيديو). PDF صفحات ثابتة بلا حركة أو فيديو. Keynote: يُفضّل تصديره إلى PowerPoint.";
  form.append(secret, file, actions, report);
  root.append(form);
  mount.append(root);
  const token = () => secret.value.trim() ||
    document.getElementById("director-admin-token")?.value.trim() ||
    sessionStorage.getItem("alfa-admin-token") || "";
  const setStatus = (message) => { report.textContent = message; };
  check.addEventListener("click", async () => {
    if (!token()) { setStatus("أدخل رمز المحاضر أولاً."); return; }
    check.disabled = true;
    try {
      const response = await fetch("/api/lectures/prerequisites", { headers: { "X-Admin-Token": token() } });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "تعذّر التحقق من رمز المحاضر");
      setStatus(result.ready
        ? "أدوات التحويل جاهزة. حركات النقر تُحفظ ترتيباً وحالة؛ شكل الحركة تلاشٍ."
        : "الأدوات الناقصة: " + result.missing.join("، "));
    } catch (error) { setStatus(error.message); }
    finally { check.disabled = false; }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = file.files?.[0];
    if (!selected || !/\.(pptx|pdf|key)$/i.test(selected.name)) { setStatus("اختر ملف PPTX أو PDF أو Keynote."); return; }
    if (selected.size > 80 * 1024 * 1024) { setStatus("الحد الأقصى 80 MB."); return; }
    if (!token()) { setStatus("أدخل رمز المحاضر أولاً."); return; }
    run.disabled = true;
    setStatus("البرنامج يحوّل الشرائح ويفحص الفيديوهات الآن. لا تغلق الصفحة...");
    try {
      const response = await fetch("/api/lectures/import", {
        method: "POST",
        headers: {
          "X-Admin-Token": token(),
          "X-Lecture-Filename": encodeURIComponent(selected.name),
          "Content-Type": "application/octet-stream"
        },
        body: selected,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "فشل تحويل الملف");
      const lecture = data.lecture;
      setStatus("نجح: " + lecture.slides + " شريحة، " + lecture.videoCount +
        " فيديو، " + lecture.warningCount + " تحذيراً. يتم فتح العرض...");
      location.assign("/?bundle=" + encodeURIComponent(lecture.id) + "#presenter");
    } catch (error) { setStatus(error.message); }
    finally { run.disabled = false; }
  });
  return root;
}
