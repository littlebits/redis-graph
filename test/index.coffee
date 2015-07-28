P = require 'bluebird'
Graph = require '../lib/index'



describe 'Graph', ->
  graph = mockEdge1 = mockEdge2 = mockEdge3 = mockEdges = undefined

  afterEach ->
    redis.flushdb()

  beforeEach ->
    graph = Graph db: redis
    mockEdge1 = sid:'a', pid:'b', data:foo:'foodata'
    mockEdge2 = sid:'a', pid:'c', data:foo:'zeddata'
    mockEdge3 = sid:'b', pid:'a', data:foo:'bardata'
    mockEdges = [mockEdge1, mockEdge2, mockEdge3]
    @mockcreateStrict = (spec)->
      graph.create spec



  describe '.createStrict', ->

    it 'createStricts a subscription', ->
      creation = @mockcreateStrict mockEdge1
      .tap eq 'Returns createStrictd edge', mockEdge1
      .then a.edge

      P.join creation, a.publishes([before:null, after:mockEdge1])



  describe '.update', ->
    beforeEach -> @mockcreateStrict mockEdge1

    it 'Mutates the metadata of an edge', ->
      edge1_ = {sid:'a', pid:'b', data:'something-else'}
      updates = graph
      .update edge1_
      .tap eq 'Returns updated edge', edge1_
      .then a.edge
      P.join updates, a.publishes([before:mockEdge1, after:edge1_])



  describe '.getBetween', ->
    beforeEach -> P.each mockEdges, @mockcreateStrict

    it 'returns an edge', ->
      graph
      .getBetween mockEdge1
      .then eq 'Returns edge', mockEdge1



  describe 'create', ->

    it 'createStricts an edge and if necessary the nodes', ->
      graph.create pid: 'x', sid: 'y', data: {}
      .tap -> a.node 'x'
      .tap -> a.node 'y'



  describe 'endpointCreate', ->

    it 'createStricts a graph node', ->
      graph.endpointCreate 'a'
      .tap eq 'returns the graph node', 'a'
      .then -> redis.exists 'graph:node:a'
      .then eq 'graph node createStrictd', 1



  describe 'possible errors are', ->

    noNodeFnames = ['getFrom', 'getTo', 'endpointDestroy', 'getAll']

    it 'createStrict requires that the publisher node exists', ->
      graph.endpointCreate 'b'
      .then -> promiseError graph.createStrict pid: 'a', sid: 'b', data: {}
      .catch (err)->
        a err.message.match /unknown publisher "a"\.$/

    it 'createStrict requires that the subscriber node exists', ->
      graph.endpointCreate 'a'
      .then -> promiseError graph.createStrict pid: 'a', sid: 'b', data: {}
      .catch (err)-> a err.message.match /unknown subscriber "b"\.$/

    it 'createStrict requires that both publisher/subscriber nodes exist', ->
      promiseError graph.createStrict pid: 'a', sid: 'b', data: {}
      .catch (err)-> a err.message.match /unknown publisher "a" .* unknown subscriber "b"\.$/

    it "#{noNodeFnames.join(', ')} all require the node to exist", ->
      methods = lo.pick graph, noNodeFnames
      args = ['foo-id']
      code = 'REDIS_GRAPH_NO_SUCH_NODE'

      Promise.all lo.map methods, (method, name)->
        promiseError method args...
        .catch (err)-> eq "'#{name}' returns #{code} error", err.code, code

    noEdgeFnames = ['destroy', 'update']

    it "#{noEdgeFnames.join(', ')} all require an edge to exist", ->
      fs = lo.pick graph, noEdgeFnames
      args = [pid: 'foo', sid: 'bar']
      code = 'REDIS_GRAPH_NO_SUCH_EDGE'

      Promise.all lo.map fs, (method, name)->
        promiseError method args...
        .catch (err)-> eq "'#{name}' returns #{code} error", err.code, code



  describe '.getTo', ->
    beforeEach ->
      @edges = [mockEdge1, mockEdge2]
      P.each @edges, @mockcreateStrict

    it 'returns edges where given id is the subscriber', ->
      graph.getTo 'a'
      .then a.equalSets @edges



  describe '.getFrom', ->
    beforeEach ->
      @edges = [mockEdge1, mockEdge2]
      P.each @edges, @mockcreateStrict

    it 'returns all edges from node', ->
      graph.getFrom 'b'
      .then eq 'Returns edges', [mockEdge1]



  describe '.getAll', ->

    it 'returns edges from or to an id', ->
      P.each mockEdges, @mockcreateStrict
      .then -> graph.getAll 'a'
      .then a.equalSets mockEdges



  describe '.getEdges', ->
    beforeEach -> P.each mockEdges, @mockcreateStrict

    it 'given {any} is same as .getAll', ->
      P.join graph.getEdges({ any:'a'}), graph.getAll('a')
      .spread eq 'Returns same'

    it 'given ID is same as .getAll', ->
      P.join graph.getEdges('a'), graph.getAll('a')
      .spread eq 'Returns same'

    it 'given {pid} is same as .getFrom', ->
      P.join graph.getEdges({ pid: 'a' }), graph.getFrom('a')
      .spread eq 'Returns same'

    it 'given {sid} is same as .getTo', ->
      P.join graph.getEdges({ sid: 'a' }), graph.getTo('a')
      .spread eq 'Returns same'

    it 'given {sid, pid} is same as .getBetween except in array', ->
      P.join graph.getEdges({ sid: 'a', pid:'b' }), graph.getBetween('a', 'b')
      .spread (xs, x)-> eq 'Returns same', xs, [x]



  describe '.destroy', ->

    it 'removes edge from redis, returns removed edge', ->
      destroying = graph.create(mockEdge1)
      .then -> graph.destroy(mockEdge1)
      .tap eq 'Returns destroyed edge.', mockEdge1
      .tap a.noEdge
      P.join destroying, a.publishes([ before: mockEdge1, after:null ])



  describe '.endpointDestroy', ->

    it 'destroys all indexes and edges of a node and removes node refs in other nodes\' indexes, returns removed edges', ->
      id = 'a'
      destroying = P.each mockEdges, @mockcreateStrict
      .then -> graph.endpointDestroy id
      .tap a.equalSets mockEdges
      .tap -> a.noNode id
      .each a.noEdge

      P.join destroying, a.publishes(mockEdges.map((before)-> before:before, after:null ))
