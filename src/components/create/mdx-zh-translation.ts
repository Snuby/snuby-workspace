/** MDXEditor 中文文案（仅覆盖本项目用到的工具栏 / 链接 / 表格） */

const ZH: Record<string, string> = {
  // 工具栏
  "toolbar.undo": "撤销 {{shortcut}}",
  "toolbar.redo": "重做 {{shortcut}}",
  "toolbar.bold": "加粗",
  "toolbar.removeBold": "取消加粗",
  "toolbar.italic": "斜体",
  "toolbar.removeItalic": "取消斜体",
  "toolbar.underline": "下划线",
  "toolbar.removeUnderline": "取消下划线",
  "toolbar.inlineCode": "行内代码",
  "toolbar.removeInlineCode": "取消行内代码",
  "toolbar.strikethrough": "删除线",
  "toolbar.removeStrikethrough": "取消删除线",
  "toolbar.subscript": "下标",
  "toolbar.removeSubscript": "取消下标",
  "toolbar.superscript": "上标",
  "toolbar.removeSuperscript": "取消上标",
  "toolbar.highlight": "高亮",
  "toolbar.removeHighlight": "取消高亮",
  "toolbar.bulletedList": "无序列表",
  "toolbar.numberedList": "有序列表",
  "toolbar.checkList": "任务列表",
  "toolbar.link": "插入链接",
  "toolbar.table": "插入表格",
  "toolbar.thematicBreak": "插入分隔线",
  "toolbar.image": "插入图片",
  "toolbar.codeBlock": "插入代码块",
  "toolbar.admonition": "插入提示块",
  "toolbar.insertFrontmatter": "插入 Frontmatter",
  "toolbar.editFrontmatter": "编辑 Frontmatter",
  "toolbar.richText": "富文本",
  "toolbar.source": "源码模式",
  "toolbar.diffMode": "对比模式",
  "toolbar.toggleGroup": "工具组",
  "toolbar.blockTypeSelect.placeholder": "段落样式",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "选择段落样式",
  "toolbar.blockTypes.paragraph": "正文",
  "toolbar.blockTypes.quote": "引用",
  "toolbar.blockTypes.heading": "标题 {{level}}",

  // 链接
  "createLink.url": "链接地址",
  "createLink.urlPlaceholder": "粘贴或输入 URL",
  "createLink.text": "显示文字",
  "createLink.textTooltip": "链接显示的文字",
  "createLink.title": "标题属性",
  "createLink.titleTooltip": "鼠标悬停时显示的 title",
  "createLink.saveTooltip": "保存链接",
  "createLink.cancelTooltip": "取消",
  "linkPreview.edit": "编辑链接",
  "linkPreview.remove": "移除链接",
  "linkPreview.copyToClipboard": "复制链接",
  "linkPreview.copied": "已复制",

  // 对话框通用
  "dialog.close": "关闭",
  "dialogControls.save": "保存",
  "dialogControls.cancel": "取消",

  // 表格
  "table.columnMenu": "列操作",
  "table.rowMenu": "行操作",
  "table.deleteColumn": "删除此列",
  "table.deleteRow": "删除此行",
  "table.deleteTable": "删除表格",
  "table.insertColumnLeft": "在左侧插入列",
  "table.insertColumnRight": "在右侧插入列",
  "table.insertRowAbove": "在上方插入行",
  "table.insertRowBelow": "在下方插入行",
  "table.textAlignment": "对齐方式",
  "table.alignLeft": "左对齐",
  "table.alignCenter": "居中",
  "table.alignRight": "右对齐",

  // 代码块
  "codeBlock.language": "代码语言",
  "codeBlock.selectLanguage": "选择代码语言",
  "codeBlock.inlineLanguage": "语言",
  "codeblock.delete": "删除代码块",
};

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] === undefined || vars[key] === null ? "" : String(vars[key]),
  );
}

export function mdxZhTranslation(
  key: string,
  defaultValue: string,
  interpolations?: Record<string, unknown>,
): string {
  return interpolate(ZH[key] ?? defaultValue, interpolations);
}
