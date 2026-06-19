import assert from 'node:assert/strict';
import test from 'node:test';

import { EventEmitter, type Event } from 'ls/base/common/event';
import { DisposableStore, toDisposable } from 'ls/base/common/lifecycle';
import {
  getDelayedChannel,
  getNextTickChannel,
  ProxyChannel,
  StaticRouter,
  type IChannel,
  type IConnectionHub,
  type IServerChannel,
} from 'ls/platform/ipc/common/ipc';
import { MainProcessService } from 'ls/platform/ipc/common/mainProcessService';
import { createRemoteService } from 'ls/platform/ipc/common/remoteService';

function emptyEvent<T>(): Event<T> {
  return () => toDisposable(() => {});
}

test('ProxyChannel forwards service method calls', async () => {
  const disposables = new DisposableStore();
  const service = {
    add(left: number, right: number) {
      return left + right;
    },
  };
  const channel = ProxyChannel.fromService(service, disposables);
  const proxy = ProxyChannel.toService<typeof service>({
    call: (command, arg) => channel.call('ctx', command, arg),
    listen: (event, arg) => channel.listen('ctx', event, arg),
  });

  assert.equal(await proxy.add(2, 3), 5);

  disposables.dispose();
});

test('ProxyChannel forwards service events and disposes listeners', () => {
  const disposables = new DisposableStore();
  const emitter = new EventEmitter<number>();
  const service = {
    onDidChange: emitter.event,
  };
  const channel = ProxyChannel.fromService(service, disposables);
  const proxy = ProxyChannel.toService<typeof service>({
    call: (command, arg) => channel.call('ctx', command, arg),
    listen: (event, arg) => channel.listen('ctx', event, arg),
  });
  const values: number[] = [];
  const listener = proxy.onDidChange((value) => {
    values.push(value);
  });

  emitter.fire(1);
  listener.dispose();
  emitter.fire(2);

  assert.deepEqual(values, [1]);

  disposables.dispose();
  emitter.dispose();
});

test('ProxyChannel supports dynamic events with arguments', () => {
  const disposables = new DisposableStore();
  const emitter = new EventEmitter<string>();
  const service = {
    onDynamicTopic(topic: string) {
      return (listener: (value: string) => void) =>
        emitter.event((value) => listener(`${topic}:${value}`));
    },
  };
  const channel = ProxyChannel.fromService(service, disposables);
  const proxy = ProxyChannel.toService<typeof service>({
    call: (command, arg) => channel.call('ctx', command, arg),
    listen: (event, arg) => channel.listen('ctx', event, arg),
  });
  const values: string[] = [];
  const listener = proxy.onDynamicTopic('paper')((value) => {
    values.push(value);
  });

  emitter.fire('ready');
  listener.dispose();

  assert.deepEqual(values, ['paper:ready']);

  disposables.dispose();
  emitter.dispose();
});

test('getDelayedChannel waits for the resolved channel', async () => {
  const channelPromise = Promise.resolve<IChannel>({
    async call<TResult = unknown>(command: string, arg?: unknown) {
      return `${command}:${String(arg)}` as TResult;
    },
    listen() {
      return emptyEvent();
    },
  });
  const channel = getDelayedChannel(channelPromise);

  assert.equal(await channel.call('load', 'settings'), 'load:settings');
});

test('getNextTickChannel defers calls until the next task', async () => {
  const calls: string[] = [];
  const channel = getNextTickChannel<IChannel>({
    async call<TResult = unknown>(command: string) {
      calls.push(command);
      return true as TResult;
    },
    listen() {
      return emptyEvent();
    },
  });
  const callPromise = channel.call('later');

  assert.deepEqual(calls, []);
  assert.equal(await callPromise, true);
  assert.deepEqual(calls, ['later']);
});

test('MainProcessService routes channels through its router', async () => {
  const serverChannel: IServerChannel<string> = {
    async call<TResult = unknown>(ctx: string, command: string) {
      return `${ctx}:${command}` as TResult;
    },
    listen() {
      return emptyEvent();
    },
  };
  const client = {
    ctx: 'window:1',
  };
  const hub: IConnectionHub<string> = {
    connections: [client],
    onDidAddConnection: emptyEvent(),
    onDidRemoveConnection: emptyEvent(),
  };
  const server = {
    registerChannel() {},
    getChannel<T extends IChannel = IChannel>(
      _channelName: string,
      router: StaticRouter<string>,
    ): T {
      return {
        async call<TResult = unknown>(command: string) {
          const routedClient = await router.routeCall(hub, command);
          return serverChannel.call<TResult>(routedClient.ctx, command);
        },
        listen() {
          return emptyEvent();
        },
      } as unknown as T;
    },
  };
  const service = new MainProcessService(
    server,
    new StaticRouter((ctx) => ctx === 'window:1'),
  );

  assert.equal(await service.getChannel('test').call('ping'), 'window:1:ping');
});

test('createRemoteService can instantiate a channel client', async () => {
  class TestClient {
    constructor(private readonly channel: IChannel) {}

    ping() {
      return this.channel.call<string>('ping');
    }
  }

  const remote = {
    getChannel(): IChannel {
      return {
        async call<TResult = unknown>(command: string) {
          return command as TResult;
        },
        listen() {
          return emptyEvent();
        },
      };
    },
  };
  const service = createRemoteService('test', remote, {
    channelClientCtor: TestClient,
  });

  assert.equal(await service.ping(), 'ping');
});
