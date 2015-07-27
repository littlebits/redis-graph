import R from 'ramda'

// Helpers

let arrayify = (x) => Array.isArray(x) ? x : [x]
let changedModel = (before, after) => ({ before, after })
let createdModel = (after) => changedModel(null, after)
let destroyedModel = (before) => changedModel(before, null)

let Publisher = (db, channelNamespace) => (data) => (
  db.publishAsync(
    `${channelNamespace}:changes`,
    JSON.stringify(arrayify(data))
  )
)



export default (db, config) => {

  let _publish = Publisher(db, config.keyNamespace)

  return {
    createdEdge: R.compose(
      _publish,
      createdModel
    ),

    destroyedEdge: R.compose(
      _publish,
      destroyedModel
    ),

    destroyedEdges: R.compose(
      _publish,
      R.map(destroyedModel)
    ),

    updatedEdge: R.compose(
      _publish,
      (edgeBefore, edgeAfter) => changedModel(edgeBefore, edgeAfter)
    )
  }
}
