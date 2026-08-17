export async function* waitFor<T>(
  expected: T
): AsyncGenerator<unknown, T, unknown> {
  while (true) {
    const event = yield
    if (event === expected) return event as T
  }
}
