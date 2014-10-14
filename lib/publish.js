module.exports = function(db){

  function createdEdge(edgeAfter){
    return _publish(createdModel(edgeAfter))
  }

  function destroyedEdge(edgeBefore){
    return _publish(destroyedModel(edgeBefore))
  }

  function destroyedEdges(edgesBefore){
    return _publish(edgesBefore.map(destroyedModel))
  }

  function updatedEdge(edgeBefore, edgeAfter){
    return _publish(changedModel(edgeBefore, edgeAfter))
  }

  function _publish(data){
    return db.publishAsync('rsg:changes', JSON.stringify(arrayify(data)))
  }

  return {
    destroyedEdges: destroyedEdges,
    destroyedEdge: destroyedEdge,
    createdEdge: createdEdge,
    updatedEdge: updatedEdge
  }
}



// Helpers

function arrayify(x){
  return Array.isArray(x) ? x : [x]
}

function createdModel(after){
  return changedModel(null, after)
}
function destroyedModel(before){
  return changedModel(before, null)
}
function changedModel(before, after){
  return { before:before, after:after }
}
