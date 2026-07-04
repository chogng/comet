export function getEditorContentDisplayUrl(url: string) {
  const normalizedUrl = url.trim();
  if (!normalizedUrl || normalizedUrl === 'about:blank') {
    return '';
  }

  return normalizedUrl;
}

export function getEditorContentTabTitle(url: string) {
  const normalizedUrl = getEditorContentDisplayUrl(url);
  if (!normalizedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const lastPathSegment = pathSegments[pathSegments.length - 1];
    return lastPathSegment
      ? `${parsedUrl.hostname}/${lastPathSegment}`
      : parsedUrl.hostname;
  } catch {
    return normalizedUrl;
  }
}
