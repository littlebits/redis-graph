var format = require('util').format
var joi = require('joi')
var Promise = require('bluebird')
var Changefeed = require('./publish')

function assertEdge(edge) {
  var schema = joi.object().keys({
    pid: joi.string().min(1).required(),
    sid: joi.string().min(1).required(),
    data: joi.object().required()
  })
  var result
  if ((result = joi.validate(edge, schema)).error) throw result.error
}

function defaults(userSettings) {
  var o = userSettings || {}
  o.keyNamespace = o.keyNamespace || 'graph'
  o.keyData = o.keyData || [ o.keyNamespace, 'fromto', '%s', '%s' ].join(':')
  o.keyFrom = o.keyFrom || [ o.keyNamespace, 'from', '%s' ].join(':')
  o.keyTo = o.keyTo || [ o.keyNamespace, 'to', '%s' ].join(':')
  o.keyNode = o.keyNode || [ o.keyNamespace, 'node', '%s' ].join(':')
  return o
}

/* Error Constructors */

function ErrorNoSuchEdge(badEdge) {
  badEdge = badEdge || {}
  var error = new Error('There is no edge from ' + badEdge.pid + ' to ' + badEdge.sid + '.')
  error.code = 'REDIS_GRAPH_NO_SUCH_EDGE'
  return error
}

function ErrorNoSuchNode(id) {
  var error = new Error('There is no such node with ID "' + id + '".')
  error.code = 'REDIS_GRAPH_NO_SUCH_NODE'
  return error
}




module.exports = graph

function graph(config) {
  config = defaults(config)
  var k = keyShaper(config)
  var db = config.db
  var publish = Changefeed(config.db, config)

  function forceCreateNode(id) {
    return db.setAsync(k({ id: id }), id).return(id)
  }

  function createEdge(spec) {
    assertEdge(spec)

    return assertEdgeNodesExists(spec)
    .then(function() {
      var atomic = db.multi()
      atomic.set(k(spec), JSON.stringify(spec.data))
      atomic.sadd(k({ from: spec.pid }), spec.sid)
      atomic.sadd(k({ to: spec.sid }), spec.pid)
      return Promise.promisify(atomic.exec, atomic)()
      .return(spec)
      .tap(publish.createdEdge)
    })
  }

  function forceCreateEdge(spec) {
    return Promise.join(
      forceCreateNode(spec.pid),
      forceCreateNode(spec.sid),
      createEdge(spec)
    )
    .get(2)
  }


  function updateEdge(edgeAfter) {
    var key = k(edgeAfter)
    return db
    .existsAsync(key)
    .then(function(isThere) {
      if (!isThere) return Promise.reject(ErrorNoSuchEdge(edgeAfter))
      if (isThere) {
        return db
        .getsetAsync(key, JSON.stringify(edgeAfter.data))
        .then(function(metadataBefore) {
          var edgeBefore = edgeModel(edgeAfter.sid, edgeAfter.pid, JSON.parse(metadataBefore))
          return publish
          .updatedEdge(edgeBefore, edgeAfter)
          .return(edgeAfter)
        })
      }
    })
  }

  // Alternative Signature: { pid, sid } -> Promise edge
  function getEdge(sid, pid) {
    var link = typeof sid === 'string'
               ? { sid: sid, pid: pid }
               : sid
    return db
      .getAsync(k(link))
      .then(validate)

    function validate(edgeData) {
      return !edgeData
             ? Promise.reject(ErrorNoSuchEdge({ sid: sid, pid: pid }))
             : edgeModel(link.sid, link.pid, JSON.parse(edgeData))
    }
  }

  function getFrom(pid) {
    return assertNodeExists(pid)
    .then(function() {
      return db
      .smembersAsync(k({ from: pid }))
      .map(function(sid) {
        return getEdge({ sid: sid, pid: pid })
      })
    })
  }

  function getTo(sid) {
    return assertNodeExists(sid)
    .then(function() {
      return db
      .smembersAsync(k({ to: sid }))
      .map(function(pid) {
        if (!pid) return Promise.reject(ErrorNoSuchNode(sid))
          return getEdge({ sid: sid, pid: pid })
      })
    })
  }

  function assertNodeExists(id) {
    return db
    .existsAsync(k({ id: id }))
    .then(Boolean)
    .then(function(exists) {
      return exists
        ? null
        : Promise.reject(ErrorNoSuchNode(id))
    })
  }

    function failMessage(type, edge) {
        if (type === 1) return format('Edge cannot be created because of unknown publisher "%s" and unknown subscriber "%s".', edge.pid, edge.sid)
        if (type === 2) return format('Edge cannot be created because of unknown publisher "%s".', edge.pid)
        if (type === 3) return format('Edge cannot be created because of unknown subscriber "%s".', edge.sid)
    }
    function assertEdgeNodesExists(edge) {
        return Promise.join(
            db.existsAsync(k({ id: edge.pid })).then(Boolean),
            db.existsAsync(k({ id: edge.sid })).then(Boolean)
        ).spread(function (from, to) {
            var failCode = !from && !to ? 1 : !from ? 2 : !to ? 3 : null
            if (failCode) {
                var error = new Error(failMessage(failCode, edge))
                error.code = 'REDIS_GRAPH_NO_SUCH_NODE'
                return Promise.reject(error)
            }
        })
    }



  // Alternative signature: edge -> Promise
  function destroyEdge(sid, pid) {
    if (typeof sid === 'object') {
      pid = sid.publisher_id || sid.pid
      sid = sid.subscriber_id || sid.sid
    }
    return getEdge(sid, pid)
    .then(function(edge) {
      var atomic = db.multi()
      atomic.del(k({ to: sid, from: pid }))
      atomic.srem(k({ to: sid }), pid)
      atomic.srem(k({ from: pid }), sid)
      return Promise.promisify(atomic.exec, atomic)()
      .return(edge)
      .tap(publish.destroyedEdge)
    })
  }

  function getAll(id) {
    return assertNodeExists(id)
    .then(function() {
      return getIndexes(id)
      .then(getAllEdges(id))
    })
  }

  function getEdges(dirs) {
    if (typeof dirs === 'string') return getAll(dirs)
    if (typeof dirs.any === 'string') return getAll(dirs.any)
    return dirs.pid
           ? dirs.sid
             ? getEdge(dirs.sid, dirs.pid).then(inArray)
             : getFrom(dirs.pid)
           : getTo(dirs.sid)
  }

  function getAllEdges(id) {
    return function (indexes) {
      var atomic = db.multi()
      var keys = indexes.map(function(index) {
        return k(index.type === 'pid' ? { from: index.id, to: id } : { from: id, to: index.id })
      })
      // console.log('getAllEdges keys: %j based on indexes:', keys, indexes)
      // Get each edge's data
      keys.forEach(function(key) { atomic.get(key) })
      return Promise
      .promisify(atomic.exec, atomic)()
      .then(function(datas) {
        // console.log('getAllEdges datas: %j', datas)
        return indexes.map(function(index, i) {
          return edgeModel(
            (index.type === 'sid' ? index.id : id),
            (index.type === 'pid' ? index.id : id),
            JSON.parse(datas[i])
          )
        })
      })
    }
  }


  function destroyNode(id) {
    return assertNodeExists(id)
    .then(function() {
      return getIndexes(id)
      .then(function(indexes) {
        if (!indexes) return Promise.reject(ErrorNoSuchNode(id))
          return getAllEdges(id)(indexes)
        .tap(function() {
          var atomic = db.multi()

          // Delete this node's indexes
          // and edge descriptions.
          atomic.del(
            [ k({ from: id }), k({ to: id }) ]
            .concat(indexes.map(function(index) {
              var key = k({
                from: (index.type === 'pid' ? index.id : id),
                to: (index.type === 'sid' ? index.id : id)
              })
              return key
            }))
            // Remove the node itself.
            .concat([k({ id: id })])
          )

          // Remove this node's (A) presence in other
          // nodes' indexes (NS).
          indexes.forEach(function(index) {
            atomic.srem(k({
              /* For NS publishing
              to A we find index from:N and remove A. For
              NS subscribed to A we find index to:N and remove
              A.*/
              from: (index.type === 'pid' ? index.id : null),
              to: (index.type === 'sid' ? index.id : null)
            }), id)
          })

          return Promise.promisify(atomic.exec, atomic)()
        })
        .tap(publish.destroyedEdges)
      })
    })
  }

  function getIndexes(id) {
    var atomic = db.multi()
    atomic.smembers(k({ from: id }))
    atomic.smembers(k({ to: id }))
    return Promise
    .promisify(atomic.exec, atomic)()
    .spread(function(fromMe, toMe) {
      return fromMe
      .map(function(sid) { return { type: 'sid', id: sid } })
      .concat(toMe.map(function(pid) { return { type: 'pid', id: pid } }))
    })
  }

  return {
    forceCreateEdge: forceCreateEdge,
    forceCreateNode: forceCreateNode,
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



// Helpers

function inArray(x) {
  return [x]
}

function keyShaper(o) {
  return function shapeKey(keyspec) {
    if (keyspec.id) return format(o.keyNode, keyspec.id)
    var fromMe = keyspec.from || keyspec.pid
    var toMe = keyspec.to || keyspec.sid
    return fromMe
           ? toMe
             ? format(o.keyData, fromMe, toMe)
             : format(o.keyFrom, fromMe)
           : format(o.keyTo, toMe)
  }
}

function edgeModel(sid, pid, data) {
  return {
    sid: sid,
    pid: pid,
    data: data
  }
}
