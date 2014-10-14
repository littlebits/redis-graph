format = require('util').format
lo = require('lodash')
P = require('bluebird')
a = require('chai').assert
db = P.promisifyAll(require('redis')).createClient()
GLOBAL.a = a
GLOBAL.db = db


# extend = require('lodash').extend
# extend(a, require('../fixtures/assertions-pubsub'))
GLOBAL.equal = a.deepEqual
GLOBAL.eq = equal

a.edge = (spec)->
  {pid, sid, events} = spec
  getEdge(spec)
  .spread (sindex, pindex, edgeData)->
    a.include sindex, sid, 'SID in PID\'s subscriber index stored in database: subscription subscriber_index'
    a.include pindex, pid, 'PID in SID\'s subscriptions stored in database: subscription subscription_index'
    eq edgeData, events, 'stored in database: subscription'

a.noEdge = (link)->
  # console.log('check noEdge: %j', link)
  {pid, sid} = link
  getEdge(link)
  .spread (sindex, pindex, edgeData)->
    # console.log('for %j', link, sindex, pindex, edgeData)
    a.notInclude sindex, sid
    a.notInclude pindex, pid
    a.isNull edgeData, "Destroyed edge"

getEdge = (edge)->
  {pid, sid} = edge
  P.all([
    db.smembersAsync(('pubsub:subscriber_index:' + pid)),
    db.smembersAsync(('pubsub:subscription_index:' + sid)),
    db.getAsync(('pubsub:subscription:' + pid + ':' + sid)).then(JSON.parse)
  ])

GLOBAL.a.equalSets = (xs, zs)->
  zs_ = lo.cloneDeep(zs)
  xs.forEach (x, i)->
    contains = false
    zs_.forEach (z, zi)->
      if contains then return
      if lo.isEqual(x,z)
        contains = true
        zs_.splice(zi,1)
    if !contains
      msg = format('\nIs in set but should not be:\n\n%j\n\nExpected set is:\n\n%j\n\nGiven set was:\n\n%j', x, zs,xs)
      throw new Error(msg)
  if zs_.length
    msg = format('\nMissing from set:\n\n%j\n\nExpected set is:\n\n%j\n\nGiven set was:\n\n%j', zs_,zs,xs)
    throw new Error(msg)