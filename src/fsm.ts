export type GenFSM = { dispatch: (event: unknown) => Promise<void> }
export type StateContext<T extends object = {}> = T & { schedule: (delay?: number, event?: unknown) => symbol, enterEvent?: unknown }
export type StateGenerator<T extends object = {}, Event = unknown> = AsyncGenerator<unknown, State<T> | void, Event>
type State<T extends object = {}> = (context: StateContext<T>) => StateGenerator<T>

/**
 * Initializes and runs a Finite State Machine (FSM) based on async generators.
 *
 * The FSM follows these semantics within a `StateGenerator`:
 * - `yield`: Pauses execution and waits for an external event or a scheduled timer.
 * - `return NextState`: Transitions the FSM to the next state.
 * - `return undefined`: Terminates the FSM.
 * - `throw error`: Propagates a programmer error (breach of contract) and triggers the `finally` block for cleanup.
 *
 * @param initial - The starting state function.
 * @param userContext - Extends state context.
 * @returns An object containing a `dispatch` method to send events to the machine.
 *
 * @example
 * const fsm = genFSM(async function* StateA({ schedule }) {
 *   const timeout = schedule(1000)
 *   const event = yield
 *   if (event === 'go' || event === timeout) return StateB
 * })
 * await fsm.dispatch('go')
 */

export function genFSM<T extends object = {}>(
  initial: State<T>,
  userContext?: T,
): GenFSM {
  const queue: unknown[] = []
  const schedules = new Map<symbol, ReturnType<typeof setTimeout>>()

  let dispatching = false
  let dispatch: (event: unknown) => Promise<void> = undefined!
  let stopped = false

  const context: StateContext<T> = {
    ...(userContext ?? ({} as T)),
    schedule(delay, event) {
      const key = Symbol('schedule')

      const timer = setTimeout(() => {
        schedules.delete(key)
        void dispatch(event ?? key).catch(console.error)
      }, delay ?? 0)

      schedules.set(key, timer)
      return key
    }
  }

  async function* run() {
    let current: State<T> | void = initial

    try {
      while (current) {
        const state = current(context)

        try {
          await state.next()

          cycle: while (true) {
            const event: unknown = yield
            const { done, value } = await state.next(event)

            if (!done) continue

            current = value
            break cycle
          }

        } finally {
          for (const timer of schedules.values()) clearTimeout(timer)
          schedules.clear()
        }
      }

    } finally {
      stopped = true
      queue.length = 0
    }
  }

  const machine = run()
  const ready = machine.next()

  dispatch = async event => {
    if (stopped) throw new Error('FSM stopped')

    queue.push(event)

    if (dispatching) return
    dispatching = true

    try {
      await ready
      while (queue.length) await machine.next(queue.shift())

    } finally {
      dispatching = false
    }
  }

  return { dispatch }
}
