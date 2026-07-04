export class LibraryDelegate {
  static readonly INDENT = 16;

  getNodePaddingLeft(depth: number) {
    return `${depth * LibraryDelegate.INDENT}px`;
  }
}
