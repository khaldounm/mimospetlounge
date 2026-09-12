// Runs `fn` over `items` with at most `limit` in flight, in order of start.
// For a batch of provider calls: enough parallelism to stop a long list being
// one slow serial loop, little enough not to hammer the other end.
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
}
