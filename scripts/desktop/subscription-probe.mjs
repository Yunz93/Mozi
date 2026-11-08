/** Observe real IPC promises; do not replace a command, response, or rejection. */
export function instrumentSubscriptions(bridge) {
  const original = bridge.invoke;
  const active = new Map();
  const revoked = new Set();
  let changedAt = Date.now();
  const wrapped = function (command, args, ...options) {
    const reply = Reflect.apply(original, this, [command, args, ...options]);
    if (command === "unsubscribe_vault") {
      revoked.add(args.subscriptionId);
      active.delete(args.subscriptionId);
      changedAt = Date.now();
    }
    if (command === "subscribe_vault" || command === "get_vault_changes") {
      reply.then(
        (value) => {
          const token =
            command === "subscribe_vault"
              ? {
                  subscriptionId: value.subscriptionId,
                  epoch: value.epoch,
                  afterSeq: value.seq,
                }
              : args;
          if (!revoked.has(token.subscriptionId))
            active.set(token.subscriptionId, token);
          if (command === "subscribe_vault") changedAt = Date.now();
        },
        () => {
          if (args?.subscriptionId) active.delete(args.subscriptionId);
        },
      );
    }
    return reply;
  };
  bridge.invoke = wrapped;
  bridge.__acceptanceSubscriptions = {
    snapshot: () => ({
      tokens: [...active.values()],
      settled: Date.now() - changedAt > 300,
    }),
    restore: () => {
      if (bridge.invoke === wrapped) bridge.invoke = original;
      delete bridge.__acceptanceSubscriptions;
    },
  };
  return true;
}
