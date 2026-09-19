process.env.LOG_LEVEL = 'error';
process.env.DB_PASSWORD = 'test';

const { requestCoalesce } = require('../src/utils/coalescer');

describe('requestCoalesce', () => {
  test('concurrent callers share a single producer invocation', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return new Promise(resolve => setTimeout(() => resolve('value'), 10));
    };

    const [a, b, c] = await Promise.all([
      requestCoalesce('k1', producer),
      requestCoalesce('k1', producer),
      requestCoalesce('k1', producer)
    ]);

    expect(calls).toBe(1);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(c).toBe('value');
  });

  test('sequential calls after settlement re-invoke the producer', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    const first = await requestCoalesce('k2', producer);
    const second = await requestCoalesce('k2', producer);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  test('a rejected producer is cleaned up and never poisons the key', async () => {
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error(`boom ${calls}`));
    };
    const succeeding = () => {
      calls += 1;
      return Promise.resolve('recovered');
    };

    await expect(requestCoalesce('k3', failing)).rejects.toThrow('boom 1');
    await expect(requestCoalesce('k3', succeeding)).resolves.toBe('recovered');
    expect(calls).toBe(2);
  });

  test('different keys run their own producers', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    const [a, b] = await Promise.all([
      requestCoalesce('k4', producer),
      requestCoalesce('k5', producer)
    ]);

    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });

  test('a never-settling producer still runs only once for concurrent callers', async () => {
    let calls = 0;
    const producer = () => {
      calls += 1;
      return new Promise(() => {});
    };

    requestCoalesce('k6', producer);
    requestCoalesce('k6', producer);
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});
