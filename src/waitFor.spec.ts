import { test, expect } from 'vitest'
import { genFSM } from './fsm'
import { waitFor } from './waitFor'

test('waitFor', async () => {
   const log: string[] = []

   async function* State() {
     while (true) {
       const x = yield* waitFor('x')
       log.push(x)

       const y = yield* waitFor('y')
       log.push(y)
     }
   }

   const fsm = genFSM(State)

   await fsm.dispatch('y')
   await fsm.dispatch('miss')
   await fsm.dispatch('x')
   await fsm.dispatch('miss')
   await fsm.dispatch('y')
   await fsm.dispatch('miss')

   expect(log).toEqual(['x', 'y'])
 })
