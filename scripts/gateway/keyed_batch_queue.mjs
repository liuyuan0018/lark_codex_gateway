export function createKeyedBatchQueue(options = {}) {
  const {
    maxBatchSize = Number.POSITIVE_INFINITY,
    maxBatchWeight = Number.POSITIVE_INFINITY,
    itemWeight = () => 1,
  } = options;
  const states = new Map();

  function takeBatch(pending) {
    const batch = [];
    let weight = 0;
    while (pending.length > 0 && batch.length < maxBatchSize) {
      const nextWeight = Math.max(0, Number(itemWeight(pending[0].value)) || 0);
      if (batch.length > 0 && weight + nextWeight > maxBatchWeight) {
        break;
      }
      const entry = pending.shift();
      batch.push(entry);
      weight += nextWeight;
    }
    return batch;
  }

  async function run(key, state) {
    try {
      while (state.pending.length > 0) {
        const batch = takeBatch(state.pending);
        try {
          const result = await batch[0].worker(batch.map((entry) => entry.value));
          for (const entry of batch) {
            entry.resolve(result);
          }
        } catch (error) {
          for (const entry of batch) {
            entry.reject(error);
          }
        }
      }
    } finally {
      if (states.get(key) === state) {
        states.delete(key);
      }
      state.resolveDone();
    }
  }

  function enqueue(key, value, worker) {
    if (typeof key !== "string" || !key) {
      throw new Error("队列键不能为空");
    }
    if (typeof worker !== "function") {
      throw new Error("批处理函数不能为空");
    }
    let state = states.get(key);
    if (!state) {
      let resolveDone;
      state = {
        pending: [],
        done: new Promise((resolve) => {
          resolveDone = resolve;
        }),
        resolveDone,
      };
      states.set(key, state);
    }
    const queued = new Promise((resolve, reject) => {
      state.pending.push({ value, worker, resolve, reject });
    });
    if (state.pending.length === 1 && !state.running) {
      state.running = true;
      void run(key, state);
    }
    return queued;
  }

  async function drain() {
    while (states.size > 0) {
      await Promise.allSettled([...states.values()].map((state) => state.done));
    }
  }

  return {
    enqueue,
    drain,
    get keyCount() {
      return states.size;
    },
  };
}
