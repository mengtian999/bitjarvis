/**
 * 模型显示名的语言解析。
 *
 * 网关 /v1/models 同时下发中英文档位名，桌面端把它们存进 Provider Catalog
 * （name / name_en），/api/models 再以 { name, nameEn } 返回。同步时若只写死
 * 一种语言，切换 UI 语言后模型名不会变——这里在展示时按当前 locale 解析。
 *
 * 规则：中文（zh*）用 name；其余语言用 nameEn，缺失时回退 name。
 * locale 尚未加载（空串）时保持历史行为（中文），避免首帧闪成英文。
 */
export function isChineseLocale(locale?: string | null): boolean {
  if (!locale) return false;
  return locale.trim().toLowerCase().startsWith('zh');
}

export function localizedModelName(
  model: { name?: string | null; nameEn?: string | null; id?: string | null } | null | undefined,
  locale?: string | null,
): string {
  if (!model) return '';
  const zh = typeof model.name === 'string' && model.name.trim()
    ? model.name
    : (model.id || '');
  const en = typeof model.nameEn === 'string' && model.nameEn.trim() ? model.nameEn : zh;
  if (!locale) return zh || en;
  return isChineseLocale(locale) ? zh : en;
}