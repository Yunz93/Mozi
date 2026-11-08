/** Observe real callback data; keep Tauri's read-only invoke entry point intact. */
export function instrumentSubscriptions(bridge) {
  const callbacks = bridge.callbacks;
  const originalSet = callbacks.set;
  const descriptor = Object.getOwnPropertyDescriptor(callbacks, "set");
  const observed = new Map();
  const originals = new Map();
  let changedAt = Date.now();
  const wrap = (id, callback) => {
    const wrapped = function (value) {
      const token = value?.subscriptionId ? value : value?.payload;
      if (
        typeof token?.subscriptionId === "string" &&
        typeof token.epoch === "string" &&
        Number.isSafeInteger(token.seq)
      ) {
        observed.set(token.subscriptionId, {
          subscriptionId: token.subscriptionId,
          epoch: token.epoch,
          afterSeq: token.seq,
        });
        changedAt = Date.now();
      }
      return Reflect.apply(callback, this, [value]);
    };
    originals.set(id, { original: callback, wrapped });
    return wrapped;
  };
  for (const [id, callback] of callbacks)
    originalSet.call(callbacks, id, wrap(id, callback));
  const set = function (id, callback) {
    return originalSet.call(this, id, wrap(id, callback));
  };
  Object.defineProperty(callbacks, "set", {
    value: set,
    configurable: true,
    writable: true,
  });
  bridge.__acceptanceSubscriptions = {
    snapshot: () => ({
      tokens: [...observed.values()],
      settled: Date.now() - changedAt > 300,
    }),
    restore: () => {
      for (const [id, { original, wrapped }] of originals)
        if (callbacks.get(id) === wrapped)
          originalSet.call(callbacks, id, original);
      if (callbacks.set === set) {
        if (descriptor) Object.defineProperty(callbacks, "set", descriptor);
        else delete callbacks.set;
      }
      delete bridge.__acceptanceSubscriptions;
    },
  };
  return true;
}
