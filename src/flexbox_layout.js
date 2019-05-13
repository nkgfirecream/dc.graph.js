/**
 * `dc_graph.flexbox_layout` lays out nodes in accordance with the
 * {@link https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Flexible_Box_Layout/Basic_Concepts_of_Flexbox flexbox layout algorithm}.
 * Nodes fit into a containment hierarchy based on their keys; edges do not affect the layout but
 * are drawn from node to node.
 *
 * Since the flexbox algorithm is not ordinarily available in SVG, this class uses the
 * {@link https://npmjs.com/package/css-layout css-layout}
 * package. (It does not currently support css-layout's successor
 * {@link https://github.com/facebook/yoga yoga} but that should be straightforward to add if
 * there is interest.)
 *
 * Unlike conventional graph layout, where positions are determined based on a few attributes and
 * the topological structure of the eedges, flexbox layout is determined based on the node hierarchy
 * and a large number of attributes on the nodes. See css-layout's
 * {@link https://npmjs.com/package/css-layout#supported-attributes Supported Attributes}
 * for a list of those attributes, and see below to understand how the hierarchy is inferred from
 * node keys.
 *
 * `flexbox_layout` does not require all internal nodes to be specified. The node keys are parsed as
 * "addresses" or paths (arrays of strings) and the tree is built from those paths. Wherever a
 * node's path terminates is where that node's data will be applied.
 *
 * Since flexbox supports a vast number of attributes, we don't attempt to create accessors for
 * every one. Instead, any attributes in the node data are copied which match the names of flexbox
 * attributes.
 *
 * @class flexbox_layout
 * @memberof dc_graph
 * @param {String} [id=uuid()] - Unique identifier
 * @return {dc_graph.flexbox_layout}
 **/
dc_graph.flexbox_layout = function(id, options) {
    var _layoutId = id || uuid();
    options = options || {algo: 'css-layout'};
    var _dispatch = d3.dispatch('tick', 'start', 'end');

    var _graph, _tree, _nodes = {}, _wnodes;

    function init(options) {
    }
    // like d3.nest but address can be of arbitrary (and different) length
    // probably less efficient too
    function add_node(adhead, adtail, n, tree) {
        tree.address = adhead.slice();
        tree.children = tree.children || {};
        if(!adtail.length) {
            tree.node = n;
            return;
        }
        var t = tree.children[adtail[0]] = tree.children[adtail[0]] || {};
        adhead.push(adtail.shift());
        add_node(adhead, adtail, n, t);
    }
    function all_keys(tree) {
        var key = _engine.addressToKey()(tree.address);
        return Array.prototype.concat.apply([key], Object.keys(tree.children || {}).map(function(k) {
            return all_keys(tree.children[k]);
        }));
    }
    function data(graph, nodes) {
        _graph = graph;
        _tree = {address: [], children: {}};
        nodes.forEach(function(n) {
            var ad = _engine.keyToAddress()(n.dcg_nodeKey);
            add_node([], ad, n, _tree);
        });
        var need = all_keys(_tree);
        _wnodes = nodes;
    }
    function ensure_inner_nodes(tree) {
        if(!tree.node)
            tree.node = {dcg_nodeKey: tree.address.length ? tree.address[tree.address.length-1] : null};
        Object.values(tree.children).forEach(ensure_inner_nodes);
    }
    var yoga_constants = {
        flexDirection: {
            column: yogaLayout.FLEX_DIRECTION_COLUMN,
            row: yogaLayout.FLEX_DIRECTION_ROW
        },
        justifyContent: {
            'space-between': yogaLayout.JUSTIFY_SPACE_BETWEEN,
            'flex-start': yogaLayout.JUSTIFY_FLEX_START,
            'flex-end': yogaLayout.JUSTIFY_FLEX_END
        },
        alignItems: {
            'flex-start': yogaLayout.ALIGN_FLEX_START,
            'flex-end': yogaLayout.ALIGN_FLEX_END
        }
    };
    function set_yoga_attr(flexnode, attr, value) {
        var fname = 'set' + attr.charAt(0).toUpperCase() + attr.slice(1);
        if(typeof flexnode[fname] !== 'function')
            throw new Error('Could not set yoga attr "' + attr + '" (' + fname + ')');
        if(yoga_constants[attr])
            value = yoga_constants[attr][value];
        flexnode['set' + attr.charAt(0).toUpperCase() + attr.slice(1)](value);
    }
    function get_yoga_attr(flexnode, attr) {
        var fname = 'getComputed' + attr.charAt(0).toUpperCase() + attr.slice(1);
        if(typeof flexnode[fname] !== 'function')
            throw new Error('Could not get yoga attr "' + attr + '" (' + fname + ')');
        return flexnode[fname]();
    }
    var internal_attrs = ['sort', 'dcg_nodeKey', 'dcg_nodeParentCluster', 'shape', 'abstract', 'rx', 'ry', 'x', 'y', 'z'],
        skip_on_parents = ['width', 'height'];
    function create_flextree(attrs, tree) {
        var flexnode;
        switch(options.algo) {
        case 'css-layout':
            flexnode = {name: _engine.addressToKey()(tree.address), style: {}};
            break;
        case 'yoga-layout':
            flexnode = yogaLayout.Node.create();
            break;
        }
        var attrs2 = Object.assign({}, attrs);
        var isParent = Object.keys(tree.children).length;
        if(tree.node)
            Object.assign(attrs, tree.node);
        for(var attr in attrs) {
            if(internal_attrs.includes(attr))
                continue;
            if(isParent && skip_on_parents.includes(attr))
                continue;
            var value = attrs[attr];
            if(typeof value === 'function')
                value = value(tree.node);
            switch(options.algo) {
            case 'css-layout':
                flexnode.style[attr] = value;
                break;
            case 'yoga-layout':
                set_yoga_attr(flexnode, attr, value);
                break;
            }
        }
        if(isParent) {
            var children = Object.values(tree.children)
                .sort(attrs.sort)
                .map(function(c) { return c.address[c.address.length-1]; })
                .map(function(key) {
                    return create_flextree(Object.assign({}, attrs2), tree.children[key]);
                });
            switch(options.algo) {
            case 'css-layout':
                flexnode.children = children;
                break;
            case 'yoga-layout':
                children.forEach(function(child, i) {
                    flexnode.insertChild(child, i);
                });
                break;
            }
        }
        tree.flexnode = flexnode;
        return flexnode;
    }
    function apply_layout(offset, tree) {
        var left, top, width, height;
        switch(options.algo) {
        case 'css-layout':
            if(_engine.logStuff())
                console.log(tree.node.dcg_nodeKey + ': '+ JSON.stringify(tree.flexnode.layout));
            left = tree.flexnode.layout.left; width = tree.flexnode.layout.width;
            top = tree.flexnode.layout.top; height = tree.flexnode.layout.height;
            break;
        case 'yoga-layout':
            left = get_yoga_attr(tree.flexnode, 'left'); width = get_yoga_attr(tree.flexnode, 'width');
            top = get_yoga_attr(tree.flexnode, 'top'); height = get_yoga_attr(tree.flexnode, 'height');
            break;
        }
        tree.node.x = offset.x + left + width/2;
        tree.node.y = offset.y + top + height/2;
        Object.keys(tree.children)
            .map(function(key) { return tree.children[key]; })
            .forEach(function(child) {
                apply_layout({x: offset.x + left, y: offset.y + top}, child);
            });
    }
    function dispatchState(wnodes, wedges, event) {
        _dispatch[event](
            wnodes,
            wedges.map(function(e) {
                return {dcg_edgeKey: e.dcg_edgeKey};
            })
        );
    }
    function start() {
        var defaults = {
            sort: function(a, b) {
                return d3.ascending(a.node.dcg_nodeKey, b.node.dcg_nodeKey);
            }
        };
        ensure_inner_nodes(_tree);
        var flexTree = create_flextree(defaults, _tree);
        switch(options.algo) {
        case 'css-layout':
            flexTree.style.width = _graph.width;
            flexTree.style.height = _graph.height;
            break;
        case 'yoga-layout':
            set_yoga_attr(flexTree, 'width', _graph.width);
            set_yoga_attr(flexTree, 'height', _graph.height);
            break;
        }
        if(_engine.logStuff())
            console.log(JSON.stringify(flexTree, null, 2));
        switch(options.algo) {
        case 'css-layout':
            computeLayout(flexTree);
            break;
        case 'yoga-layout':
            flexTree.calculateLayout();
            break;
        }
        apply_layout({x: 0, y: 0}, _tree);
        dispatchState(_wnodes, [], 'end');
    }
    function stop() {
    }

    // currently dc.graph populates the "cola" (really "layout") member with the attributes
    // needed for layout and does not pass in the original data. flexbox has a huge number of attributes
    // and it might be more appropriate for it to look at the original data.
    // (Especially because it also computes some attributes based on data.)
    var supportedAttributes = [
        'width', 'height', // positive number
        'minWidth', 'minHeight', // positive number
        'maxWidth', 'maxHeight', // positive number
        'left', 'right', 'top', 'bottom', // number
        'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', // number
        'padding', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', // positive number
        'borderWidth', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth', // positive number
        'flexDirection', // 'column', 'row'
        'justifyContent', // 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'
        'alignItems', 'alignSelf', // 'flex-start', 'center', 'flex-end', 'stretch'
        'flex', // positive number
        'flexWrap', // 'wrap', 'nowrap'
        'position' // 'relative', 'absolute'
    ];

    var _engine = {
        layoutAlgorithm: function() {
            return 'cola';
        },
        layoutId: function() {
            return _layoutId;
        },
        supportsWebworker: function() {
            return true;
        },
        parent: property(null),
        on: function(event, f) {
            if(arguments.length === 1)
                return _dispatch.on(event);
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
        data: function(graph, nodes) {
            data(graph, nodes);
        },
        start: function() {
            start();
        },
        stop: function() {
            stop();
        },
        optionNames: function() {
            return [];
        },
        populateLayoutNode: function(n1, n) {
            ['sort', 'order'].concat(supportedAttributes).forEach(function(attr) {
                if(n.orig.value[attr])
                    n1[attr] = n.orig.value[attr];
            });
        },
        populateLayoutEdge: function() {},
        /**
         * This function constructs a node key string from an "address". An address is an array of
         * strings identifying the path from the root to the node.
         *
         * By default, it joins the address with commas.
         * @method addressToKey
         * @memberof dc_graph.flexbox_layout
         * @instance
         * @param {Function} [addressToKey = function(ad) { return ad.join(','); }]
         * @return {Function}
         * @return {dc_graph.flexbox_layout}
         **/
        addressToKey: property(function(ad) { return ad.join(','); }),
        /**
         * This function constructs an "address" from a node key string. An address is an array of
         * strings identifying the path from the root to the node.
         *
         * By default, it splits the key by its commas.
         * @method keyToAddress
         * @memberof dc_graph.flexbox_layout
         * @instance
         * @param {Function} [keyToAddress = function(nid) { return nid.split(','); }]
         * @return {Function}
         * @return {dc_graph.flexbox_layout}
         **/
        keyToAddress: property(function(nid) { return nid.split(','); }),
        logStuff: property(false)
    };
    return _engine;
};

dc_graph.flexbox_layout.scripts = ['css-layout.js'];
