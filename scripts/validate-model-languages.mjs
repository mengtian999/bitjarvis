// P3-F5：校验 lib/known-models.json 的 languages 字段取值 ∈ PROMPT_LANGS。
// CI 挂载（npm run typecheck 之外独立跑，见 docs/AGENT_I18N.md §8.3）。
// 三态语义见 known-models.json 的 _comment 与 docs/AGENT_I18N.md §4.3：
//   字段缺失 = 未知 = 乐观支持；数组取值只能是七语种白名单的子集。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(ROOT, "lib", "known-models.json");

// 与 shared/prompt-locale.ts 的 PROMPT_LANGS 保持一致（脚本环境不引 TS，重复白名单并注明）
const PROMPT_LANGS = ["zh", "zh-TW", "ja", "ko", "fr", "de", "en"];
const VALID = new Set(PROMPT_LANGS);

const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const errors = [];
let entries = 0;

for (const [provider, models] of Object.entries(db)) {
  if (provider === "_comment" || !models || typeof models !== "object") continue;
  for (const [modelId, entry] of Object.entries(models)) {
    if (!entry || typeof entry !== "object") continue;
    if (!("languages" in entry)) continue; // 字段缺失 = 未知 = 合法
    entries++;
    const langs = entry.languages;
    if (!Array.isArray(langs)) {
      errors.push(`${provider}/${modelId}: languages 必须是数组，得到 ${typeof langs}`);
      continue;
    }
    if (langs.length === 0) {
      errors.push(`${provider}/${modelId}: languages 空数组等价于未知，请直接删掉该字段`);
      continue;
    }
    for (const lang of langs) {
      if (!VALID.has(lang)) {
        errors.push(`${provider}/${modelId}: 非法取值 "${lang}"（合法集合：${PROMPT_LANGS.join(", ")}）`);
      }
    }
    if (new Set(langs).size !== langs.length) {
      errors.push(`${provider}/${modelId}: languages 含重复项`);
    }
  }
}

if (errors.length > 0) {
  console.error(`[validate-model-languages] FAIL: ${errors.length} 个问题（已标注 ${entries} 个条目）`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`[validate-model-languages] OK: ${entries} 个 languages 条目全部合法`);
