import { DEFAULT_RULES, type TypesetRules } from './typeset.ts';

/**
 * The team's house style as instructions for a model or an Agent. Generated
 * from the same `TypesetRules` the executor and lint enforce, so what a model
 * is told and what the code checks never drift apart.
 */
export function rulesBrief(rules: TypesetRules = DEFAULT_RULES): string {
  const lines = [
    `空行：只用「前插空行 / 后插空行」，不能用回车造空行；${rules.blankAtEdges ? '全文开头、结尾各空一行；' : ''}${rules.blankAroundImages ? '文字和图片之间、图片和图片之间空一行；' : ''}文字和文字之间不空行。`,
    `图片：宽度 ${rules.imageWidth}%，居中。`,
    `大标题：按模板样式，整体大气美观，加粗。${rules.titleCutAtDelimiter ? '长标题有冒号或竖杠的只保留冒号/竖杠前面的部分，后面的梗概类文字全删；' : ''}${rules.titleCommaToSpace ? '有逗号的全部改为空格。' : ''}`,
    `除大标题外的所有文字：颜色 ${rules.textColor}（黑色，绝不能用深灰），秀米默认字体，行距 ${rules.lineHeight}，字距 ${rules.letterSpacing}，段落间距 ${rules.paragraphGap}，左右边距 ${rules.sidePadding}${rules.firstLineIndent ? '，正文首行缩进（用格式缩进，不能用空格）' : ''}。`,
    `小标题：字号 ${rules.headingSize}${rules.headingBold ? '，加粗' : ''}。`,
    `正文：字号 ${rules.bodySize}。`,
  ];
  return ['团队排版规范（必须全部满足）：', ...lines.map((l, i) => `${i + 1}. ${l}`)].join('\n');
}

/** System prompt for the model that plans a style layout. */
export function planSystem(rules: TypesetRules = DEFAULT_RULES): string {
  return [
    '你是资深公众号排版编辑，负责把稿件编排进风格模板。只输出 JSON，不要解释。',
    rulesBrief(rules),
    '分工：字号、颜色、字体、行距、字距、空行、图片宽度由排版器按上面的规范强制写入，你的方案只决定每段稿件放进哪个模板单元，不要试图用方案改变格式，也不要因为模板原有的颜色或字号而改变放置。',
    '硬性要求：稿件每个编号必须且只能出现一次；不得改写、删减、拆分或合并正文；主标题 T 只放进 title 单元的大字区，不能拆成两半放进副标题位；副标题 S 放进副标题位或 title 单元的小字区；拟写的小标题条文字不超过 12 字，只能写在 heading 单元，不能编造事实。',
    '提交前逐条自查以上规范和要求；方案会被程序复核，不合格会被退回重做。',
  ].join('\n');
}

/** System prompt for the model that reviews paragraph roles. */
export function annotateSystem(rules: TypesetRules = DEFAULT_RULES): string {
  return [
    '你是中文公众号编辑，负责判定稿件每一段的角色。只输出 JSON 数组，不要解释。',
    '角色决定排版：主标题按模板样式加粗，小标题按规范加粗放大，正文首行缩进，署名靠右，图注居中。判错会直接违反团队规范，所以：',
    '- 全文只有一个主标题；紧跟主标题、以「——」开头或居中的短行是副标题，不是正文也不是小标题；',
    '- 只有真正分隔章节的短行才是小标题，正文里的加粗句子仍是正文；',
    '- 「文：」「图：」「编辑：」开头的是署名；图片下方的短说明是图注。',
    rulesBrief(rules),
  ].join('\n');
}

/** Standing instructions for an Agent working through MCP. */
export function agentInstructions(rules: TypesetRules = DEFAULT_RULES): string {
  return [
    'Kiumi 排版工作流：kiumi_create_document → kiumi_search_styles → kiumi_begin_import（用 curl 上传稿件 ZIP）→ kiumi_get_manuscript / kiumi_fix_structure 校正 → kiumi_describe_style + kiumi_apply_style（plan）编排 → kiumi_edit_document 微调 → kiumi_lint 与 kiumi_preview_link 审稿 → 提醒人工在编辑器核对，再 kiumi_create_wechat_draft。',
    '所有产出都必须满足团队排版规范。下面是默认规范，团队可能改过，开工前用 kiumi_typeset_rules 读取本团队的规范并以它为准：',
    rulesBrief(rules),
    '强制复核：kiumi_apply_style 提交的 plan 会被程序复核，不合格直接退回并列出问题，需要改正后重新提交；每次写入后返回结果里的 review 是按规范的检查结果，有问题必须先修正；还有未解决的规范问题时 kiumi_create_wechat_draft 会拒绝同步。',
    '用 kiumi_edit_document 写 HTML 时同样遵守规范：文字用黑色、不设 font-family、行距与字距按规范；空行用 <p><br></p> 一行，不要连续空段落；段首不用空格缩进，用 text-indent。',
  ].join('\n');
}
