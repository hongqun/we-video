export const videoDownloadFilename = (title: string, fallback = "tech123-video") => {
  const safeTitle = title
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 80);
  return `${safeTitle || fallback}.mp4`;
};

// 普通 filename 字段只放 ASCII，避免中文标题导致响应头无效；现代浏览器从 filename* 读取完整标题。
export const videoDownloadAsciiFallback = (title: string, fallback = "tech123-video") => {
  const filename = videoDownloadFilename(title, fallback);
  return /^[\x20-\x7E]+$/u.test(filename) ? filename : videoDownloadFilename("", fallback);
};
