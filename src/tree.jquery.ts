import * as $ from "jquery";
import __version__ from "./version";
import * as drag_and_drop_handler from "./drag_and_drop_handler";
import { DragAndDropHandler, DragElement, HitAreasGenerator } from "./drag_and_drop_handler";
import ElementsRenderer from "./elements_renderer";
import KeyHandler from "./key_handler";
import MouseWidget from "./mouse.widget";
import SaveStateHandler from "./save_state_handler";
import ScrollHandler from "./scroll_handler";
import SelectNodeHandler from "./select_node_handler";
import SimpleWidget from "./simple.widget";
import * as node_module from "./node";
import { Node, Position }  from "./node";
import * as util_module from "./util";
import { isFunction } from "./util";
import { BorderDropHint, FolderElement, GhostDropHint, NodeElement } from "./node_element";

class JqTreeWidget extends MouseWidget {
    protected static defaults = {
        autoOpen: false,  // true / false / int (open n levels starting at 0)
        saveState: false,  // true / false / string (cookie name)
        dragAndDrop: false,
        selectable: true,
        useContextMenu: true,
        onCanSelectNode: null,
        onSetStateFromStorage: null,
        onGetStateFromStorage: null,
        onCreateLi: null,
        onIsMoveHandle: null,
        onCanMove: null,  // Can this node be moved? function(node)
        onCanMoveTo: null,  // Can this node be moved to this position? function(moved_node, target_node, position)
        onLoadFailed: null,
        autoEscape: true,
        dataUrl: null,

        // The symbol to use for a closed node - ► BLACK RIGHT-POINTING POINTER
        // http://www.fileformat.info/info/unicode/char/25ba/index.htm
        closedIcon: null,

        // The symbol to use for an open node - ▼ BLACK DOWN-POINTING TRIANGLE
        // http://www.fileformat.info/info/unicode/char/25bc/index.htm
        openedIcon: "&#x25bc;",
        slide: true,  // must display slide animation?
        nodeClass: Node,
        dataFilter: null,
        keyboardSupport: true,
        openFolderDelay: 500,  // The delay for opening a folder during drag and drop; the value is in milliseconds
        rtl: null,  // right-to-left support; true / false (default)
        onDragMove: null,
        onDragStop: null,
        buttonLeft: true,
        onLoading: null
    };

    private element: JQuery;
    private tree: Node;
    private is_initialized: boolean;

    private select_node_handler: SelectNodeHandler|null;
    private dnd_handler: DragAndDropHandler|null;
    private save_state_handler: SaveStateHandler|null;
    private key_handler: KeyHandler|null;
    private scroll_handler: ScrollHandler|null;

    private renderer: ElementsRenderer;

    public toggle(node: Node, slide_param: Function|null = null) {
        let slide;

        if (slide_param == null) {
            slide = this.options.slide;
        } else {
            slide = slide_param;
        }

        if (node.is_open) {
            this.closeNode(node, slide);
        } else {
            this.openNode(node, slide);
        }

        return this.element;
    }

    public getTree(): Node {
        return this.tree;
    }

    public selectNode(node: Node) {
        this._selectNode(node, false);
        return this.element;
    }

    public getSelectedNode(): Node|false {
        if (this.select_node_handler) {
            return this.select_node_handler.getSelectedNode();
        } else {
            return false;
        }
    }

    public toJson() {
        return JSON.stringify(
            this.tree.getData()
        );
    }

    public loadData(data, parent_node: Node|null) {
        this._loadData(data, parent_node);
        return this.element;
    }

    /*
    signatures:
    - loadDataFromUrl(url, parent_node=null, on_finished=null)
        loadDataFromUrl('/my_data');
        loadDataFromUrl('/my_data', node1);
        loadDataFromUrl('/my_data', node1, function() { console.log('finished'); });
        loadDataFromUrl('/my_data', null, function() { console.log('finished'); });

    - loadDataFromUrl(parent_node=null, on_finished=null)
        loadDataFromUrl();
        loadDataFromUrl(node1);
        loadDataFromUrl(null, function() { console.log('finished'); });
        loadDataFromUrl(node1, function() { console.log('finished'); });
    */
    public loadDataFromUrl(param1?, param2?, param3?) {
        if ($.type(param1) === "string") {
            // first parameter is url
            this._loadDataFromUrl(param1, param2, param3);
        } else {
            // first parameter is not url
            this._loadDataFromUrl(null, param1, param2);
        }

        return this.element;
    }

    public reload(on_finished: Function|null) {
        this._loadDataFromUrl(null, null, on_finished);
        return this.element;
    }

    public getNodeById(node_id) {
        return this.tree.getNodeById(node_id);
    }

    public getNodeByName(name: string) {
        return this.tree.getNodeByName(name);
    }

    public getNodesByProperty(key: string, value) {
        return this.tree.getNodesByProperty(key, value);
    }

    public getNodeByHtmlElement(element) {
        return this._getNode($(element));
    }

    public getNodeByCallback(callback: Function) {
        return this.tree.getNodeByCallback(callback);
    }

    public openNode(node: Node, param1, param2?) {
        const parseParams = () => {
            let on_finished;
            let slide;

            if (isFunction(param1)) {
                on_finished = <Function> param1;
                slide = null;
            } else {
                slide = param1;
                on_finished = <Function> param2;
            }

            if (slide == null) {
                slide = this.options.slide;
            }

            return [slide, on_finished];
        };

        const [slide, on_finished] = parseParams();

        if (node) {
            this._openNode(node, slide, on_finished);
        }

        return this.element;
    }

    public closeNode(node: Node, slide_param = null) {
        let slide;

        if (slide_param == null) {
            slide = this.options.slide;
        } else {
            slide = slide_param;
        }

        if (node.isFolder()) {
            new FolderElement(node, this).close(slide);

            this._saveState();
        }

        return this.element;
    }

    public isDragging(): boolean {
        if (this.dnd_handler) {
            return this.dnd_handler.is_dragging;
        } else {
            return false;
        }
    }

    public refreshHitAreas() {
        this.dnd_handler.refresh();
        return this.element;
    }

    public addNodeAfter(new_node_info, existing_node: Node) {
        const new_node = existing_node.addAfter(new_node_info);
        this._refreshElements(existing_node.parent);
        return new_node;
    }

    public addNodeBefore(new_node_info, existing_node: Node) {
        const new_node = existing_node.addBefore(new_node_info);
        this._refreshElements(existing_node.parent);
        return new_node;
    }

    public addParentNode(new_node_info, existing_node: Node) {
        const new_node = existing_node.addParent(new_node_info);
        this._refreshElements(new_node.parent);
        return new_node;
    }

    public removeNode(node: Node) {
        const parent = node.parent;
        if (parent) {
            this.select_node_handler.removeFromSelection(node, true);  // including children

            node.remove();
            this._refreshElements(parent);
        }

        return this.element;
    }

    public appendNode(new_node_info, parent_node_param?: Node) {
        const parent_node = parent_node_param || this.tree;

        const node = parent_node.append(new_node_info);

        this._refreshElements(parent_node);

        return node;
    }

    public prependNode(new_node_info, parent_node_param: Node) {
        let parent_node;

        if (! parent_node_param) {
            parent_node = this.tree;
        } else {
            parent_node = parent_node_param;
        }

        const node = parent_node.prepend(new_node_info);

        this._refreshElements(parent_node);

        return node;
    }

    public updateNode(node: Node, data) {
        const id_is_changed = data.id && data.id !== node.id;

        if (id_is_changed) {
            this.tree.removeNodeFromIndex(node);
        }

        node.setData(data);

        if (id_is_changed) {
            this.tree.addNodeToIndex(node);
        }

        if (typeof data === "object" && data.children) {
            node.removeChildren();

            if (data.children.length) {
                node.loadFromData(data.children);
            }
        }

        this.renderer.renderFromNode(node);
        this._selectCurrentNode();

        return this.element;
    }

    public moveNode(node: Node, target_node: Node, position) {
        const position_index = Position.nameToIndex(position);

        this.tree.moveNode(node, target_node, position_index);
        this._refreshElements();
        return this.element;
    }

    public getStateFromStorage() {
        return this.save_state_handler.getStateFromStorage();
    }

    public addToSelection(node: Node) {
        if (node) {
            this.select_node_handler.addToSelection(node);

            this._getNodeElementForNode(node).select();
            this._saveState();
        }

        return this.element;
    }

    public getSelectedNodes(): Node[] {
        return this.select_node_handler.getSelectedNodes();
    }

    public isNodeSelected(node: Node): boolean {
        return this.select_node_handler.isNodeSelected(node);
    }

    public removeFromSelection(node: Node) {
        this.select_node_handler.removeFromSelection(node);

        this._getNodeElementForNode(node).deselect();
        this._saveState();
        return this.element;
    }

    public scrollToNode(node: Node) {
        const $element = $(node.element);
        const top = $element.offset().top - this.$el.offset().top;

        this.scroll_handler.scrollTo(top);
        return this.element;
    }

    public getState() {
        return this.save_state_handler.getState();
    }

    public setState(state) {
        this.save_state_handler.setInitialState(state);
        this._refreshElements();
        return this.element;
    }

    public setOption(option: string, value) {
        this.options[option] = value;
        return this.element;
    }

    public moveDown() {
        if (this.key_handler) {
            this.key_handler.moveDown();
        }

        return this.element;
    }

    public moveUp() {
        if (this.key_handler) {
            this.key_handler.moveUp();
        }

        return this.element;
    }

    public getVersion() {
        return __version__;
    }

    public testGenerateHitAreas(moving_node: Node) {
        this.dnd_handler.current_item = this._getNodeElementForNode(moving_node);
        this.dnd_handler.generateHitAreas();
        return this.dnd_handler.hit_areas;
    }

    protected _init() {
        super._init();

        this.element = this.$el;
        this.mouse_delay = 300;
        this.is_initialized = false;

        this.options.rtl = this._getRtlOption();

        if (! this.options.closedIcon) {
            this.options.closedIcon = this._getDefaultClosedIcon();
        }

        this.renderer = new ElementsRenderer(this);

        if (SaveStateHandler != null) {
            this.save_state_handler = new SaveStateHandler(this);
        } else {
            this.options.saveState = false;
        }

        if (SelectNodeHandler != null) {
            this.select_node_handler = new SelectNodeHandler(this);
        }

        if (DragAndDropHandler != null) {
            this.dnd_handler = new DragAndDropHandler(this);
        } else {
            this.options.dragAndDrop = false;
        }

        if (ScrollHandler != null) {
            this.scroll_handler = new ScrollHandler(this);
        }

        if (KeyHandler != null && SelectNodeHandler != null) {
            this.key_handler = new KeyHandler(this);
        }

        this._initData();

        this.element.click($.proxy(this._click, this));
        this.element.dblclick($.proxy(this._dblclick, this));

        if (this.options.useContextMenu) {
            this.element.on("contextmenu", $.proxy(this._contextmenu, this));
        }
    }

    protected _deinit() {
        this.element.empty();
        this.element.off();

        if (this.key_handler) {
            this.key_handler.deinit();
        }

        this.tree = null;

        super._deinit();
    }

    protected _mouseCapture(position_info) {
        if (this.options.dragAndDrop) {
            return this.dnd_handler.mouseCapture(position_info);
        } else {
            return false;
        }
    }

    protected _mouseStart(position_info) {
        if (this.options.dragAndDrop) {
            return this.dnd_handler.mouseStart(position_info);
        } else {
            return false;
        }
    }

    protected _mouseDrag(position_info) {
        if (this.options.dragAndDrop) {
            const result = this.dnd_handler.mouseDrag(position_info);

            if (this.scroll_handler) {
                this.scroll_handler.checkScrolling();
            }
            return result;
        } else {
            return false;
        }
    }

    protected _mouseStop(position_info) {
        if (this.options.dragAndDrop) {
            return this.dnd_handler.mouseStop(position_info);
        } else {
            return false;
        }
    }

    private _initData() {
        if (this.options.data) {
            this._loadData(this.options.data);
        } else {
            const data_url = this._getDataUrlInfo();

            if (data_url) {
                this._loadDataFromUrl();
            } else {
                this._loadData([]);
            }
        }
    }

    private _getDataUrlInfo(node?: Node) {
        const data_url = this.options.dataUrl || this.element.data("url");

        const getUrlFromString = () => {
            const url_info = { url: data_url };

            if (node && node.id) {
                // Load on demand of a subtree; add node parameter
                const data = { node: node.id };
                // tslint:disable-next-line: no-string-literal
                url_info["data"] = data;
            } else {
                // Add selected_node parameter
                const selected_node_id = this._getNodeIdToBeSelected();
                if (selected_node_id) {
                    const data = { selected_node: selected_node_id };
                    // tslint:disable-next-line: no-string-literal
                    url_info["data"] = data;
                }
            }

            return url_info;
        };

        if ($.isFunction(data_url)) {
            return data_url(node);
        } else if ($.type(data_url) === "string") {
            return getUrlFromString();
        } else {
            return data_url;
        }
    }

    private _getNodeIdToBeSelected() {
        if (this.options.saveState) {
            return this.save_state_handler.getNodeIdToBeSelected();
        } else {
            return null;
        }
    }

    private _initTree(data) {
        const doInit = () => {
            if (! this.is_initialized) {
                this.is_initialized = true;
                this._triggerEvent("tree.init");
            }
        };

        this.tree = new this.options.nodeClass(null, true, this.options.nodeClass);

        if (this.select_node_handler) {
            this.select_node_handler.clear();
        }

        this.tree.loadFromData(data);

        const must_load_on_demand = this._setInitialState();

        this._refreshElements();

        if (! must_load_on_demand) {
            doInit();
        } else {
            // Load data on demand and then init the tree
            this._setInitialStateOnDemand(doInit);
        }
    }

    // Set initial state, either by restoring the state or auto-opening nodes
    // result: must load nodes on demand?
    private _setInitialState(): boolean {
        const restoreState = () => {
            // result: is state restored, must load on demand?
            if (! (this.options.saveState && this.save_state_handler)) {
                return [false, false];
            } else {
                const state = this.save_state_handler.getStateFromStorage();

                if (! state) {
                    return [false, false];
                } else {
                    const must_load_on_demand = this.save_state_handler.setInitialState(state);

                    // return true: the state is restored
                    return [true, must_load_on_demand];
                }
            }
        };

        const autoOpenNodes = () => {
            // result: must load on demand?
            if (this.options.autoOpen === false) {
                return false;
            }

            const max_level = this._getAutoOpenMaxLevel();
            let must_load_on_demand = false;

            this.tree.iterate(
                (node: Node, level: number) => {
                    if (node.load_on_demand) {
                        must_load_on_demand = true;
                        return false;
                    } else if (! node.hasChildren()) {
                        return false;
                    } else {
                        node.is_open = true;
                        return (level !== max_level);
                    }
                }
            );

            return must_load_on_demand;
        };

        let [is_restored, must_load_on_demand] = restoreState();

        if (! is_restored) {
            must_load_on_demand = autoOpenNodes();
        }

        return must_load_on_demand;
    }

    // Set the initial state for nodes that are loaded on demand
    // Call cb_finished when done
    private _setInitialStateOnDemand(cb_finished: Function) {
        const restoreState = () => {
            if (! (this.options.saveState && this.save_state_handler)) {
                return false;
            } else {
                const state = this.save_state_handler.getStateFromStorage();

                if (! state) {
                    return false;
                } else {
                    this.save_state_handler.setInitialStateOnDemand(state, cb_finished);

                    return true;
                }
            }
        };

        const autoOpenNodes = () => {
            const max_level = this._getAutoOpenMaxLevel();
            let loading_count = 0;

            const loadAndOpenNode = (node: Node) => {
                loading_count += 1;
                this._openNode(
                    node,
                    false,
                    () => {
                        loading_count -= 1;
                        openNodes();
                    }
                );
            };

            const openNodes = () => {
                this.tree.iterate(
                    (node, level) => {
                        if (node.load_on_demand) {
                            if (! node.is_loading) {
                                loadAndOpenNode(node);
                            }

                            return false;
                        } else {
                            this._openNode(node, false);

                            return (level !== max_level);
                        }
                    }
                );

                if (loading_count === 0) {
                    cb_finished();
                }
            };

            openNodes();
        };

        if (! restoreState()) {
            autoOpenNodes();
        }
    }

    private _getAutoOpenMaxLevel(): number {
        if (this.options.autoOpen === true) {
            return -1;
        } else {
            return parseInt(this.options.autoOpen, 10);
        }
    }

    /*
    Redraw the tree or part of the tree.
     from_node: redraw this subtree
    */
    private _refreshElements(from_node?: Node) {
        this.renderer.render(from_node);

        this._triggerEvent("tree.refresh");
    }

    private _click(e) {
        const click_target = this._getClickTarget(e.target);

        if (click_target) {
            if (click_target.type === "button") {
                this.toggle(click_target.node, this.options.slide);

                e.preventDefault();
                e.stopPropagation();
            } else if (click_target.type === "label") {
                const node = click_target.node;
                const event = this._triggerEvent(
                    "tree.click",
                    {
                        node,
                        click_event: e
                    }
               );

                if (! event.isDefaultPrevented()) {
                    this._selectNode(node, true);
                }
            }
        }
    }

    private _dblclick(e) {
        const click_target = this._getClickTarget(e.target);

        if (click_target && click_target.type === "label") {
            this._triggerEvent(
                "tree.dblclick",
                {
                    node: click_target.node,
                    click_event: e
                }
            );
        }
    }

    private _getClickTarget(element) {
        const $target = $(element);

        const $button = $target.closest(".jqtree-toggler");

        if ($button.length) {
            const node = this._getNode($button);

            if (node) {
                return {
                    type: "button",
                    node
                };
            }
        } else {
            const $el = $target.closest(".jqtree-element");
            if ($el.length) {
                const node = this._getNode($el);
                if (node) {
                    return {
                        type: "label",
                        node
                    };
                }
            }
        }
    }

    private _getNode($element) {
        const $li = $element.closest("li.jqtree_common");
        if ($li.length === 0)  {
            return null;
        } else {
            return $li.data("node");
        }
    }

    private _getNodeElementForNode(node: Node) {
        if (node.isFolder()) {
            return new FolderElement(node, this);
        } else {
            return new NodeElement(node, this);
        }
    }

    private _getNodeElement($element) {
        const node = this._getNode($element);
        if (node) {
            return this._getNodeElementForNode(node);
        } else {
            return null;
        }
    }

    private _contextmenu(e) {
        const $div = $(e.target).closest("ul.jqtree-tree .jqtree-element");
        if ($div.length) {
            const node = this._getNode($div);
            if (node) {
                e.preventDefault();
                e.stopPropagation();

                this._triggerEvent(
                    "tree.contextmenu",
                    {
                        node,
                        click_event: e
                    }
                );
                return false;
            }
        }
    }

    private _saveState() {
        if (this.options.saveState) {
            this.save_state_handler.saveState();
        }
    }

    private _triggerEvent(event_name: string, values?) {
        const event = $.Event(event_name);
        $.extend(event, values);

        this.element.trigger(event);
        return event;
    }

    private _selectCurrentNode() {
        const node = this.getSelectedNode();
        if (node) {
            const node_element = this._getNodeElementForNode(node);
            if (node_element) {
                node_element.select();
            }
        }
    }

    private _deselectCurrentNode() {
        const node = this.getSelectedNode();
        if (node) {
            this.removeFromSelection(node);
        }
    }

    private _getDefaultClosedIcon() {
        if (this.options.rtl) {
            // triangle to the left
            return "&#x25c0;";
        } else {
            // triangle to the right
            return "&#x25ba;";
        }
    }

    private _getRtlOption() {
        if (this.options.rtl != null) {
            return this.options.rtl;
        } else {
            const data_rtl = this.element.data("rtl");

            if (data_rtl != null && data_rtl !== false) {
                return true;
            } else {
                return false;
            }
        }
    }

    private _notifyLoading(is_loading: boolean, node: Node, $el) {
        if (this.options.onLoading) {
            this.options.onLoading(is_loading, node, $el);
        }
    }

    private _selectNode(node: Node, must_toggle: boolean= false) {
        if (! this.select_node_handler) {
            return;
        }

        const canSelect = () => {
            if (this.options.onCanSelectNode) {
                return this.options.selectable && this.options.onCanSelectNode(node);
            } else {
                return this.options.selectable;
            }
        };

        const openParents = () => {
            const parent = node.parent;

            if (parent && parent.parent && ! parent.is_open) {
                this.openNode(parent, false);
            }
        };

        const saveState = () => {
            if (this.options.saveState) {
                this.save_state_handler.saveState();
            }
        };

        if (! node) {
            // Called with empty node -> deselect current node
            this._deselectCurrentNode();
            saveState();
            return;
        }

        if (! canSelect()) {
            return;
        }

        if (this.select_node_handler.isNodeSelected(node)) {
            if (must_toggle) {
                this._deselectCurrentNode();
                this._triggerEvent(
                    "tree.select",
                    {
                        node: null,
                        previous_node: node
                    }
                );
            }
        } else {
            const deselected_node = this.getSelectedNode();
            this._deselectCurrentNode();
            this.addToSelection(node);

            this._triggerEvent(
                "tree.select",
                {
                    node,
                    deselected_node
                }
            );
            openParents();
        }

        saveState();
    }

    private _loadData(data, parent_node: Node= null) {
        const deselectNodes = () => {
            if (this.select_node_handler) {
                const selected_nodes_under_parent = this.select_node_handler.getSelectedNodesUnder(parent_node);
                for (let n of selected_nodes_under_parent) {
                    this.select_node_handler.removeFromSelection(n);
                }
            }
        };

        const loadSubtree = () => {
            parent_node.loadFromData(data);

            parent_node.load_on_demand = false;
            parent_node.is_loading = false;

            this._refreshElements(parent_node);
        };

        if (! data) {
            return;
        }

        this._triggerEvent("tree.load_data", { tree_data: data });

        if (! parent_node) {
            this._initTree(data);
        } else {
            deselectNodes();
            loadSubtree();
        }

        if (this.isDragging()) {
            this.dnd_handler.refresh();
        }
    }

    private _loadDataFromUrl(url_info_param?, parent_node?: Node, on_finished?: Function) {
        let $el = null;
        let url_info = url_info_param;

        const addLoadingClass = () => {
            if (parent_node) {
                $el = $(parent_node.element);
            } else {
                $el = this.element;
            }

            $el.addClass("jqtree-loading");
            this._notifyLoading(true, parent_node, $el);
        };

        const removeLoadingClass = () => {
            if ($el) {
                $el.removeClass("jqtree-loading");

                this._notifyLoading(false, parent_node, $el);
            }
        };

        const parseUrlInfo = () => {
            if ($.type(url_info) === "string") {
                return { url: url_info };
            }

            if (! url_info.method) {
                url_info.method = "get";
            }

            return url_info;
        };

        const handeLoadData = data => {
            removeLoadingClass();
            this._loadData(data, parent_node);

            if (on_finished && $.isFunction(on_finished)) {
                on_finished();
            }
        };

        const handleSuccess = response => {
            let data;

            if ($.isArray(response) || typeof response === "object") {
                data = response;
            } else if (data != null) {
                data = $.parseJSON(response);
            } else {
                data = [];
            }

            if (this.options.dataFilter) {
                data = this.options.dataFilter(data);
            }

            handeLoadData(data);
        };

        const handleError = response => {
            removeLoadingClass();

            if (this.options.onLoadFailed) {
                this.options.onLoadFailed(response);
            }
        };

        const loadDataFromUrlInfo = () => {
            const _url_info = parseUrlInfo();

            $.ajax(
                $.extend(
                    {},
                    _url_info,
                    {
                        method: url_info.method != null ? url_info.method.toUpperCase() : "GET",
                        cache: false,
                        dataType: "json",
                        success: handleSuccess,
                        error: handleError
                    }
                )
            );
        };

        if (! url_info_param) {
            // Generate url for node
            url_info = this._getDataUrlInfo(parent_node);
        }

        addLoadingClass();

        if (! url_info) {
            removeLoadingClass();
            return;
        } else if ($.isArray(url_info)) {
            handeLoadData(url_info);
            return;
        } else {
            loadDataFromUrlInfo();
            return;
        }
    }

    private _openNode(node: Node, slide: boolean = true, on_finished?: Function) {
        const doOpenNode = (_node: Node, _slide, _on_finished?: Function) => {
            const folder_element = new FolderElement(_node, this);
            folder_element.open(_on_finished, _slide);
        };

        if (node.isFolder()) {
            if (node.load_on_demand) {
                this._loadFolderOnDemand(node, slide, on_finished);
            } else {
                let parent = node.parent;

                while (parent) {
                    // nb: do not open root element
                    if (parent.parent) {
                        doOpenNode(parent, false, null);
                    }
                    parent = parent.parent;
                }

                doOpenNode(node, slide, on_finished);
                this._saveState();
            }
        }
    }

    private _loadFolderOnDemand(node: Node, slide: boolean = true, on_finished?: Function) {
        node.is_loading = true;

        this._loadDataFromUrl(
            null,
            node,
            () => {
                this._openNode(node, slide, on_finished);
            }
        );
    }
}

SimpleWidget.register(JqTreeWidget, "tree");