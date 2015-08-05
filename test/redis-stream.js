import F from 'ramda'
import FRP from 'most'



export let message = F.curry((f, redisSubscriber) => (
  FRP.fromEvent('message', redisSubscriber)
  .filter(F.compose(f, F.nth(0)))
  .map(F.nth(1)) // Just the messages
))

export let anyMessage = message(F.always(true))

export let pmessage = F.curry((f, redisSubscriber) => (
  FRP.fromEvent('pmessage', redisSubscriber)
  .filter(F.compose(F.apply(f), F.slice(0, 1)))
  .map(F.nth(2)) // Just the messages
))

export let anyPmessage = pmessage(F.always(true))
