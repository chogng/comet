interface WindowChainElement {
  readonly window: WeakRef<Window>;
  readonly iframeElement: Element | null;
}

const sameOriginWindowChainCache = new WeakMap<Window, WindowChainElement[] | null>();

function getParentWindowIfSameOrigin(targetWindow: Window): Window | null {
  if (!targetWindow.parent || targetWindow.parent === targetWindow) {
    return null;
  }

  try {
    const location = targetWindow.location;
    const parentLocation = targetWindow.parent.location;
    if (
      location.origin !== 'null' &&
      parentLocation.origin !== 'null' &&
      location.origin !== parentLocation.origin
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return targetWindow.parent;
}

export class IframeUtils {
  private static getSameOriginWindowChain(targetWindow: Window): WindowChainElement[] {
    let windowChainCache = sameOriginWindowChainCache.get(targetWindow);
    if (!windowChainCache) {
      windowChainCache = [];
      sameOriginWindowChainCache.set(targetWindow, windowChainCache);
      let currentWindow: Window | null = targetWindow;
      let parent: Window | null;
      do {
        parent = getParentWindowIfSameOrigin(currentWindow);
        if (parent) {
          windowChainCache.push({
            window: new WeakRef(currentWindow),
            iframeElement: currentWindow.frameElement || null,
          });
        } else {
          windowChainCache.push({
            window: new WeakRef(currentWindow),
            iframeElement: null,
          });
        }
        currentWindow = parent;
      } while (currentWindow);
    }

    return windowChainCache.slice(0);
  }

  static getPositionOfChildWindowRelativeToAncestorWindow(
    childWindow: Window,
    ancestorWindow: Window | null,
  ) {
    if (!ancestorWindow || childWindow === ancestorWindow) {
      return {
        top: 0,
        left: 0,
      };
    }

    let top = 0;
    let left = 0;
    const windowChain = this.getSameOriginWindowChain(childWindow);

    for (const windowChainElement of windowChain) {
      const windowInChain = windowChainElement.window.deref();
      top += windowInChain?.scrollY ?? 0;
      left += windowInChain?.scrollX ?? 0;

      if (windowInChain === ancestorWindow) {
        break;
      }

      if (!windowChainElement.iframeElement) {
        break;
      }

      const boundingRect = windowChainElement.iframeElement.getBoundingClientRect();
      top += boundingRect.top;
      left += boundingRect.left;
    }

    return {
      top,
      left,
    };
  }
}

export async function parentOriginHash(
  parentOrigin: string,
  salt: string,
): Promise<string> {
  if (!crypto.subtle) {
    throw new Error(
      "'crypto.subtle' is not available so webviews will not work. This is likely because the editor is not running in a secure context.",
    );
  }

  const stringData = JSON.stringify({ parentOrigin, salt });
  const encoder = new TextEncoder();
  const arrayData = encoder.encode(stringData);
  const hash = await crypto.subtle.digest('sha-256', arrayData);
  return sha256AsBase32(hash);
}

function sha256AsBase32(bytes: ArrayBuffer): string {
  const array = Array.from(new Uint8Array(bytes));
  const hexArray = array.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return BigInt(`0x${hexArray}`).toString(32).padStart(52, '0');
}
