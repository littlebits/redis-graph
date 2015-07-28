import { format } from 'util'
import joi from 'joi'
import P from 'bluebird'
import Changefeed from './publish'



let TypeEdge = joi.object().keys({
  pid: joi.string().min(1).required(),
  sid: joi.string().min(1).required(),
  data: joi.object().required()
})

let assertEdge = (edge) => {
  joi.assert(edge, TypeEdge)
}

let defaults = (userSettings) => {
  let o = userSettings || {}
  o.keyNamespace = o.keyNamespace || 'graph'
  o.keyData = o.keyData || [ o.keyNamespace, 'fromto', '%s', '%s' ].join(':')
  o.keyFrom = o.keyFrom || [ o.keyNamespace, 'from', '%s' ].join(':')
  o.keyTo = o.keyTo || [ o.keyNamespace, 'to', '%s' ].join(':')
  o.keyNode = o.keyNode || [ o.keyNamespace, 'node', '%s' ].join(':')
  return o
}



/* Error Constructors */

let ErrorNoSuchEdge = (badEdge) => {
  badEdge = badEdge || {}
  let error = new Error(format('There is no edge from %s to %s.', badEdge.pid, badEdge.sid))
  error.code = 'REDIS_GRAPH_NO_SUCH_EDGE'
  return error
}

let ErrorNoSuchNode = (id) => {
  let error = new Error(format('There is no such node with ID "%s".', id))
  error.code = 'REDIS_GRAPH_NO_SUCH_NODE'
  return error
}



// Helpers

let inArray = (x) => [x]

let keyShaper = (o) => (keyspec) => {
  if (keyspec.id) return format(o.keyNode, keyspec.id)
  let fromMe = keyspec.from || keyspec.pid
  let toMe = keyspec.to || keyspec.sid
  return fromMe
         ? toMe
           ? format(o.keyData, fromMe, toMe)
           : format(o.keyFrom, fromMe)
         : format(o.keyTo, toMe)
}

let edgeModel = (sid, pid, data) => (
  { sid, pid, data }
)





let Graph = (config) => {
  config = defaults(config)
  let k = keyShaper(config)
  let db = config.db
  let publish = Changefeed(config.db, config)

  let failMessage = (type, edge) => (
    type === 1
      ? format('Edge cannot be created because of unknown publisher "%s" and unknown subscriber "%s".', edge.pid, edge.sid)
    : type === 2
      ? format('Edge cannot be created because of unknown publisher "%s".', edge.pid)
    : type === 3
      ? format('Edge cannot be created because of unknown subscriber "%s".', edge.sid)
    : ''
  )

  let assertEdgeNodesExists = (edge) => (
    P.join(
      db.existsAsync(k({ id: edge.pid })).then(Boolean),
      db.existsAsync(k({ id: edge.sid })).then(Boolean)
    ).spread(function (from, to) {
        let failCode = !from && !to ? 1 : !from ? 2 : !to ? 3 : null
        if (failCode) {
            let error = new Error(failMessage(failCode, edge))
            error.code = 'REDIS_GRAPH_NO_SUCH_NODE'
            return P.reject(error)
      }
    })
  )

  let forceCreateNode = (id) => (
    db.setAsync(k({ id }), id).return(id)
  )

  let getIndexes = (id) => {
    let atomic = db.multi()
    atomic.smembers(k({ from: id }))
    atomic.smembers(k({ to: id }))
    return P
    .promisify(atomic.exec, atomic)()
    .spread((fromMe, toMe) => (
      fromMe
      .map((sid) => ({ type: 'sid', id: sid }))
      .concat(toMe.map((pid) => ({ type: 'pid', id: pid })))
    ))
  }

  let getAllEdges = (id) => (indexes) => {
      let atomic = db.multi()
      let keys = indexes.map((index) => (
        k(index.type === 'pid'
          ? { from: index.id, to: id }
          : { from: id, to: index.id })
      ))
      // console.log('getAllEdges keys: %j based on indexes:', keys, indexes)
      // Get each edge's data
      keys.forEach((key) => { atomic.get(key) })
      return P
      .promisify(atomic.exec, atomic)()
      .then((datas) => (
        indexes.map((index, i) => (
          edgeModel(
            (index.type === 'sid' ? index.id : id),
            (index.type === 'pid' ? index.id : id),
            JSON.parse(datas[i])
          )
        ))
      ))
  }

  let createEdge = (spec) => (
    assertEdge(spec),
    assertEdgeNodesExists(spec)
    .then(() => {
      let atomic = db.multi()
      atomic.set(k(spec), JSON.stringify(spec.data))
      atomic.sadd(k({ from: spec.pid }), spec.sid)
      atomic.sadd(k({ to: spec.sid }), spec.pid)
      return P.promisify(atomic.exec, atomic)()
      .return(spec)
      .tap(publish.createdEdge)
    })
  )

  let forceCreateEdge = (spec) => (
    P.join(
      forceCreateNode(spec.pid),
      forceCreateNode(spec.sid),
      createEdge(spec)
    )
    .get(2)
  )

  let updateEdge = (edgeAfter) => {
    let key = k(edgeAfter)
    return db
    .existsAsync(key)
    .then((isThere) => (
      !isThere
        ? P.reject(ErrorNoSuchEdge(edgeAfter))
        : db
        .getsetAsync(key, JSON.stringify(edgeAfter.data))
        .then((metadataBefore) => {
          let edgeBefore = edgeModel(edgeAfter.sid, edgeAfter.pid, JSON.parse(metadataBefore))
          return publish
          .updatedEdge(edgeBefore, edgeAfter)
          .return(edgeAfter)
        })
      )
    )
  }

  // Alternative Signature: { pid, sid } -> Promise edge
  let getEdge = (sid, pid) => {
    let link = typeof sid === 'string'
               ? { sid, pid }
               : sid
    return db
      .getAsync(k(link))
      .then(validate)

    function validate(edgeData) {
      return !edgeData
             ? P.reject(ErrorNoSuchEdge({ sid, pid }))
             : edgeModel(link.sid, link.pid, JSON.parse(edgeData))
    }
  }

  let assertNodeExists = (id) => (
    db
    .existsAsync(k({ id }))
    .then(Boolean)
    .then((exists) => (
      exists
        ? null
        : P.reject(ErrorNoSuchNode(id))
    ))
  )

  let getFrom = (pid) => (
    assertNodeExists(pid)
    .then(() => (
      db
      .smembersAsync(k({ from: pid }))
      .map((sid) => getEdge({ sid, pid }))
    ))
  )

  let getTo = (sid) => (
    assertNodeExists(sid)
    .then(() => (
      db
      .smembersAsync(k({ to: sid }))
      .map((pid) => (
        !pid
          ? P.reject(ErrorNoSuchNode(sid))
          : getEdge({ sid, pid })
      ))
    ))
  )

  // Alternative signature: edge -> Promise
  let destroyEdge = (sid, pid) => {
    if (typeof sid === 'object') {
      pid = sid.publisher_id || sid.pid
      sid = sid.subscriber_id || sid.sid
    }
    return getEdge(sid, pid)
    .then((edge) => {
      let atomic = db.multi()
      atomic.del(k({ to: sid, from: pid }))
      atomic.srem(k({ to: sid }), pid)
      atomic.srem(k({ from: pid }), sid)
      return P.promisify(atomic.exec, atomic)()
      .return(edge)
      .tap(publish.destroyedEdge)
    })
  }

  let getAll = (id) => (
    assertNodeExists(id)
    .then(() => (
      getIndexes(id)
      .then(getAllEdges(id))
    ))
  )

  let getEdges = (dirs) => (
    typeof dirs === 'string' ?
    getAll(dirs) :

    typeof dirs.any === 'string' ?
    getAll(dirs.any) :

    /* If _both_ pid/sid are specified then limit to subscriber's
    edge to publisher. Otherwise all edges either-or from the
    subscriber or to the publisher. */

    !dirs.pid ?
    getTo(dirs.sid) :

    dirs.sid ?
    getEdge(dirs.sid, dirs.pid).then(inArray) :

    getFrom(dirs.pid)
  )

  let destroyNode = (id) => (
    assertNodeExists(id)
    .then(() => (
      getIndexes(id)
      .then((indexes) => (
        !indexes
          ? P.reject(ErrorNoSuchNode(id))
          : getAllEdges(id)(indexes)
          .tap(() => {
            let atomic = db.multi()

            // Delete this node's indexes
            // and edge descriptions.
            atomic.del(
              [ k({ from: id }), k({ to: id }) ]
              .concat(indexes.map((index) => (
                k({
                  from: (index.type === 'pid' ? index.id : id),
                  to: (index.type === 'sid' ? index.id : id)
                })
              )))
              // Remove the node itself.
              .concat([k({ id })])
            )

            // Remove this node's (A) presence in other
            // nodes' indexes (NS).
            indexes.forEach((index) => {
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
      ))
    ))
  )

  // Graph return
  return {
    forceCreateEdge,
    forceCreateNode,
    createEdge,
    updateEdge,
    getEdges,
    getEdge,
    getFrom,
    getTo,
    getAll,
    destroyEdge,
    destroyNode
  }
}



export default Graph
