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
      graph.createEdge(mockEdge1)
      .then (edge)->
        eq edge, mockEdge1, 'Returns created edge.'
        a.edge edge



  describe '.getEdge', ->
    beforeEach -> P.each(mockEdges, graph.createEdge)

    it 'returns an edge', ->
      graph
        .getEdge({ sid:'a', pid:'b' })
        .then((edge)-> eq edge, mockEdge1)



  describe '.getTo', ->

    it 'returns edges where given id is the subscriber', ->
      edges = [mockEdge1, mockEdge2]
      P.each(edges, graph.createEdge)
      .then -> graph.getTo('a')
      .then (edgesReturned)->
        a.equalSets edgesReturned, edges



  describe '.getFrom', ->

    it 'returns all edges from node', ->
      edges = [mockEdge1, mockEdge2]
      P.each(edges, graph.createEdge)
      graph
        .getFrom('b')
        .then (edges)-> equal edges, [mockEdge1]


  describe '.getAll', ->
    it 'returns edges from or to an id', ->
      P.each(mockEdges, graph.createEdge)
      .then -> graph.getAll('a')
      .then (results)->
        a.equalSets results, mockEdges



  describe '.getEdges', ->
    beforeEach -> P.each(mockEdges, graph.createEdge)

    it 'given {any} is same as .getAll', ->
      P.join(
        graph.getEdges({ any:'a'}),
        graph.getAll('a'),
        eq
      )

    it 'given ID is same as .getAll', ->
      P.join(
        graph.getEdges('a'),
        graph.getAll('a'),
        eq
      )

    it 'given {from} is same as .getFrom', ->
      P.join(
        graph.getEdges({ from: 'a' })
        graph.getFrom('a')
        eq
      )

    it 'given {to} is same as .getTo', ->
      P.join(
        graph.getEdges({ to: 'a' })
        graph.getTo('a')
        eq
      )

    it 'given {to,from} is same as .getEdge', ->
      P.join(
        graph.getEdges({ to: 'a', from:'b' })
        graph.getEdge('a', 'b')
        eq
      )



  describe '.destroyEdge', ->

    it 'removes edge from db, returns removed edge', ->
      graph.createEdge(mockEdge1)
      .then -> graph.destroyEdge({ sid:'a', pid:'b' })
      .then (edge)->
        eq edge, mockEdge1, 'Returns removed edge'
        a.noEdge({ sid:a, pid:'b' })



  describe '.destroyNode', ->

    it 'destroys all indexes and edges of a node and removes node refs in other nodes\' indexes', ->
      P.each(mockEdges, graph.createEdge)
      .then -> graph.destroyNode('a')
      .then (edgesDestroyed)->
        a.equalSets edgesDestroyed, mockEdges, 'Edges were destroyed.'
      .then -> graph.getAll('a')
      .then -> (results)->
        eq results, [], 'No edges related to node "a".'
