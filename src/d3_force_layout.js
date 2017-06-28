/**
 * `dc_graph.cola_layout` is an adaptor for cola.js layouts in dc.graph.js
 * @class cola_layout
 * @memberof dc_graph
 * @param {String} [id=uuid()] - Unique identifier
 * @return {dc_graph.cola_layout}
 **/
dc_graph.d3_force_layout = function(id) {
    var _layoutId = id || uuid();
    var _simulation = null; // d3-force simulation
    var _dispatch = d3.dispatch('tick', 'start', 'end');
    var relayoutPathFlag = false;
    // node and edge objects shared with cola.js, preserved from one iteration
    // to the next (as long as the object is still in the layout)
    var _nodes = {}, _edges = {};

    function init(options) {
        _simulation = d3.layout.force()
            .size([options.width, options.height])
            .gravity(1.0)
            .charge(-300);
    }

    function data(nodes, edges, constraints, options) {
        var nodeIDs = {};
        nodes.forEach(function(d, i) {
            nodeIDs[d.dcg_nodeKey] = i;
        });

        var wnodes = regenerate_objects(_nodes, nodes, function(v) {
            return v.dcg_nodeKey;
        }, function(v1, v) {
            v1.dcg_nodeKey = v.dcg_nodeKey;
            v1.width = v.width;
            v1.height = v.height;
            v1.id = v.dcg_nodeKey;
        });


        var wedges = regenerate_objects(_edges, edges, function(e) {
            return e.dcg_edgeKey;
        }, function(e1, e) {
            e1.dcg_edgeKey = e.dcg_edgeKey;
            // cola edges can work with indices or with object references
            // but it will replace indices with object references
            e1.source = _nodes[e.dcg_edgeSource];
            e1.source.id = nodeIDs[e1.source.dcg_nodeKey];
            e1.target = _nodes[e.dcg_edgeTarget];
            e1.target.id = nodeIDs[e1.target.dcg_nodeKey];
            e1.dcg_edgeLength = e.dcg_edgeLength;
        });

        function dispatchState(event) {
            _dispatch[event](
                wnodes,
                wedges.map(function(e) {
                    return {dcg_edgeKey: e.dcg_edgeKey};
                })
            );
        }
        _simulation.on('tick', /* _tick = */ function() {
            if(relayoutPathFlag) {
                applyRelayoutPathForces(wnodes, wedges);
            }
            dispatchState('tick');
        }).on('start', function() {
            _dispatch.start();
        }).on('end', /* _done = */ function() {
            dispatchState('end');
        });

        _simulation.nodes(wnodes);
        _simulation.links(wedges);
    }

    function start(options) {
        runSimulation();
    }

    function stop() {
        _simulation.stop();
    }

    function relayoutPath(nop, eop) {
        relayoutPathFlag = true;
        runSimulation();
        relayoutPathFlag = false;
    };

    function runSimulation() {
        _simulation.start();
        for (var i = 0; i < 300; ++i) {
            _simulation.tick();
        }
        _simulation.stop();
    }

    var graphviz = dc_graph.graphviz_attrs(), graphviz_keys = Object.keys(graphviz);

    var engine = Object.assign(graphviz, {
        layoutAlgorithm: function() {
            return 'd3-force';
        },
        layoutId: function() {
            return _layoutId;
        },
        parent: property(null),
        on: function(event, f) {
            _dispatch.on(event, f);
            return this;
        },
        init: function(options) {
            this.optionNames().forEach(function(option) {
                options[option] = options[option] || this[option]();
            }.bind(this));
            init(options);
            return this;
        },
        data: function(nodes, edges, constraints, options) {
            data(nodes, edges, constraints, options);
        },
        start: function(options) {
            start(options);
        },
        stop: function() {
            stop();
        },
        relayoutPath: function(nop, eop) {
            relayoutPath(nop, eop);
        },
        optionNames: function() {
            return ['lengthStrategy', 'baseLength']
                .concat(graphviz_keys);
        },
        lengthStrategy: property('symmetric'),
        baseLength: property(30),
        populateLayoutNode: function() {},
        populateLayoutEdge: function() {},
    });
    return engine;

    function applyRelayoutPathForces(wnodes, wedges) {
        wnodes.forEach(collide(wnodes, 0.5));
    }

    // Resolve collisions between nodes.
    function collide(nodes, alpha) {
        var quadtree = d3.geom.quadtree(nodes);
        var padding = 6;
        return function(d) {
            var r = d.radius + padding,
                nx1 = d.x - r,
                nx2 = d.x + r,
                ny1 = d.y - r,
                ny2 = d.y + r;
            quadtree.visit(function(quad, x1, y1, x2, y2) {
                if (quad.point && (quad.point !== d)) {
                    var x = d.x - quad.point.x,
                        y = d.y - quad.point.y,
                        l = Math.sqrt(x * x + y * y),
                        r = d.radius + quad.point.radius + (d.color !== quad.point.color) * padding;
                    if (l < r) {
                        l = (l - r) / l * alpha;
                        d.x -= x *= l;
                        d.y -= y *= l;
                        quad.point.x += x;
                        quad.point.y += y;
                    }
                }
                return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
            });
        };
    }

};

dc_graph.d3_force_layout.scripts = ['d3.js'];
