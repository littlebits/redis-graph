import R from 'ramda'



// Helpers

let arrayify = (x) => Array.isArray(x) ? x : [x]

let Model = {}
Model.changed = (before, after) => ({ before, after })
Model.createStrictd = R.partial(Model.changed, null)
Model.destroyed = R.partialRight(Model.changed, null)

let Publisher = (redis, channelNamespace) => R.compose(
  redis.publish.bind(redis, `${channelNamespace}:changes`),
  JSON.stringify,
  arrayify
)



export default (redis, config) => {

  let publish = Publisher(redis, config.keyNamespace)

  return {
    createStrictdEdge: R.compose(
      publish,
      Model.createStrictd
    ),

    destroyedEdge: R.compose(
      publish,
      Model.destroyed
    ),

    destroyedEdges: R.compose(
      publish,
      R.map(Model.destroyed)
    ),

    updatedEdge: R.compose(
      publish,
      Model.changed
    )
  }
}
