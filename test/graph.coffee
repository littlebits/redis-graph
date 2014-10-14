P = require('bluebird')
Graph = require('../lib/index')



describe 'Graph', ->
  graph = mockEdge1 = mockEdge2 = mockEdge3 = mockEdges = undefined
  afterEach -> db.flushdbAsync()
  beforeEach ->
    graph = Graph({ db:db })
    mockEdge1 = {sid:'a', pid:'b', events:'foodata'}
    mockEdge2 = {sid:'a', pid:'c', events:'zeddata'}
    mockEdge3 = {sid:'b', pid:'a', events:'bardata'}
    mockEdges = [mockEdge1, mockEdge2, mockEdge3]



  describe '.createEdge', ->
    it 'creates a subscription', ->
      graph.createEdge mockEdge1
      .tap eq 'Returns created edge', mockEdge1
      .then a.edge



  describe '.getEdge', ->
    beforeEach -> P.each(mockEdges, graph.createEdge)

    it 'returns an edge', ->
      graph
      .getEdge mockEdge1
      .then eq 'Returns edge', mockEdge1



  describe '.getTo', ->

    it 'returns edges where given id is the subscriber', ->
      edges = [mockEdge1, mockEdge2]
      P.each(edges, graph.createEdge)
      .then -> graph.getTo('a')
      .then a.equalSets edges



  describe '.getFrom', ->

    it 'returns all edges from node', ->
      edges = [mockEdge1, mockEdge2]
      P.each(edges, graph.createEdge)
      .then -> graph.getFrom('b')
      .then eq 'Returns edges', [mockEdge1]


  describe '.getAll', ->
    it 'returns edges from or to an id', ->
      P.each(mockEdges, graph.createEdge)
      .then -> graph.getAll('a')
      .then a.equalSets mockEdges



  describe '.getEdges', ->
    beforeEach -> P.each(mockEdges, graph.createEdge)

    it 'given {any} is same as .getAll', ->
      P.join(
        graph.getEdges({ any:'a'}),
        graph.getAll('a'),
        eq 'Returns same'
      )

    it 'given ID is same as .getAll', ->
      P.join(
        graph.getEdges('a'),
        graph.getAll('a'),
        eq 'Returns same'
      )

    it 'given {from} is same as .getFrom', ->
      P.join(
        graph.getEdges({ from: 'a' })
        graph.getFrom('a')
        eq 'Returns same'
      )

    it 'given {to} is same as .getTo', ->
      P.join(
        graph.getEdges({ to: 'a' })
        graph.getTo('a')
        eq 'Returns same'
      )

    it 'given {to,from} is same as .getEdge', ->
      P.join(
        graph.getEdges({ to: 'a', from:'b' })
        graph.getEdge('a', 'b')
        eq 'Returns same'
      )



  describe '.destroyEdge', ->

    it 'removes edge from db, returns removed edge', ->
      graph.createEdge(mockEdge1)
      .then -> graph.destroyEdge(mockEdge1)
      .tap eq 'Returns destroyed edge.', mockEdge1
      .tap a.noEdge



  describe '.destroyNode', ->

    it 'destroys all indexes and edges of a node and removes node refs in other nodes\' indexes', ->
      P.each(mockEdges, graph.createEdge)
      .then -> graph.destroyNode('a')
      .tap a.equalSets mockEdges
      .each(a.noEdge)
