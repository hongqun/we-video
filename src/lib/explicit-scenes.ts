// 只识别明确编号的场景标题，普通小标题和正文中的“场景”不作为切分依据。
const sceneHeading = /^[ \t]*(?:#{1,6}[ \t]+)?(?:场景[ \t]*(?:第[ \t]*)?[一二三四五六七八九十百零〇两\d]+|第[ \t]*[一二三四五六七八九十百零〇两\d]+[ \t]*场景|scene[ \t]+\d+)(?=[ \t:：、.．—–-]|$)[^\r\n]*$/gim;

export const splitExplicitScenes = (text: string): string[] | null => {
  const headings = [...text.matchAll(sceneHeading)];
  if (!headings.length) return null;
  // 文首说明随首场景保留，末尾总结随末场景保留；不改变任何正文字符。
  const starts = headings.map((heading, index) => index === 0 ? 0 : heading.index!);
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
};
