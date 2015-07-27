require 'babel/register'
util = require('util')
{ format, inspect } = util
lo = require('lodash')
a = require('chai').assert
P = require('bluebird')
G = GLOBAL
G.a = a
G.lo = lo
G.Promise = P
G.db = P.promisifyAll(require('redis')).createClient()
G.sub = P.promisifyAll(require('redis')).createClient()
G.eq = lo.curry (msg, expected, actual)->
  a.deepEqual(actual, expected, msg)

GLOBAL.promiseError = (p)->
  p.then -> throw new Error 'Promise did not have an error.'


a.edge = (edge)->
  {pid, sid, data} = edge
  getEdge(edge)
  .spread (sindex, pindex, metadata)->
    a.include sindex, sid, 'SID in PID\'s subscriber index stored in database: subscription subscriber_index'
    a.include pindex, pid, 'PID in SID\'s subscriptions stored in database: subscription subscription_index'
    eq 'stored in database: subscription', data, metadata



a.publishes = (expectedData)->
  new P (resolve, reject)->
    published = []
    countdown = setTimeout((->
      msg = format('\nExpected graph changes:\n\n%s\n\nnot published; Meanwhile, other changes that were published:\n\n%s', inspect(expectedData, {depth:100}), published.map((x)->inspect(JSON.parse(x), {depth:100})).join('\n\n'))
      reject new Error(msg)
    ), 100)
    verify = (chan, data)->
      published.push(data)
      if (isEqualSets(JSON.parse(data), expectedData))
        # eq 'Graph changes published', expectedData, JSON.parse(data)
        clearTimeout(countdown)
        sub.removeListener('message', verify)
        resolve(sub.unsubscribeAsync('graph:changes'))
    sub.subscribe('graph:changes')
    sub.on('message', verify)



a.node = (id)->
  db
  .existsAsync("graph:node:#{id}")
  .then(Boolean)
  .tap (exists)-> a.isTrue exists, 'node exists'

a.noNode = (id)->
  db
  .existsAsync("graph:node:#{id}")
  .then(Boolean)
  .then (exists)->
    a.isFalse exists, 'node does not exist'

a.noEdge = (link)->
  # console.log('check noEdge: %j', link)
  { pid, sid } = link
  getEdge(link)
  .spread (sindex, pindex, edgeData)->
    # console.log('for %j', link, sindex, pindex, edgeData)
    a.notInclude sindex, sid
    a.notInclude pindex, pid
    a.isNull edgeData, "Destroyed edge"



a.equalSets = lo.curry (zs, xs)->
  if not isEqualSets(zs, xs)
    msg = format('\nExpected set:\n\n%j\n\nto equal:\n\n%j\n', zs, xs)
    throw new Error(msg)






# Helpers

isEqualSets = lo.curry (zs, xs)->
  return lo.any xs, (x)->
    return lo.any zs, (z)->
      if lo.isEqual(x, z) then return true

getEdge = (edge)->
  {pid, sid} = edge
  P.all([
    db.smembersAsync('graph:from:' + pid),
    db.smembersAsync('graph:to:' + sid),
    db.getAsync(('graph:fromto:' + pid + ':' + sid)).then(JSON.parse)
  ])
