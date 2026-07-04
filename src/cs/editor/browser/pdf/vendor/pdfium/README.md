# PDFium Runtime Vendor

This directory contains the local PDFium WebAssembly runtime used by the
Comet Studio PDF reader.

The workbench PDF viewer imports this local runtime instead of depending on an
external PDFium npm package directly. The viewer, page lifecycle, status
reporting, selection, and annotation surfaces remain owned by this codebase.

Licenses:
- `LICENSE` covers the JavaScript wrapper.
- `LICENSE.pdfium` covers the bundled PDFium WebAssembly artifact.
