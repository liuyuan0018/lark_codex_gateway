export function createKeyedQueue() {
  const tails = new Map();

  function enqueue(key, task) {
    if (typeof key !== "string" || !key) {
      throw new Error("队列键不能为空");
    }
    const previous = tails.get(key) || Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(task)
      .finally(() => {
        if (tails.get(key) === current) {
          tails.delete(key);
        }
      });
    tails.set(key, current);
    return current;
  }

  async function drain() {
    await Promise.allSettled([...tails.values()]);
  }

  return {
    enqueue,
    drain,
    get keyCount() {
      return tails.size;
    },
  };
}
