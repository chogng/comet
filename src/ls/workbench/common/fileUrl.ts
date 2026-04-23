function encodeFilePathSegment(segment: string, index: number) {
  if (index === 1 && /^[a-zA-Z]:$/.test(segment)) {
    return segment;
  }

  return encodeURIComponent(segment);
}

export function toFileUrl(filePath: string) {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }

  const absolutePath =
    normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encodedPath = absolutePath.split('/').map(encodeFilePathSegment).join('/');

  return `file://${encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`}`;
}
