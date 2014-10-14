var format = require('util').format
var P = require('bluebird')



module.exports = graph

function graph(config){
  var db = config.db
  var k = graphKeys(config)

  function createEdge(spec){
    var atomic = db.multi()
    atomic.set(k(spec), JSON.stringify(spec.events))
    atomic.sadd(k({ from: spec.pid }), spec.sid)
    atomic.sadd(k({ to: spec.sid }), spec.pid)
    return P
      .promisify(atomic.exec, atomic)()
      .return(spec)
  }

  function updateEdge(spec){
    return db
    .existsAsync(k(spec))
    .then(function(isThere){
      if (isThere) return db
        .getsetAsync(k(spec), JSON.stringify(spec.events))
        .then(function(filterBefore){
          return postprocess(spec.sid, spec.pid, filterBefore)
        })
    })
  }

  // Alt signature: {pid,sid} -> Promise edge
  function getEdge(sid, pid){
    var link =  typeof sid === 'string'
                ? { sid:sid, pid:pid }
                : sid
    return db
      .getAsync(k(link))
      .then(validate)

    function validate(edgeData){
      return  !edgeData
              ? new Error('Not a subscription')
              : postprocess(link.sid, link.pid, edgeData)
    }
  }

  function postprocess(sid, pid, edge){
    return {
      sid: sid,
      pid: pid,
      events: JSON.parse(edge)
    }
  }

  function getFrom(pid){
    return db
    .smembersAsync(k({ from: pid }))
    .map(function(sid){ return getEdge({ sid:sid, pid:pid }) })
  }

  function getTo(sid){
    return db
    .smembersAsync(k({ to:sid }))
    .map(function(pid){ return getEdge({ sid:sid, pid:pid }) })
  }



  // Alternative signature: edge -> Promise
  function destroyEdge(sid, pid){
    if (typeof sid === 'object') {
      pid = sid.publisher_id || sid.pid
      sid = sid.subscriber_id || sid.sid
    }
    // console.log(0, 'getting-edge', sid,pid)
    return getEdge(sid,pid)
    .then(function(edge){
      // console.log(1, 'got-edge')
      var atomic = db.multi()
      atomic.del(k({ to: sid, from: pid }))
      atomic.srem(k({ to:sid }), pid)
      atomic.srem(k({ from:pid }), sid)
      return  P.promisify(atomic.exec, atomic)()
      .return(edge)
    })
  }

  function getAll(id){
    return getIndexes(id)
    .then(getAllEdges(id))
  }

  function getEdges(dirs){
    if (typeof dirs === 'string') return getAll(dirs)
    if (typeof dirs.any === 'string') return getAll(dirs.any)
    return  dirs.from
            ? dirs.to
              ? getEdge(dirs.to, dirs.from)
              : getFrom(dirs.from)
            : getTo(dirs.to)
  }

  function getAllEdges(id){
    return function (indexes){
      var atomic = db.multi()
      var keys = indexes.map(function(index){
        return k(index.type === 'pid' ? {from:index.id, to:id} : {from:id, to:index.id})
      })
      // console.log('getAllEdges keys: %j based on indexes:', keys, indexes)
      // Get each edge's data
      keys.forEach(function(key){ atomic.get(key) })
      return P
        .promisify(atomic.exec, atomic)()
        .then(function(filterSpecs){
          // console.log('getAllEdges filterSpecs: %j', filterSpecs)
          return indexes.map(function(index, i){
            return {
              pid: (index.type === 'pid' ? index.id : id),
              sid: (index.type === 'sid' ? index.id : id),
              events: JSON.parse(filterSpecs[i])
            }
          })
        })
    }
  }


  function destroyNode(id){
    return getIndexes(id)
    .then(function(indexes){
      return getAllEdges(id)(indexes)
      .tap(function(){
        var atomic = db.multi()
        // Delete this node's indexes
        // and edge descriptions.
        atomic.del(
          [k({from:id}), k({to:id})]
          .concat(indexes.map(function(index){
            var key = k({
              from: (index.type === 'pid' ? index.id : id),
              to: (index.type === 'sid' ? index.id : id)
            })
            return key
          }))
        )
        // Remove this node's (A) presence in other
        // nodes' indexes (NS).
        indexes.forEach(function(index){
          atomic.srem(k({
            /* For NS publishing
            to A we find index from:N and remove A. For
            NS subscribed to A we find index to:N and remove
            A.*/
            from: (index.type === 'pid' ? index.id : null),
            to: (index.type === 'sid' ? index.id : null)
          }), id)
        })
        return P.promisify(atomic.exec, atomic)()
      })

    })
  }

  function getIndexes(id){
    var atomic = db.multi()
    atomic.smembers(k({from:id}))
    atomic.smembers(k({to:id}))
    return P
      .promisify(atomic.exec, atomic)()
      .spread(function(fromMe, toMe){
        return fromMe
        .map(function(sid){ return { type: 'sid', id: sid } })
        .concat(toMe.map(function(pid){ return { type: 'pid', id: pid } }))
      })
  }

  return {
    createEdge: createEdge,
    updateEdge: updateEdge,
    getEdges: getEdges,
    getEdge: getEdge,
    getFrom: getFrom,
    getTo: getTo,
    getAll: getAll,
    destroyEdge: destroyEdge,
    destroyNode: destroyNode
  }
}



function graphKeys(c){
  var filterSpec = c.filterSpec || 'pubsub:subscription:%s:%s'
  var indexToMe = c.indexToMe || 'pubsub:subscription_index:%s'
  var indexFromMe = c.indexFromMe || 'pubsub:subscriber_index:%s'
  return function(keyspec){
    var fromMe = keyspec.from || keyspec.pid || keyspec.publisher_id
    var toMe = keyspec.to || keyspec.sid || keyspec.subscriber_id
    return  fromMe
            ? toMe
              ? format(filterSpec, fromMe, toMe)
              : format(indexFromMe, fromMe)
            : format(indexToMe, toMe)
  }
}
