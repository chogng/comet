import { EventEmitter, type Event } from 'cs/base/common/event';
import {
  Disposable,
  type IDisposable,
  toDisposable,
} from 'cs/base/common/lifecycle';

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}

const shortcutEvent: Event<void> = (listener) => {
  listener();
  return toDisposable(() => {});
};

export const CancellationTokenNone: CancellationToken = Object.freeze({
  isCancellationRequested: false,
  onCancellationRequested: () => toDisposable(() => {}),
});

export const CancellationTokenCancelled: CancellationToken = Object.freeze({
  isCancellationRequested: true,
  onCancellationRequested: shortcutEvent,
});

class MutableToken implements CancellationToken, IDisposable {
  private readonly emitter = new EventEmitter<void>();
  private cancelled = false;

  get isCancellationRequested(): boolean {
    return this.cancelled;
  }

  get onCancellationRequested(): Event<void> {
    return this.cancelled ? shortcutEvent : this.emitter.event;
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }

    this.cancelled = true;
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export class CancellationTokenSource extends Disposable {
  private tokenValue: MutableToken | undefined;

  get token(): CancellationToken {
    if (!this.tokenValue) {
      this.tokenValue = this._register(new MutableToken());
    }

    return this.tokenValue;
  }

  cancel(): void {
    if (!this.tokenValue) {
      this.tokenValue = this._register(new MutableToken());
    }

    this.tokenValue.cancel();
  }
}

export { CancellationError, isCancellationError } from 'cs/base/common/errors';
