require 'babel/register'
{ format, inspect } = require 'util'
G = GLOBAL
G.FRP = require 'most'
G.F = require 'ramda'
G.a = require('chai').assert
G.P = require 'bluebird'
G.Redis = require 'ioredis'
G.RedisStream = require './redis-stream'



F.push = F.flip F.append

G.Log = (args1...) -> (args2...) ->
  F.apply console.log, F.concat(args1, args2)

G.promiseError = (p)->
  p.then -> throw new Error 'Promise did not have an error.'

bufferOnceStream = (stream, count) ->
  stream.take(count).reduce(F.push, [])

G.streamTimeout = (ms) ->
  start = FRP.of()
  end = FRP.of().delay(ms)
  timeWindow = start.constant(end)

# Additional Assertions

a.eq = F.curry (msg, exp, act)-> a.deepEqual act, exp, msg
a.eqList = a.eq
a.eqSet = F.curry (msg, exp, act)->
  a.sameDeepMembers act, exp, msg
a.true = F.curry (msg, v)-> a.isTrue v, msg
a.false = F.curry (msg, v)-> a.isFalse v, msg
a.listLength = F.curry (count, xs) -> a.lengthOf xs, count
a.streamsExactly = (stream, xs) ->
  stream
  .during streamTimeout 500
  .reduce F.push, []
  .then a.eq 'streamed list of values', xs
a.streamsAtLeast = (stream, xs) ->
  bufferOnceStream stream, xs.length
  .then a.eqList 'streamed values', xs
a.streamsNothing = (stream) ->
  stream
  .during streamTimeout 500
  .reduce F.push, []
  .then a.listLength 0

a.streamsExactlyAnyOrder = (stream, xs) ->
  stream
  .during streamTimeout 500
  .reduce F.push, []
  .then a.eqSet 'streamed set of values', xs
a.streamsAnyOrder = (stream, xs) ->
  bufferOnceStream stream, xs.length
  .then a.eqSet xs
a.eventsReceived = (redisSubscriber, events) ->
  a.streams RedisStream.jsonMessage(redisSubscriber), events

a.edge = (edge)->
  {pid, sid, data} = edge
  getBetween(edge)
  .spread (sindex, pindex, metadata)->
    a.include sindex, sid, 'SID in PID\'s subscriber
    index stored in database: subscription subscriber_index'
    a.include pindex, pid, 'PID in SID\'s subscriptions
    stored in database: subscription subscription_index'
    a.eq 'stored in database: subscription', data, metadata

a.node = (id)->
  redis
  .exists "graph:node:#{id}"
  .then Boolean
  .tap a.true 'endpoint exists'

a.noNode = (id)->
  redis
  .exists "graph:node:#{id}"
  .then Boolean
  .tap a.false 'node does not exist'

a.noEdge = (link)->
  { pid, sid } = link
  getBetween link
  .spread (sindex, pindex, edgeData) ->
    a.notInclude sindex, sid
    a.notInclude pindex, pid
    a.isNull edgeData, "Destroyed edge"









# Helpers

getBetween = (edge)->
  {pid, sid} = edge
  P.all([
    redis.smembers('graph:from:' + pid),
    redis.smembers('graph:to:' + sid),
    redis.get(('graph:fromto:' + pid + ':' + sid)).then(JSON.parse)
  ])


beforeEach ->
  G.redis = Redis.createClient()
  @observers = []
  @changesStream = () =>
    observer = redis.duplicate()
    @observers.push(observer)
    observer.subscribe 'graph:changes'
    RedisStream.anyMessage observer
    .map JSON.parse

afterEach ->
  redis.flushdb()
  .then -> redis.quit
  .then => P.all @observers.map (o) -> o.quit()
