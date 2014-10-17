var format = require('util').format
var P = require('bluebird')
var Changefeed = require('./publish')

var joi = require('joi')
function assertEdge(edge){
  var schema = joi.object().keys({
    pid: joi.string().min(1).required(),
    sid: joi.string().min(1).required(),
    data: joi.object().required()
  })
  var result
  if ((result = joi.validate(edge, schema)).error) throw result.error
}

module.exports = graph

function graph(config){
  var k = keyShaper(config)
  var db = config.db
  var publish = Changefeed(config.db)

  function createEdge(spec){
    assertEdge(spec)
    var atomic = db.multi()
    atomic.set(k(spec), JSON.stringify(spec.data))
    atomic.sadd(k({ from: spec.pid }), spec.sid)
    atomic.sadd(k({ to: spec.sid }), spec.pid)
    return P.promisify(atomic.exec, atomic)()
    .return(spec)
    .tap(publish.createdEdge)
  }

  function updateEdge(edgeAfter){
    var key = k(edgeAfter)
    return db
    .existsAsync(key)
    .then(function(isThere){
      if (!isThere) return console.warn('Tried to update an edge\'s data but the edge did not exist: %j', edgeAfter)
      if (isThere) return db
        .getsetAsync(key, JSON.stringify(edgeAfter.data))
        .then(function(metadataBefore){
          var edgeBefore = edgeModel(edgeAfter.sid, edgeAfter.pid, JSON.parse(metadataBefore))
          return publish
          .updatedEdge(edgeBefore, edgeAfter)
          .return(edgeAfter)
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
              : edgeModel(link.sid, link.pid, JSON.parse(edgeData))
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
      .tap(publish.destroyedEdge)
    })
  }

  function getAll(id){
    return getIndexes(id).then(getAllEdges(id))
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
      .then(function(datas){
        // console.log('getAllEdges datas: %j', datas)
        return indexes.map(function(index, i){
          return edgeModel(
            (index.type === 'sid' ? index.id : id),
            (index.type === 'pid' ? index.id : id),
            JSON.parse(datas[i])
          )
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
      .tap(publish.destroyedEdges)
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



function keyShaper(config){
  var keyData = config.keyData || 'rsg:from:to:%s:%s'
  var keyFrom = config.keyFrom || 'rsg:from:%s'
  var keyTo = config.keyTo || 'rsg:to:%s'
  return function shapeKey(keyspec){
    var fromMe = keyspec.from || keyspec.pid
    var toMe = keyspec.to || keyspec.sid
    return  fromMe
            ? toMe
              ? format(keyData, fromMe, toMe)
              : format(keyFrom, fromMe)
            : format(keyTo, toMe)
  }
}



// Helpers

function edgeModel(sid, pid, data){
  return {
    sid: sid,
    pid: pid,
    data: data
  }
}
