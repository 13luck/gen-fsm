import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { genFSM, StateContext } from './fsm'


describe('genFSM', () => {
  beforeEach(vi.useFakeTimers)
  afterEach(vi.useRealTimers)

  it('transitions through generator return', async () => {
    const log: string[] = []

    async function* Sleep() {
      log.push('Sleep:Enter')

      try {
        while (true) {
          const event: unknown = yield
          if (event === 'wake') return Active
        }
      } finally {
        log.push('Sleep:Exit')
      }
    }

    async function* Active() {
      log.push('Active:Enter')

      try { yield } finally {
        log.push('Active:Exit')
      }
    }

    const fsm = genFSM(Sleep)
    expect(log).toEqual(['Sleep:Enter'])

    await fsm.dispatch('wake')
    expect(log).toEqual(['Sleep:Enter', 'Sleep:Exit', 'Active:Enter'])
  })

  it('dispatches scheduled event', async () => {
    vi.useFakeTimers()
    const log: string[] = []

    async function* Red(context: StateContext) {
      log.push('Red:Enter')
      const timeout = context.schedule(3000)

      try {
        while (true) {
          const event: unknown = yield
          if (event === timeout) return Green
        }
      } finally {
        log.push('Red:Exit')
      }
    }

    async function* Green() {
      log.push('Green:Enter')
      return undefined
    }

    genFSM(Red)
    expect(log).toEqual(['Red:Enter'])

    await vi.advanceTimersByTimeAsync(2999)
    expect(log).toEqual(['Red:Enter'])

    await vi.advanceTimersByTimeAsync(1)
    expect(log).toEqual(['Red:Enter', 'Red:Exit', 'Green:Enter'])

    vi.useRealTimers()
  })

  it('serializes external and scheduled events', async () => {
    vi.useFakeTimers()

    const log: string[] = []

    async function* StateA(context: StateContext) {
      context.schedule(100, 'timer')

      try {
        while (true) {
          const event: unknown = yield
          log.push(event as string)
          if (event === 'timer') return StateB
        }
      } finally {
        log.push('A:Exit')
      }
    }

    async function* StateB() {
      log.push('B:Enter')
    }

    const fsm = genFSM(StateA)

    await fsm.dispatch('socket')
    expect(log).toEqual(['socket'])

    await vi.advanceTimersByTimeAsync(100)
    expect(log).toEqual(['socket', 'timer', 'A:Exit', 'B:Enter'])

    vi.useRealTimers()
  })

  it('propagates unexpected state errors', async () => {
    const error = new Error('something went wrong')
    const log: string[] = []

    async function* Broken() {
      log.push('Broken:Enter')

      try {
        const event: unknown = yield
        if (event === 'boom') throw error
      } finally {
        log.push('Broken:Exit')
      }
    }

    const fsm = genFSM(Broken)
    expect(log).toEqual(['Broken:Enter'])

    await expect(fsm.dispatch('boom')).rejects.toBe(error)
    expect(log).toEqual(['Broken:Enter', 'Broken:Exit'])
  })

  it('cleans up scheduled events when state throws', async () => {
    vi.useFakeTimers()

    const error = new Error('boom')
    const log: string[] = []

    async function* Broken(context: StateContext) {
      context.schedule(1000, 'late-event')

      try {
        const event: unknown = yield
        if (event === 'boom') throw error
      } finally {
        log.push('Broken:Exit')
      }
    }

    const fsm = genFSM(Broken)

    await expect(fsm.dispatch('boom')).rejects.toBe(error)

    expect(log).toEqual(['Broken:Exit'])
    await vi.advanceTimersByTimeAsync(1000)

    // if cleanup works, the timer should not fire again
    expect(log).toEqual(['Broken:Exit'])

    vi.useRealTimers()
  })

  it('rejects dispatch after FSM stopped', async () => {
    async function* State() {
      yield
      return undefined
    }

    const fsm = genFSM(State)

    await fsm.dispatch('stop')
    await expect(fsm.dispatch('another-event')).rejects.toBeInstanceOf(Error)
  })

  it('drops queued events when FSM stops', async () => {
    const log: string[] = []

    async function* State() {
      log.push('Enter')

      while (true) {
        const event: unknown = yield
        log.push(event as string)
        if (event === 'stop') return undefined
      }
    }

    const fsm = genFSM(State)

    const first = fsm.dispatch('stop')
    const second = fsm.dispatch('should-not-be-processed')

    await first
    await expect(second).resolves.toBeUndefined()

    expect(log).toEqual(['Enter', 'stop'])
  })

  it('runs a sequential scenario with different kinds of waiting', async () => {
    vi.useFakeTimers()
    const log: string[] = []

    async function* Scenario(context: StateContext) {
      log.push('Scenario:Enter')

      try {
        // wait for X
        let event: unknown

        while ((event = yield) !== 'X');
        log.push('Action:X')

        // wait for 1 second
        const timeout = context.schedule(1000)
        while ((event = yield) !== timeout);
        log.push('Timer:1s')

        // wait for Y
        while ((event = yield) !== 'Y');
        log.push('Action:Y')

        return Done
      } finally {
        log.push('Scenario:Exit')
      }
    }

    async function* Done() {
      log.push('Done:Enter')
    }

    const fsm = genFSM(Scenario)

    expect(log).toEqual(['Scenario:Enter'])

    // X hasn't happened yet
    await fsm.dispatch('something-else')
    expect(log).toEqual(['Scenario:Enter'])

    // X → action
    await fsm.dispatch('X')
    await fsm.dispatch('Y')
    expect(log).toEqual(['Scenario:Enter', 'Action:X'])

    // 999ms isn't enough
    await vi.advanceTimersByTimeAsync(999)
    expect(log).toEqual(['Scenario:Enter', 'Action:X'])

    // 1s → timer event → next step
    await vi.advanceTimersByTimeAsync(1)
    expect(log).toEqual(['Scenario:Enter', 'Action:X', 'Timer:1s'])

    // still waiting for Y
    await fsm.dispatch('something-else')
    expect(log).toEqual(['Scenario:Enter', 'Action:X', 'Timer:1s'])

    // Y → action → transition
    await fsm.dispatch('Y')
    expect(log).toEqual(['Scenario:Enter', 'Action:X', 'Timer:1s', 'Action:Y', 'Scenario:Exit', 'Done:Enter'])

    vi.useRealTimers()
  })

  it('queues events while state is awaiting asynchronous work', async () => {
    const log: string[] = []

    let resolveWork!: () => void
    const asyncWork = new Promise<void>(resolve => resolveWork = resolve)

    async function* Scenario() {
      log.push('Enter')

      let event: unknown

      while ((event = yield) !== 'X');
      log.push('X:received')

      // FSM hangs here indefinitel
      await asyncWork
      log.push('Async:done')

      // the first event received after await must be Y
      while ((event = yield) !== 'Y');
      log.push('Y:received')

      // then wait for Z
      while ((event = yield) !== 'Z');
      log.push('Z:received')

      return async function* Done() {
        log.push('Done:Enter')
      }
    }

    const fsm = genFSM(Scenario)

    expect(log).toEqual(['Enter'])

    // X starts async work
    await fsm.dispatch('miss')
    await fsm.dispatch('miss')
    const dispatchX = fsm.dispatch('X')
    await fsm.dispatch('miss')
    expect(log).toEqual(['Enter', 'X:received'])

    // while the state is inside await, subsequent events should be queued
    const dispatchY = fsm.dispatch('Y')
    const dispatchZ = fsm.dispatch('Z')

    // neither Y nor Z should be processed yet
    expect(log).toEqual(['Enter', 'X:received'])

    // complete async work
    resolveWork()

    // now the X layer continues
    await dispatchX
    expect(log).toEqual(['Enter', 'X:received', 'Async:done', 'Y:received', 'Z:received', 'Done:Enter'])

    // all queued dispatch should complete as well
    await dispatchY
    await dispatchZ
  })

  it('transitions on either an external event or a timeout', async () => {
    vi.useFakeTimers()

    async function* StateB(log: string[]) {
      log.push('B:Enter')
    }

    async function* StateA(log: string[], context: StateContext) {
      log.push('A:Enter')

      try {
        const timer = context.schedule(1000)
        const event: unknown = yield
        if (event === 'go' || event === timer) return StateB.bind(null, log)
      } finally {
        log.push('A:Exit')
      }
    }

    // case 1: external event wins
    {
      const log: string[] = []

      const fsm = genFSM(StateA.bind(null, log))
      expect(log).toEqual(['A:Enter'])

      await fsm.dispatch('go')
      expect(log).toEqual(['A:Enter', 'A:Exit', 'B:Enter'])

      // Timer должен быть очищен при transition
      await vi.advanceTimersByTimeAsync(1000)
      expect(log).toEqual(['A:Enter', 'A:Exit', 'B:Enter'])
    }

    // case 2: timeout wins
    {
      const log: string[] = []

      genFSM(StateA.bind(null, log))
      expect(log).toEqual(['A:Enter'])

      await vi.advanceTimersByTimeAsync(999)
      expect(log).toEqual(['A:Enter'])

      await vi.advanceTimersByTimeAsync(1)
      expect(log).toEqual(['A:Enter', 'A:Exit', 'B:Enter'])
    }

    vi.useRealTimers()
  })

  it('awaits asynchronous work inside a state', async () => {
    const log: string[] = []

    let resolveWork!: () => void
    let reachedAsyncWork!: () => void

    const asyncWork = new Promise<void>(resolve => resolveWork = resolve)
    const reachedAsync = new Promise<void>(resolve => reachedAsyncWork = resolve)

    async function* Scenario() {
      log.push('Enter')

      let event: unknown

      do { event = yield } while (event !== 'X')

      log.push('X:received')
      reachedAsyncWork()

      await asyncWork

      log.push('Async:done')

      do { event = yield } while (event !== 'Y')

      log.push('Y:received')

      return async function* Done() {
        log.push('Done:Enter')
      }
    }

    const fsm = genFSM(Scenario)

    expect(log).toEqual(['Enter'])

    let completed = false
    const dispatchX = fsm.dispatch('X').then(() => completed = true)

    // exactly know that Scenario has received X and is waiting on asyncWork
    await reachedAsync

    expect(log).toEqual(['Enter', 'X:received'])
    expect(completed).toBe(false)

    resolveWork()

    await dispatchX
    expect(log).toEqual(['Enter', 'X:received', 'Async:done'])

    await fsm.dispatch('Y')
    expect(log).toEqual(['Enter', 'X:received', 'Async:done', 'Y:received', 'Done:Enter'])
  })

  it('calls function from userContext', async () => {
    const userContext = { mock: vi.fn() }

    async function* Sleep({ mock }: StateContext<typeof userContext>) {
      mock()
      return
    }

    const fsm = genFSM(Sleep, userContext)
    await fsm.dispatch('start')

    expect(userContext.mock).toHaveBeenCalledTimes(1)
  })

  it('preserves local state across events within the same state', async () => {
    const onCount = vi.fn()
    const onExit = vi.fn()

    async function* Exit() {
      onExit()
    }

    async function* Counter() {
      let count = 0

      while (true) {
        const event: unknown = yield
        if (event !== 'click') continue

        count++
        onCount(count)

        if (count === 3) return Exit
      }
    }

    const fsm = genFSM(Counter)

    await fsm.dispatch('click')
    await fsm.dispatch('click')
    await fsm.dispatch('click')

    expect(onCount).toHaveBeenCalledTimes(3)
    expect(onCount).toHaveBeenNthCalledWith(1, 1)
    expect(onCount).toHaveBeenNthCalledWith(2, 2)
    expect(onCount).toHaveBeenNthCalledWith(3, 3)

    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('resets local state when a state is entered again', async () => {
    const counts: number[] = []

    async function* Counter() {
      let count = 0

      while (true) {
        const event: unknown = yield
        if (event !== 'click') continue

        count++
        counts.push(count)

        if (count === 2) return Counter
      }
    }

    const fsm = genFSM(Counter)

    await fsm.dispatch('click')
    await fsm.dispatch('click')

    // Counter completed and was recreated
    await fsm.dispatch('click')
    await fsm.dispatch('click')

    expect(counts).toEqual([1, 2, 1, 2])
  })

  it('should add and then remove an entry after 10 seconds', async () => {
    type Context = { cache: Set<string> }

    async function* Registry(context: StateContext<Context>) {
      const processing = new Map<symbol, string>()

      while (true) {
        const event: unknown = yield

        if (typeof event === 'string') {
          if (context.cache.has(event)) continue
          context.cache.add(event)
          processing.set(context.schedule(10_000), event)

        } else if (typeof event === 'symbol') {
          if (!processing.has(event)) continue
          context.cache.delete(processing.get(event)!)
          processing.delete(event)
        }
      }
    }

    const context: Context = { cache: new Set<string>() }
    const fsm = genFSM(Registry, context)

    const registerValue = (gameId: string) => fsm.dispatch(gameId)
    const exists = (gameId: string) => context.cache.has(gameId)


    const gameId = 'gameId'

    // check initial state
    expect(exists(gameId)).toBe(false)

    await registerValue(gameId)

    // the entry still exists after 9.9 seconds
    vi.advanceTimersByTime(9999)
    await Promise.resolve()
    expect(exists(gameId)).toBe(true)

    // the entry is removed after 10 seconds
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(exists(gameId)).toBe(false)
  })
})
