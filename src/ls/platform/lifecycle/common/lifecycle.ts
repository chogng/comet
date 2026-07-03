import { isThenable, Promises } from 'ls/base/common/async';

export function handleVetos(
  vetos: (boolean | Promise<boolean>)[],
  onError: (error: Error) => void,
): Promise<boolean> {
  if (vetos.length === 0) {
    return Promise.resolve(false);
  }

  const promises: Promise<void>[] = [];
  let lazyValue = false;

  for (const valueOrPromise of vetos) {
    if (valueOrPromise === true) {
      return Promise.resolve(true);
    }

    if (isThenable<boolean>(valueOrPromise)) {
      promises.push(
        valueOrPromise.then(
          (value) => {
            if (value) {
              lazyValue = true;
            }
          },
          (error) => {
            onError(error);
            lazyValue = true;
          },
        ),
      );
    }
  }

  return Promises.settled(promises).then(() => lazyValue);
}
