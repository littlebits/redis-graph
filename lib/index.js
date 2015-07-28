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

/* results is given as an array of tuples. First is possible error
and second is the possible value. This function returns a rejected
promise on the first error found or otherwise an array of just the
values. Learn more about this data structure here:

https://github.com/luin/ioredis#pipelining */

let rejectIfMultiResultsError = (results) => {
  let splitResults = results
  .reduce((sr, result) => {
      if (result[0]) sr[0].push(result)
      sr[1].push(result[1])
      return sr
  },
  [[], []])

  return splitResults[0].length ?
    P.reject(splitResults[0][0]) :
    splitResults[1]
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
  let redis = config.db
  let publish = Changefeed(redis, config)

  let failMessage = (type, edge) => (
    type === 1
      ? format('Edge cannot be createStrictd because of unknown publisher "%s" and unknown subscriber "%s".', edge.pid, edge.sid)
    : type === 2
      ? format('Edge cannot be createStrictd because of unknown publisher "%s".', edge.pid)
    : type === 3
      ? format('Edge cannot be createStrictd because of unknown subscriber "%s".', edge.sid)
    : ''
  )

  let assertEdgeNodesExists = (edge) => (
    P.join(
      redis.exists(k({ id: edge.pid })).then(Boolean),
      redis.exists(k({ id: edge.sid })).then(Boolean)
    ).spread(function (from, to) {
        let failCode = !from && !to ? 1 : !from ? 2 : !to ? 3 : null
        if (failCode) {
            let error = new Error(failMessage(failCode, edge))
            error.code = 'REDIS_GRAPH_NO_SUCH_NODE'
            return P.reject(error)
      }
    })
  )

  let endpointCreate = (id) => (
    redis
    .set(k({ id }), id)
    .return(id)
  )

  let getIndexes = (id) => (
    redis
    .multi()
    .smembers(k({ from: id }))
    .smembers(k({ to: id }))
    .exec()
    .then(rejectIfMultiResultsError)
    .then(([fromMe, toMe]) => (
      fromMe
      .map((sid) => ({ type: 'sid', id: sid }))
      .concat(toMe.map((pid) => ({ type: 'pid', id: pid })))
    ))
  )

  let getAllEdges = (id) => (indexes) => {
      let atomic = redis.multi()
      let keys = indexes.map((index) => (
        k(index.type === 'pid'
          ? { from: index.id, to: id }
          : { from: id, to: index.id })
      ))
      // Get each edge's data
      keys.forEach((key) => { atomic.get(key) })
      return atomic.exec()
      .then(rejectIfMultiResultsError)
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

  let createStrict = (spec) => (
    assertEdge(spec),
    assertEdgeNodesExists(spec)
    .then(() => (
      redis
      .multi()
      .set(k(spec), JSON.stringify(spec.data))
      .sadd(k({ from: spec.pid }), spec.sid)
      .sadd(k({ to: spec.sid }), spec.pid)
      .exec()
      .then(rejectIfMultiResultsError)
      .return(spec)
      .tap(publish.createStrictdEdge)
    ))
  )

  let create = (spec) => (
    P.join(
      endpointCreate(spec.pid),
      endpointCreate(spec.sid),
      createStrict(spec)
    )
    .get(2)
  )

  let update = (edgeAfter) => {
    let key = k(edgeAfter)
    return redis
    .exists(key)
    .then((isThere) => (
      !isThere
        ? P.reject(ErrorNoSuchEdge(edgeAfter))
        : redis
        .getset(key, JSON.stringify(edgeAfter.data))
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
  let getBetween = (sid, pid) => {
    let link = typeof sid === 'string'
               ? { sid, pid }
               : sid
    return redis
      .get(k(link))
      .then(validate)

    function validate (edgeData) {
      return !edgeData
             ? P.reject(ErrorNoSuchEdge({ sid, pid }))
             : edgeModel(link.sid, link.pid, JSON.parse(edgeData))
    }
  }

  let assertNodeExists = (id) => (
    redis
    .exists(k({ id }))
    .then(Boolean)
    .then((exists) => (
      exists
        ? null
        : P.reject(ErrorNoSuchNode(id))
    ))
    .return(id)
  )

  let getFrom = (pid) => (
    assertNodeExists(pid)
    .then(() => (
      redis
      .smembers(k({ from: pid }))
      .map((sid) => getBetween({ sid, pid }))
    ))
  )

  let getTo = (sid) => (
    assertNodeExists(sid)
    .then(() => (
      redis
      .smembers(k({ to: sid }))
      .map((pid) => (
        !pid
          ? P.reject(ErrorNoSuchNode(sid))
          : getBetween({ sid, pid })
      ))
    ))
  )

  // Alternative signature: edge -> Promise
  let destroy = (sid, pid) => {
    if (typeof sid === 'object') {
      pid = sid.publisher_id || sid.pid
      sid = sid.subscriber_id || sid.sid
    }
    return getBetween(sid, pid)
    // TODO Use tap here instead of return below?
    .then((edge) => (
      redis
      .multi()
      .del(k({ to: sid, from: pid }))
      .srem(k({ to: sid }), pid)
      .srem(k({ from: pid }), sid)
      .exec()
      .then(rejectIfMultiResultsError)
      .return(edge)
      .tap(publish.destroyedEdge)
    ))
  }

  let getAll = (id) => (
    assertNodeExists(id)
    .then(getIndexes)
    .then(getAllEdges(id))
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
    getBetween(dirs.sid, dirs.pid).then(inArray) :

    getFrom(dirs.pid)
  )

  let endpointDestroy = (id) => (
    assertNodeExists(id)
    .then(getIndexes)
    .then((indexes) => (
      !indexes
        ? P.reject(ErrorNoSuchNode(id))
        : getAllEdges(id)(indexes)
        .tap(() => {
          let atomic = redis
          .multi()
          // Delete this node's indexes
          // and edge descriptions.
          .del(
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

          return atomic
          .exec()
          .then(rejectIfMultiResultsError)
        })
        .tap(publish.destroyedEdges)
    ))
  )

  // Graph API
  return {
    createStrict,
    create,
    getFrom,
    getTo,
    getAll,
    getBetween,
    update,
    destroy,
    endpointDestroy,
    endpointCreate,
    /* Not publicly documented */
    getEdges
  }
}



export default Graph
