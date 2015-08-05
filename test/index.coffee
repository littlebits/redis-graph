P = require 'bluebird'
Graph = require '../lib/index'



describe 'Graph', ->
  graph = mockEdge1 = mockEdge2 = mockEdge3 = mockEdges = undefined

  beforeEach ->
    graph = Graph db: redis
    mockEdge1 = sid:'a', pid:'b', data:foo:'foodata'
    mockEdge2 = sid:'a', pid:'c', data:foo:'zeddata'
    mockEdge3 = sid:'b', pid:'a', data:foo:'bardata'
    mockEdges = [mockEdge1, mockEdge2, mockEdge3]
    @graph = graph
    @mockcreateStrict = (spec) ->
      graph.create spec



  describe '.createStrict()', ->

    it 'creates an edge', ->
      P.delay 100
      .then => @graph.create mockEdge1
      .tap a.eq 'Returns created edge', mockEdge1
      .then a.edge

      a.streamsExactly @changesStream(), [
        [ before: null, after: mockEdge1 ]
      ]

    it 'does not publish change if edge already existed', ->
      P.delay 100
      .then => @graph.create mockEdge1
      .then => @graph.create mockEdge1

      a.streamsExactly @changesStream(), [
        [ before: null, after: mockEdge1 ]
      ]







  describe '.update()', ->

    beforeEach -> @mockcreateStrict mockEdge1

    it 'Mutates edge metadata', ->
      updated = sid:'a', pid:'b', data: 'something-else'
      P.delay 100
      .then => @graph.update updated
      .tap a.eq 'Returns updated edge', updated
      .then a.edge

      a.streamsExactly @changesStream(), [
        [ before: mockEdge1, after: updated ]
      ]

    it 'does not publisher change if new/old edge data were same', ->
      P.delay 100
      .then => @graph.update mockEdge1

      a.streamsNothing @changesStream()




  describe '.getBetween()', ->

    beforeEach -> P.each mockEdges, @mockcreateStrict

    it 'returns an edge', ->
      @graph
      .getBetween mockEdge1
      .then a.eq 'Returns edge', mockEdge1



  describe '.create()', ->

    it 'creates an edge and, if necessary, the endpoints', ->
      @graph.create pid: 'x', sid: 'y', data: {}
      .tap -> a.node 'x'
      .tap -> a.node 'y'



  describe '.endpointCreate()', ->

    it 'creates an anedpoint', ->
      @graph.endpointCreate 'a'
      .tap a.eq 'returns the graph node', 'a'
      .then -> redis.exists 'graph:node:a'
      .then a.eq 'graph node createStrictd', 1



  describe 'possible errors are', ->

    noNodeFnames = [ 'getFrom', 'getTo', 'endpointDestroy', 'getAll' ]

    it 'createStrict requires that the publisher node exists', ->
      @graph.endpointCreate 'b'
      .then -> promiseError graph.createStrict pid: 'a', sid: 'b', data: {}
      .catch (err)->
        a err.message.match /unknown publisher "a"\.$/

    it 'createStrict requires that the subscriber node exists', ->
      @graph.endpointCreate 'a'
      .then => promiseError @graph.createStrict pid: 'a', sid: 'b', data: {}
      .catch (err)-> a err.message.match /unknown subscriber "b"\.$/

    it 'createStrict requires that both publisher/subscriber nodes exist', ->
      promiseError @graph.createStrict pid: 'a', sid: 'b', data: {}
      .catch (err)->
        a err.message.match /unknown publisher "a" .* unknown subscriber "b"\.$/

    it "#{noNodeFnames.join(', ')} all require the node to exist", ->
      methods = F.pick noNodeFnames, @graph
      args = ['foo-id']
      code = 'REDIS_GRAPH_NO_SUCH_ENDPOINT'

      P.all F.toPairs(methods).map (pair)->
        [fname, f] = pair
        promiseError f args...
        .catch (err)-> a.eq "'#{fname}' returns #{code} error", err.code, code

    noEdgeFnames = ['destroy', 'update']

    it "#{noEdgeFnames.join(', ')} all require an edge to exist", ->
      fs = F.pick graph, noEdgeFnames
      args = [ pid: 'foo', sid: 'bar' ]
      code = 'REDIS_GRAPH_NO_SUCH_EDGE'

      P.all F.toPairs(fs).map (pair) ->
        [fname, f] = pair
        promiseError f args...
        .catch (err)-> a.eq "'#{fname}' returns #{code} error", err.code, code



  describe '.getTo()', ->

    beforeEach ->
      @edges = [ mockEdge1, mockEdge2 ]
      P.each @edges, @mockcreateStrict

    it 'returns edges where given id is the subscriber', ->
      @graph.getTo 'a'
      .then a.eqSet 'edges', @edges



  describe '.getFrom()', ->

    beforeEach ->
      @edges = [ mockEdge1, mockEdge2 ]
      P.each @edges, @mockcreateStrict

    it 'returns all subscribers', ->
      @graph.getFrom 'b'
      .then a.eq 'Returns edges', [mockEdge1]



  describe '.getAll()', ->

    it 'returns edges from or to an id', ->
      P.each mockEdges, @mockcreateStrict
      .then -> graph.getAll 'a'
      .then a.eqSet 'edges', mockEdges



  describe '.getEdges', ->
    beforeEach -> P.each mockEdges, @mockcreateStrict

    it 'given {any} is same as .getAll', ->
      P.join @graph.getEdges( any:'a' ), @graph.getAll('a')
      .spread a.eq 'Returns same'

    it 'given ID is same as .getAll', ->
      P.join @graph.getEdges('a'), @graph.getAll('a')
      .spread a.eq 'Returns same'

    it 'given {pid} is same as .getFrom', ->
      P.join @graph.getEdges( pid: 'a' ), @graph.getFrom('a')
      .spread a.eq 'Returns same'

    it 'given {sid} is same as .getTo', ->
      P.join @graph.getEdges( sid: 'a' ), @graph.getTo('a')
      .spread a.eq 'Returns same'

    it 'given {sid, pid} is same as .getBetween except in array', ->
      P.join @graph.getEdges( sid: 'a', pid:'b' ), @graph.getBetween('a', 'b')
      .spread (xs, x)-> a.eq 'Returns same', xs, [x]



  describe '.destroy()', ->

    beforeEach ->
      @graph.create mockEdge1

    it 'removes edge from redis, returns removed edge', ->
      P.delay 100
      .then => @graph.destroy mockEdge1
      .tap a.eq 'Returns destroyed edge.', mockEdge1
      .tap a.noEdge

      a.streamsExactly @changesStream(), [
        [ before: mockEdge1, after: null ]
      ]



  describe '.endpointDestroy()', ->

    beforeEach ->
      P.each mockEdges, @graph.create

    it 'destroys endpoint indexes/edge and ref(s) in other \
    indexes, returns removed edges', ->
      id = 'a'
      changes = mockEdges.map (before) -> before: before, after: null

      P.delay 100
      .then => @graph.endpointDestroy id
      .tap a.eqSet 'edges', mockEdges
      .tap -> a.noNode id
      .each a.noEdge

      @changesStream()
      .during streamTimeout 500
      .reduce F.push, []
      .then F.nth 0
      .then a.eqSet 'changes', changes

    it 'does not publish if nothing was destroyed', ->
      P.join(
        promiseError P.delay(100).then => @graph.endpointDestroy 'foobar'
        .catch () -> # silence
        a.streamsNothing @changesStream()
      )
