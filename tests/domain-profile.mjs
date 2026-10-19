import assert from "node:assert/strict";
import { domainSceneGuidance, matchDomainTopic, topicPrompt } from "../web/domain-profile.js";
assert.equal(matchDomainTopic("نشرح نموذج ADDIE في التصميم التعليمي")?.id, "instructional-design");
assert.equal(matchDomainTopic("الطالب يستخدم التكنولوجيا المساعدة")?.id, "inclusive-education");
assert.equal(domainSceneGuidance("الواقع الافتراضي والواقع المعزز", "compare").preferred, true);
assert.equal(domainSceneGuidance("التعلم الإلكتروني", "story").preferred, false);
assert.match(topicPrompt("تكنولوجيا التعليم في الفصل"), /تكنولوجيا التعليم/);
assert.equal(matchDomainTopic("نتكلم عن موضوع خارج التخصص"), null);
console.log("domain profile: specialty topics, visual guidance and conservative matching passed");
