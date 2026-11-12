# ALFA Cognitive Stage — الاستوديو المعرفي للمحاضرات

[![Core regression checks](https://github.com/ProfAlfailakawi/alfa-cognitive-stage/actions/workflows/core-checks.yml/badge.svg)](https://github.com/ProfAlfailakawi/alfa-cognitive-stage/actions/workflows/core-checks.yml)

استوديو تعليمي تفاعلي مستقل يعمل محلياً على جهاز المحاضر (خادم Node واحد + المتصفح، أو تطبيق ALFA للماك). يستورد ملفات PowerPoint وPDF ويعرضها بوضعين: لوحة المحاضر وشاشة الطلبة على البروجكتر، مع تنقل صوتي بين الشرائح، وتصويت ونبض فهم من هواتف الطلبة عبر الشبكة المحلية، ومخرج صوتي تجريبي يقترح رسومات SVG خفيفة، وذاكرة محلية للمشاهد المعتمدة. لا يستدعي أي خدمة مدفوعة ولا نموذجاً سحابياً.

**الروابط:** لا يوجد موقع إنتاج منشور؛ المشروع يعمل على جهازك:

| الصفحة | الرابط المحلي |
|---|---|
| لوحة المحاضر | `http://localhost:4173/#presenter` |
| شاشة الطلبة (البروجكتر) | `http://localhost:4173/#audience` |
| نافذة الملاحظات | `http://localhost:4173/#notes` |
| تصويت الطلبة (من الهاتف عبر QR) | `http://<IP-الجهاز>:4173/vote.html` |
| مراجعة الطلبة | `http://<IP-الجهاز>:4173/review.html` |
| لوحة إدارة التصويت | `http://localhost:4173/vote-admin.html` |

## البدء على macOS

**للاستخدام اليومي:** افتح `Start ALFA.command` بالنقر المزدوج، ثم افتح صفحة المحاضر على `http://localhost:4173/#presenter`. يجهز التشغيل مكتبات Python المطلوبة تلقائياً أول مرة في `.venv` ويصلحها عند الحاجة؛ لا تثبّتها يدوياً. اترك نافذة Terminal مفتوحة.

للتجهيز الأول وتفاصيل التثبيت راجع [دليل Mac العربي](docs/MAC_SETUP_AR.md). المتطلبات: Node.js 22 أو أحدث، Python 3، LibreOffice، Poppler، FFmpeg، python-pptx، lxml، Pillow.

الطريقة اليدوية إن احتجتها:

```bash
npm start
```

في التشغيل اليومي على Mac يحاول الاستيراد استخدام PowerPoint للحفاظ على الشكل الأصلي. إذا كان الجهاز يعمل في وضع اختبارات أو دون جلسة Office تفاعلية، عطّل هذا المسار بالمتغير `ALFA_NATIVE_POWERPOINT=0` ليستخدم LibreOffice مباشرة (انظر [tools/build_bundle.py](tools/build_bundle.py)).

سيطبع Terminal **رمز المحاضر**. لا تشاركه مع الطلبة. إذا لم توجد حزمة محاضرة، سترى شاشة رفع الملف مباشرة.

## خريطة الميزات / Feature map

«يعمل» = منفّذ ومغطى باختبارات في CI. «تجريبي» = منفّذ لكن بحدود معلنة أو لم يُجرَّب بعد في قاعة حقيقية.

| الميزة | ما تفعله | الرابط المباشر | الشيفرة | الحالة |
|---|---|---|---|---|
| استيراد PPTX وPDF | تحويل الملف إلى حزمة صور شرائح وملاحظات ووسائط عبر PowerPoint (Mac) أو LibreOffice/Poppler/FFmpeg؛ Keynote بأفضل جهد — [التفاصيل](docs/IMPORT_FORMATS_AR.md) | `#presenter` (درج الاستيراد) | [server/lecture-import.mjs](server/lecture-import.mjs)، [tools/build_bundle.py](tools/build_bundle.py)، [web/import-ui.js](web/import-ui.js) | يعمل (Keynote: تجريبي) |
| حركات النقرات (Build steps) | عرض ظهور العناصر والفقرات خطوة بخطوة بترتيب PowerPoint؛ ما لا يُدعم يُعلن في لوحة الجاهزية — [التفاصيل](docs/PPTX_BUILD_STEPS_AR.md) | `#presenter` | [tools/animations.py](tools/animations.py)، [web/build-steps.js](web/build-steps.js) | يعمل (حركات التأكيد والمسارات وSmartArt غير مدعومة) |
| لوحة المحاضر (Presenter View) | الشريحة الحالية والتالية، شريط الشرائح (Filmstrip) للقفز مع إمكانية التراجع، ساعة حائط، حجم الملاحظات، «ابدأ العرض» و«إنهاء العرض» | `#presenter` | [web/app.js](web/app.js)، [web/style.css](web/style.css) | يعمل |
| شاشة الطلبة ونافذة الملاحظات | عرض الطلبة بلا ملاحظات، وشاشة سوداء (`B` أو `.`)، وملء الشاشة (`F`) | `#audience`، `#notes` | [web/app.js](web/app.js) | يعمل |
| محرك العرض (Presentation Engine) | مصدر واحد لحالة شاشة الطلبة عبر HTTP/SSE محلي بلقطات مرقّمة، لا تمر الملاحظات عبره؛ يتيح لنوافذ في تطبيقات أخرى اللحاق بالعرض (`?relay=1`) | `/api/show/*` | [server/presentation-engine.mjs](server/presentation-engine.mjs)، [server/show-routes.mjs](server/show-routes.mjs)، [web/show-client.js](web/show-client.js)، [web/show-gate.js](web/show-gate.js) | يعمل |
| تطبيق ALFA للماك (Electron) | نافذة بروجكتر أصلية على الشاشة الخارجية، اكتشاف توصيل/فصل الشاشة، نافذة ملاحظات — [التفاصيل](docs/MAC_APP_AR.md) | `npm run desktop` | [desktop/main.cjs](desktop/main.cjs)، [desktop/display-manager.cjs](desktop/display-manager.cjs)، [desktop/build-mac.mjs](desktop/build-mac.mjs) | تجريبي (مختبر على شاشة افتراضية في CI، غير موقّع، لم يُختبر على بروجكتر حقيقي) |
| العودة بعد الاستطراد | `E` تعيد الشريحة ونقرة الحركة والفيديو كما كانت | `#presenter` | [web/return-stack.js](web/return-stack.js) | يعمل |
| التنقل بالصوت | جمل طبيعية مثل «خلونا نروح للشريحة اللي بعدها» و«نرجع للشريحة الأصلية»؛ زرّان بديلان دائماً عند فشل المايك، ولا يتحرك عند مجرد الحديث عن شريحة — [التفاصيل](docs/VOICE_PATH_AR.md) | `#presenter` (Chrome/Safari) | [web/voice-nav.js](web/voice-nav.js)، [web/voice-intent.js](web/voice-intent.js)، [web/speech-director.js](web/speech-director.js) | يعمل (يعتمد على التعرف الصوتي في المتصفح) |
| المخرج الخفي | يلتقط من الكلام إحصائية/قصة/مقارنة/سؤال/خلاصة ويقترح مشهداً؛ الموافقة أولاً افتراضياً — [التفاصيل](docs/STUDIO_UPGRADE_AR.md) | `#presenter` | [web/director-brain.js](web/director-brain.js)، [web/director-core.js](web/director-core.js)، [web/cognitive-context-director.js](web/cognitive-context-director.js) | تجريبي |
| ملف التخصص وبصمة المحاضر | قواعد تكنولوجيا التعليم لتوجيه نوع المشهد، والتقاط المقارنات المنطوقة اقتراحاً فقط — [ملف التخصص](docs/DOMAIN_PROFILE_AR.md)، [بصمة الأسلوب](docs/LECTURER_PROFILE_AR.md) | — | [web/domain-profile.js](web/domain-profile.js)، [web/lecturer-profile.js](web/lecturer-profile.js) | تجريبي (مرحلة أولية) |
| الرسومات (المشاهد) | أنواع SVG بسيطة دون توليد صور: stat، compare، steps، concept، flow، timeline، story، bars، cycle، activity، ومشاهد «مثال» و«السبب والنتيجة» — [التفاصيل](docs/SCENES_AR.md) | `#presenter` / `#audience` | [web/infographic.js](web/infographic.js)، [web/scene-layouts.js](web/scene-layouts.js)، [web/scene-kit.js](web/scene-kit.js) | يعمل |
| ALFA Living Intelligence / Premiere | شبكة معرفة محدودة وحتمية من الشريحة والملاحظات والكلام، وتقسيم النصوص العربية الطويلة دون حذف؛ لا تُنشر مقترحاتها إلا بموافقة — [التفاصيل](docs/PREMIERE_AR.md)، [LIVING_INTELLIGENCE_AR](docs/LIVING_INTELLIGENCE_AR.md) | `#presenter` | [web/living-intelligence.js](web/living-intelligence.js)، [web/living-intelligence-ui.js](web/living-intelligence-ui.js)، [web/cognitive-readability.js](web/cognitive-readability.js) | تجريبي |
| ذاكرة المشاهد | حفظ المشاهد المعتمدة في المتصفح وعلى الخادم (برمز الإدارة) وإعادتها عند المطابقة — [التفاصيل](docs/SEMANTIC_MEMORY_AR.md) | `/api/memory/*` | [web/scene-memory.js](web/scene-memory.js)، [server/scene-store.mjs](server/scene-store.mjs) | يعمل |
| التصويت | لوحة داخل الاستوديو، QR للطلبة عبر LAN، نتائج مباشرة، جولات وإعادة، سحابة كلمات، مقارنة الجولات وتصدير CSV | `vote.html`، `vote-admin.html` | [server/votes.mjs](server/votes.mjs)، [web/vote.js](web/vote.js)، [web/vote-admin.js](web/vote-admin.js)، [web/poll-analytics.js](web/poll-analytics.js) | يعمل |
| أسئلة الطلبة و«الأهم الآن» | أسئلة مفتوحة مع إشراف، وأعلى ثلاث مجموعات أسئلة، وفصل الأسئلة الإدارية — [التفاعل](docs/ENGAGEMENT_AR.md)، [الفرز](docs/QUESTION_TRIAGE_AR.md) | `vote.html` | [web/moderation.js](web/moderation.js)، [web/question-triage.js](web/question-triage.js)، [web/engagement-insights.js](web/engagement-insights.js) | يعمل |
| نبض الفهم والمراجعة | زرّا «فاهم/ضايع» المجهولان، تنبيه خاص عند مخالفة رقم منطوق لما في الشريحة، مقترح واحد للمحاضرة القادمة، مراجعة تُنشر للطلبة — [التفاصيل](docs/INSIGHT_AR.md) | `vote.html`، `review.html` | [web/insight-ui.js](web/insight-ui.js)، [web/number-witness.js](web/number-witness.js)، [web/lecture-coach.js](web/lecture-coach.js)، [web/review-builder.js](web/review-builder.js)، [web/review.js](web/review.js) | يعمل |
| المكتبة والبروفة وتقرير الجلسة | مقررات وشعب ومحاضرات محفوظة، بروفة موقّتة، بروفة جمهور، بنك أسئلة سابقة — [التفاصيل](docs/LIBRARY_REHEARSAL_REPORTS_AR.md) | `#presenter` | [server/library.mjs](server/library.mjs)، [web/library-ui.js](web/library-ui.js)، [web/rehearsal.js](web/rehearsal.js)، [web/rehearsal-audience.js](web/rehearsal-audience.js)، [server/question-bank.mjs](server/question-bank.mjs) | يعمل |
| التجربة الميدانية ووضع الضيف | تسجيل محاضرة تجريبية بموافقتك وتصنيف قراراتها، استئناف بعد انقطاع، خريطة مقرر، وضع ضيف ببيانات مؤقتة — [التفاصيل](docs/FIELD_TRIAL_AR.md) | `npm run start:guest` ثم `?guest=1` | [web/field-recorder.js](web/field-recorder.js)، [web/field-ui.js](web/field-ui.js)، [web/resume-state.js](web/resume-state.js)، [web/course-map.js](web/course-map.js)، [tools/start-guest.mjs](tools/start-guest.mjs) | تجريبي |
| ضبط المخرج من تصنيفاتك | إعادة تشغيل المحاضرات المسجّلة بإعدادات مختلفة واقتراح حد ثقة وفاصل هدوء (لا يُطبّق إلا بموافقتك) — [التفاصيل](docs/DIRECTOR_TUNING_AR.md) | `#presenter` | [web/director-tuner.js](web/director-tuner.js)، [web/trial-replay.js](web/trial-replay.js) | تجريبي |
| مطابقة دلالية محلية اختيارية | نموذج جمل محلي يُثبَّت بـ`npm run fetch:embedder` ليقترح الانتقال إلى الشريحة المقصودة — [القياس وحدوده](docs/SEMANTIC_MATCHING_AR.md) | `/api/embed/*` | [web/slide-matcher.js](web/slide-matcher.js)، [server/neural-embed.mjs](server/neural-embed.mjs)، [tools/fetch-embedder.mjs](tools/fetch-embedder.mjs) | تجريبي (اختياري) |
| فحص الجاهزية والوسائط | لوحة جاهزية قبل المحاضرة، فحص الفيديو والصيغ، مزامنة الفيديو مع شاشة الطلبة | `#presenter` | [web/lecture-readiness.js](web/lecture-readiness.js)، [web/media-preflight.js](web/media-preflight.js)، [web/video-sync.js](web/video-sync.js) | يعمل |
| الأمان والمشاركة الآمنة | أي طلب بعيد (هاتف/نفق) يرى صفحات الطلبة فقط حتى مع الرمز، رمز محاضر بمقارنة ثابتة الزمن، ترويسات CSP — [المشاركة الآمنة](docs/SECURE_SHARING_AR.md)، [التحصين](docs/HARDENING_AR.md) | — | [server/security.mjs](server/security.mjs)، [server/server.mjs](server/server.mjs) | يعمل |
| حساس أخطاء ORBIT | يرسل ملاحظات أخطاء مجهولة إلى خدمة ORBIT الخارجية؛ **معطّل افتراضياً** ولا يعمل إلا بـ`ALFA_ORBIT=1` | — | [web/orbit-sensor.js](web/orbit-sensor.js) | معطّل افتراضياً |

## البنية

- **الخادم:** Node.js بلا تبعيات npm ([server/server.mjs](server/server.mjs))، يقدّم مجلد [web/](web/) وحزم المحاضرات من `bundles/`، والمنفذ الافتراضي `4173` (`PORT`).
- **الواجهة:** وحدات ES في [web/](web/) بلا خطوة بناء؛ الدور يُحدَّد من `#presenter` / `#audience` / `#notes`.
- **أدوات الاستيراد:** Python في [tools/](tools/) (python-pptx وlxml وPillow) مع LibreOffice وPoppler وFFmpeg.
- **تطبيق الماك:** Electron في [desktop/](desktop/) يشغّل الخادم نفسه ويفتح نوافذه.
- **البيانات المحلية:** `bundles/` و`data/` و`.env` مستثناة من Git ([.gitignore](.gitignore)).

نقاط النهاية الرئيسية (كلها في [server/server.mjs](server/server.mjs) ما لم يُذكر غير ذلك):

| المسار | الوظيفة |
|---|---|
| `POST /api/lectures/import`، `GET /api/lectures/prerequisites` | رفع ملف وتحويله، وفحص أدوات التحويل |
| `/api/sessions/:code/{state,vote,questions,words,pulse,review}` | ما يستطيع هاتف الطالب استعماله (يسمح به [server/security.mjs](server/security.mjs)) |
| `/api/sessions/:code/polls/...` | إدارة التصويت (برمز المحاضر) |
| `/api/memory/*`، `/api/library/*`، `/api/bank/*`، `/api/coach/*`، `/api/coursemap/*` | الذاكرة والمكتبة وبنك الأسئلة والمدرّب وخريطة المقرر |
| `/api/embed/*` | المطابقة الدلالية المحلية |
| `/api/show/{events,status,audience-manifest,publish,ack,resync,control}` | محرك العرض ([server/show-routes.mjs](server/show-routes.mjs)) |
| `GET /api/network`، `GET /api/local-token` | رابط الشبكة لـQR، ورمز المحاضر لصفحة الجهاز نفسه فقط |

## التشغيل والأوامر

| الأمر | ما يفعله |
|---|---|
| `npm start` | تشغيل الخادم على `http://localhost:4173` |
| `npm run start:guest` | وضع ضيف ببيانات مؤقتة ورمز جديد |
| `npm run desktop` | تشغيل تطبيق ALFA (Electron) محلياً |
| `npm run build:mac` | بناء `ALFA.app` غير موقّع في `dist/` (macOS) |
| `npm run fetch:embedder` | تنزيل نموذج المطابقة الدلالية المحلي |
| `npm test` | كل الاختبارات (وحدة + متصفح؛ يحتاج Playwright وأدوات الاستيراد) |
| `npm run test:build` | اختبارات Python للاستيراد والحركات |
| `npm run test:director` / `test:speech` / `test:vote` / `test:e2e` | مجموعات مختارة (القائمة الكاملة في [package.json](package.json)) |
| `npm run test:show` / `test:e2e-show` / `test:desktop` | محرك العرض وتطبيق الماك |

## الاختبارات وبوابات الجودة

- ملفات الاختبار في [tests/](tests/) (Node، و Playwright لاختبارات `e2e-*`) و[tools/](tools/) (`test_*.py`).
- سير العمل [.github/workflows/core-checks.yml](.github/workflows/core-checks.yml) يعمل عند كل push وpull request بأربع وظائف:
  - `unit`: فحص صياغة ملفات JS، ومجموعات اختبارات الوحدة، واختبار حزمة Python.
  - `browser`: اختبارات Playwright للمحاضر والطلبة والتصويت بخمسة هواتف والصوت والاستقرار.
  - `desktop`: تطبيق Electron على شاشة افتراضية (xvfb) — ليس اختباراً لبروجكتر Mac حقيقي.
  - `import-real`: استيراد PowerPoint وPDF حقيقيين عبر LibreOffice.
- على Mac فيه PowerPoint، شغّل `test:build` مع `ALFA_NATIVE_POWERPOINT=0` وإلا قد يفشل `test_animations` لأن المسار الأصلي يُجرَّب أولاً.
- تقارير الجودة: [مصفوفة القبول](docs/ACCEPTANCE_MATRIX_AR.md)، [التدقيق الشامل](docs/SPEC_STATUS_AR.md)، [بطاقة الجودة](docs/QUALITY-SCORECARD.md).

## النشر

لا يوجد نشر سحابي ولا سير عمل للنشر: المشروع يُشغَّل محلياً على جهاز المحاضر (`Start ALFA.command` أو `npm start`)، وتطبيق الماك يُبنى يدوياً بـ`npm run build:mac` (غير موقّع ولا موثّق من Apple). سير العمل الوحيد [core-checks.yml](.github/workflows/core-checks.yml) للفحص فقط، ويعمل تلقائياً عند push وpull request.

لرابط عام لهواتف الطلبة ضع في `.env`: `PUBLIC_URL=http://192.168.1.10:4173`.

## اختصارات العرض

| الاختصار | الوظيفة |
|---|---|
| → / PageDown / مسافة | الشريحة التالية |
| ← / PageUp | الشريحة السابقة |
| Home | أول شريحة |
| E / Esc | إلغاء الاستطراد وإخفاء المشاهد والعودة إلى الشريحة الحالية |
| V | تشغيل/إيقاف الفيديو |
| B / . | شاشة سوداء |
| F أو نقر مزدوج (شاشة الطلبة) | ملء الشاشة |

## لا تكلفة والخصوصية

لا يستدعي المشروع أي خدمة مدفوعة: لا مفتاح API ولا نموذج سحابي (حُذف التحليل السحابي بالكامل — [VOICE_ONLY_AR](docs/VOICE_ONLY_AR.md)). التعرف على الصوت يتم في المتصفح (Chrome أو Safari) وقد يستعين بخدمة المتصفح الخارجية. ملفات الشرائح والملاحظات لا تُشارك مع هواتف الطلبة.

## حدود التجربة الحالية

حركات التأكيد والمسارات وSmartArt غير مدعومة، والمخرج ليس فهماً دلالياً مستمراً لكل المحاضرات. لم تُختبر هذه النسخة بعد على Mac حقيقي مع بروجكتر أو 5 هواتف فعلية أو شبكة الجامعة.

**مهم:** استخدام المشروع في قاعة فعلية يتطلب بروفة على جهاز Mac بنفسه، خصوصاً الحركات والفيديو والصوت والتصويت على هواتف الطلبة.

وثائق أخرى: [ترقية الاستوديو](docs/STUDIO_UPGRADE_AR.md)، [المشاهد](docs/SCENES_AR.md)، [الصوت](docs/VOICE_PATH_AR.md)، [التفاعل](docs/ENGAGEMENT_AR.md)، [الذاكرة](docs/SEMANTIC_MEMORY_AR.md)، [الاستيراد](docs/IMPORT_FORMATS_AR.md)، [تطبيق الماك](docs/MAC_APP_AR.md).

---

آخر تحديث للتوثيق: 2026-11-12
