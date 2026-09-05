# `gen-fsm`

**Finite State Machine** based on [AsyncGenerator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator)

Not another FSM library. Rather than constructing an FSM over JavaScript, we'll find existing structures in the language that naturally compose an FSM. Everything runs natively; gen-fsm simply helps organize a sequential execution queue. By using generators, developers get a *scenario language*.

- NO strict object contract
- NO DSL
- Just vanilla JavaScript async function* generators ✨

<br>

The 3 building blocks of **FSM** concepts:

- **Finite states** — use generator `async function* State`
- **Events** — use `fsm.dispatch(event)` or `context.schedule(delay, event)`
- **Transitions** — use native `return NextState`


**AsyncGenerator** approach:

- `yield` is perfect for waiting for external events or timers
- `async/await` for any asynchronous operations
- `return NextState` is a clean way to define a transition (Note: `return undefined` will stop the entire machine)
- `finally` for cleanup when a state is exited


### Features

- 🎡 Deterministic sequential flow
- 🔁 Automatic event queuing / resource cleanup
- ⏳ async / await / yield
- ✅ Written in TypeScript 
- 🗜️ Extra small / zero dependencies

<br>

## Installation

```zsh
npm i gen-fsm
```


## Example usage

```ts
import { genFSM, type StateContext } from 'gen-fsm'

async function* StateA(context: StateContext) {
  const timeout = context.schedule(1000)
  const event = yield
  if (event === 'go' || event === timeout) return StateB
}

const fsm = genFSM(StateA)

fsm.dispatch('go')
```


## API Overview

### `genFSM`

```ts
const fsm = genFSM(AsyncGenerator, context)
```

Runs an FSM state generator with the given initial generator and context.
Use context for variables that should persist across states.


### `dispatch`

```ts
await fsm.dispatch(event)
```

Dispatches an event to the FSM, it executes `generator.next(event)` under the hood.
Use `await` if you want to wait for the state update to complete or simply fire and forget.


### `schedule`

```ts
const symbol = context.schedule(delay, event)
```

Defines a timeout for the FSM (uses setTimeout under the hood).
If `event` is not provided, the `symbol` will be used as the dispatch value.
This symbol can be used for subsequent tracking.


### `Types`

```ts
StateGenerator<T, E> // T is context, E is the event type
StateContext<T> // T is your shared data structure
```

Specify types for the state context and generator.



## Guidelines

Here is JavaScript. Write your program as usual.
Just remember that `yield` represents a point of waiting for the outside world and `return State` represents a transition.
We have literally forged our own form of FSM within the language without adding any new constructs.
FSM semantics emerge from the composition of perfectly legal JS mechanisms.

While the logic within a single state can be asynchronous, events are still serialized.
This FSM provides a small runtime with high expressiveness.
The generator acts as a bidirectional channel.
And the scenarios themselves are a convention-based embedded DSL.

Model your system so that the reason for a transition is clear within the state's logic.
Any data needed later can be stored and passed through the context.
And don't let `while (true)` worry you :D


### LLMs

No worries, LLMs are very helpful for FSM code generation. Since we don't use a specific DSL and provide a simple API, it's easy for LLMs to generate correct scenarios based on natural language.


## Examples

Explore various scenarios ranging from basic flows to advanced language features. Each example is categorized by difficulty:

- 🟢 **Easy** — basics
- 🟡 **Medium** — intermediate logic
- 🔴 **Hard** — advanced scenarios
- 🟣 **Esoteric** — valid JavaScript but slightly weird syntax

<br>
    
<details>
<summary>🟢 Basic transition</summary>

Transitioning between states using `return`.

```ts
async function* StateA() {
  while (true) {
    const event: unknown = yield
    if (event === 'go') return StateB
  }
}

async function* StateB() {
  while (true) {
    const event: unknown = yield
    if (event === 'go') return StateA
  }
}

const fsm = genFSM(StateA)

await fsm.dispatch('go') // StateB
await fsm.dispatch('go') // StateA
await fsm.dispatch('go') // StateB
```
</details>

<details>
<summary>🟢 Local state</summary>

```ts
async function* Counter() {
  let count = 0
  
  while (true) {
    const event: unknown = yield
    if (event === 'bump') count++
  }
}

const fsm = genFSM(Counter)

fsm.dispatch('bump')
fsm.dispatch('bump')
fsm.dispatch('bump')
```
</details>


<details>
<summary>🟢 Cleanup</summary>

Use `finally` to ensure that resources are released when the state exits.

```ts
async function* State() {
  try {
    while (true) {
      const event: unknown = yield
      if (event === 'next') return State
    }
  } finally {
    // await db/socket/etc close
    console.log('Exiting State')
  }
}

const fsm = genFSM(State)

fsm.dispatch('next')
fsm.dispatch('next')
fsm.dispatch('next')
```
</details>


<details>
<summary>🟡 Schedule</summary>

Schedule events with a delay.

```ts
async function* Ticker(context: StateContext) {
  context.schedule(1000, 'tick')
  const event: unknown = yield
  if (event === 'tick') return Ticker
}

const fsm = genFSM(Ticker)
```
</details>


<details>
<summary>🟡 Schedule with symbol</summary>

Use the unique `symbol` returned by `context.schedule(delay)` to identify events.

```ts
async function* Ticker(context: StateContext) {
  const symbol = context.schedule(1000)
  const event: unknown = yield
  if (event === symbol) return Ticker
}

const fsm = genFSM(Ticker)
```
</details>


<details>
<summary>🟡 Asynchronous</summary>

Handle async tasks (like API calls or timers) between events.

```ts
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function* State() {
  console.log('Entering')
  await delay(1000)

  while (true) {
    const event: unknown = yield
    await delay(1000)
    
    if (event === 'go') {
      return async function*() {
        console.log('Done')
      }
    }
  }
}

const fsm = genFSM(State)
await fsm.dispatch('go')
```
</details>


<details>
<summary>🔴 Context-based data propagation</summary>

Example of how to persist and pass data between states using the shared context.

```ts
async function* StateA(context: StateContext<{ enterEvent?: string }>) {
  while (true) {
    const event: unknown = yield
    
    if (event === 'go') {
      context.enterEvent = event
      return StateB
    }
  }
}

async function* StateB(context: StateContext<{ enterEvent?: string }>) {
    if (context.enterEvent) {
      const event = context.enterEvent
      context.schedule(0, event)
      delete context.enterEvent
    }
    
    while (true) {
      const event: unknown = yield
      if (event === 'go') return StateA
    }
}

const fsm = genFSM(StateA)

fsm.dispatch('go')
```
</details>


<details>
<summary>🔴 Cache with expiration</summary>

Automatically remove entries from a cache after a specified timeout.

```ts
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
```
</details>


<details>
<summary>🟣 Sequential flow</summary>

Model multi-step workflows by chaining `while` loops. Each loop represents a blocking requirement that must be fulfilled before moving to the next step.

```ts
async function* Scenario(context: StateContext) {
  let event: unknown
  
  // wait for event X
  while ((event = yield) !== 'X');
  console.log('X')
  
  const timeout = context.schedule(1000)
  while ((event = yield) !== timeout);
  console.log('timeout 1s')

  // wait for event Y
  while ((event = yield) !== 'Y');
  console.log('Y')

  return async function*() {
    console.log('Done')
  }
}

const fsm = genFSM(Scenario)
```
</details>

<br>
    
More examples can be found in `fsm.spec.ts`.


## License

[MIT](https://opensource.org/licenses/MIT) © 2026-present, [@13luck](https://13luck.ru)
