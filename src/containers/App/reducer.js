import _ from 'underscore';

import { collections, queries, filters, prefs_merge, prefs_createInitial } from '../../utils';
import {
  UPDATE_CURRENT_TAB,
  UPDATE_VIEW_PROPS,
  FILTER_CHANGE,
  UPDATE_ITEMS,
  ON_APP_INIT,
  RESET_FILTERS,
  UPDATE_SEARCH_INPUT,
  UPDATE_PAGINATION,
  UPDATE_WORKSPACE,
  CONTROL_MODAL,
  LIST_SETTINGS_LS_KEY
} from './constants';

//@todo find a better place to inject this
//import config from '../../dataListConfig';

let visitor = {};

/**
 * Buffer for the request handler
 * @type {boolean}
 */
var config = {
  defaultView: '',
  views: [
    {
      id: '',
      paginationTake: 0

    }
  ]
};

const initialState = {
  config,
  views: [],
  preferences: [],// {view:'catalog': data: {props:[]} Get's potentially populated in the onInit hook or anywhere else. Keys are dot notation
  overridePreferences: {
    props: false
  },
  selectedView: {},//Must be an empty object by default
  queryString: '',// the current query string based on filter value
  queryObject: {},
  sortBy: '',// a sortBy Value,.
  filters: [],// Contains all applied filters
  pagination: {
    skip: 0,
    take: 25,
    page: 1,
    total: 0
  },
  dataSources: {},
  Items: [],
  workspace: {
    checkedItems: [],
    actions: null,
    item: {},
    selectAllChecked: false
  },
  showLoading: false,
  modal: {
    show: false,
    Component: false
  }
};

function appReducer(state = initialState, action) {
  let _state = Object.assign({}, state),
    _data = action.data;    

  switch (action.type) {

    case ON_APP_INIT:

      /**
       * NOTE: INIT sets up the state object.
       * It gets called multiple times from multiple places in order to
       * build the state objects data conditionally
       */
      if (_data.hasOwnProperty('config')) {
        config = _data.config;
        _state.config = _data.config;

        if (config.hasOwnProperty('googleAnalyticsUAId') && config.googleAnalyticsUAId) {
          // visitor = ua(config.googleAnalyticsUAId);
        }

        // Set pagination options
        _state.pagination = {
          skip: 0,
          take: (config.views.filter(view => {
            const viewQueryParam = queries.getViewParamFromURL();// Get the view from the url or from the set default if not defined
            return viewQueryParam ? view.id === viewQueryParam : (view.id === config.defaultView || true);// falls back to any view in case the default wasn't set
          })[0] || {}).paginationTake || 25, 
          page: 1,
          total: 0
        };

        //Set the selected view
        _state.selectedView = Object.assign(
          {},
          _data.config.views.filter(view => {
            const viewQueryParam = queries.getViewParamFromURL();// Get the view from the url or from the set default if not defined
            return viewQueryParam ? view.id === viewQueryParam : (view.id === _data.config.defaultView || true);// falls back to any view in case the default wasn't set
          })[0],
          { addons: [] }
        );

        _state.views = _data.config.views;
      }

      if (_data.hasOwnProperty('pagination')) {
        _data.pagination.take = _state.selectedView.paginationTake;
        _state.pagination = _data.pagination;
      }

      // Get the initial query string and object
      if (_data.hasOwnProperty('queryString')) {
        _state.queryString = _data.queryString;
      } else if (_data.hasOwnProperty('queryObject')) {
        _state.queryObject = _data.queryObject;
      }

      /**
      * Allow for a synchronous fetch of preferences. Does not support async at this stage
      */
      if (_state.selectedView.persistListSettings) {
        let prefs;
        try { prefs = JSON.parse(localStorage.getItem(LIST_SETTINGS_LS_KEY)); }catch(e){} 
        
        if(prefs){
          _state.preferences = prefs;
          _state = applyPreferences(_state);
          _state.selectedView.paginationTake = prefs.paginationTake || _state.selectedView.paginationTake;
        } 
      } else {
        _state.preferences = [];
        _state = applyPreferences(_state);
      }

      _state.showLoading = true;
      _state.Items = [];

      /**
      * Allow injection of preferences for use throughout the app
      */
      if (_data.hasOwnProperty('preferences')) {
        _state.preferences = _data.preferences;
        _state = applyPreferences(_state);
      }

      // HOOK @todo should allow returning new state from hook
      if (_state.config && _state.config.hooks && _state.config.hooks.onStateUpdate) { 
        _state.config.hooks.onStateUpdate(_state);
      }

      return _state;

    case UPDATE_CURRENT_TAB: 
      _data = _data || _state.selectedView.id;
      queries.clearURLQueryString();
      
      _state.selectedView = _state.views.filter(view => {
        return view.id === _data;
      })[0];
      _state.selectedView.addons = [];
      _state.views = makeViews(_state, { view: _data, id: '*', value: null });
      _state.queryString = null;
      _state.queryObject = {};
      _state.force = Math.random() * 10000000;
      _state = Object.assign({}, _state, makeQuery(_state, _state.selectedView.addons));
      _state.showLoading = true;
      _state.pagination = {
        skip: 0,
        take: _state.selectedView.paginationTake,
        page: 1,
        total: 0
      };
      _state.Items = [];

      // Clear sorting
      //@todo make sort readable in url. Right now sort get resets on load and is not linkable. Not enough time to program it.
      [...document.getElementsByClassName('dl__listHeader--sort')].forEach(node => {
        node.classList.remove('dl__listHeader--sort--desc');
      });

      runFilters(_state, _state.selectedView);

    /**
    * Allow for a synchronous fetch of preferences. Does not support async at this stage
    */
    if (_state.selectedView.persistListSettings) {
      let columnPrefs;
      try { columnPrefs = JSON.parse(localStorage.getItem(LIST_SETTINGS_LS_KEY)); }catch(e){} 
      
      if(columnPrefs){
        _state.preferences = columnPrefs;
        _state = applyPreferences(_state);
      }
    }
    
      _state.config.hooks.onStateUpdate(_state, action.type);

      return _state;

    case UPDATE_ITEMS:
      _state.Items = _data.Items;
      _state.pagination.total = _data.count;
      _state.force = Math.random() * 10000000;
      _state.showLoading = false;
      _state.config.hooks.onStateUpdate(_state);
      return _state;

    case UPDATE_VIEW_PROPS:

      // 1. find the prop in our current view props
      // 2. set the prop.display to the checked val true/false
      // 3. force a render down the tree
      _state.selectedView.props = _state.selectedView.props
        .map(prop => {
          if (prop.key === _data.prop) {
            prop.display = _data.checked;
          }

          return prop;
        });

      /**
       * Important for forcing a rerender when mutating nested state. Redux won't see nested changes.
       * Make sure to include force in the mapStateToProps in the component to force the rerender
       * @type {number}
       */
      _state.force = Math.random() * 10000000;
      _state.config.hooks.onStateUpdate(_state);

      // Run the on Update hook
      if (_state.config.hooks.onViewPropChange) {
        _state.config.hooks.onViewPropChange({
          prop: _data.prop,
          checked: _data.checked,
          viewId: _data.viewId,
          selectedView: _state.selectedView
        });
      }

      // Handle updating internal storage of column settings
      if (_state.selectedView.persistListSettings) {
        let columnPrefs;
        try { columnPrefs = JSON.parse(localStorage.getItem(LIST_SETTINGS_LS_KEY)); } catch (e) {}

        const mutatedPrefs = columnPrefs
          ? prefs_merge(columnPrefs)(_data.prop, _data.checked, _data.viewId)
          : prefs_createInitial(_state.selectedView)(_data.prop, _data.checked);


        localStorage.setItem(LIST_SETTINGS_LS_KEY, JSON.stringify(mutatedPrefs));
      }

      // Override preferences because the user indicated they wanted to change the default/preferenced set of visible props
      // _state.overridePreferences.props = true;

      return _state;

    case FILTER_CHANGE:
      const isBatchUpdate = _.isArray(_data);

      // Only clear on fresh filter runs, not paginated filter runs
      // Compare the pagination and filters in the current state with the incoming request to determine 
      // if this should be flagged as a fresh filter run. If fresh, reset pagination
      let isFirstPageLoad = false;
      const currentSetFilters = _state
        .selectedView
        .filterGroups
        .reduce((sum, filterGroup) => {
          if (!!filterGroup.filters) {
            return sum
              .concat(filterGroup.filters
                .filter(fltr => fltr.value !== null ? fltr.id : false)
                .map(fltr => fltr.id)
              );
          }
        }, []);

      const currentFilterId = isBatchUpdate
        ? _data.reduce((sum, filter) => sum.concat(filter.id), [])
        : [_data.id];

      const isNewFilterRun = currentSetFilters.length !== currentFilterId.length;

      var firstTime = localStorage.getItem("first_load");
      if (!firstTime) {
        localStorage.setItem("first_load", "1");
        isFirstPageLoad = true;
      }

      if (!isFirstPageLoad && isNewFilterRun) {
        _state.pagination = {
          skip: 0,
          take: _state.selectedView.paginationTake || 100,
          page: 1,
          total: 0
        };

        _state.selectedView.clearPaginationQueryString = true;// Fresh request. No need for pagination to linger
      }

      /**
       * Batch updating is possible to minimize rerenders down the tree
       * Used by the runQueryStringURLOnRender initialization in App/index.js
       */
      if (isBatchUpdate) {
        
        _data.forEach(filterChange => {
          //[{id,view,value}]
          _state.views = makeViews(_state, filterChange);

          // Add the search filter as a filter addon
          if (filterChange.id === 'search' || filterChange.id.indexOf('sort-') > -1) {
            _state.selectedView.addons = collections.replaceItem(_state.selectedView.addons, filterChange, 'id');
          }
        });
      } else {
        // FIll in the current view. Used mainly by the doSort action in App/index.js initDoSort
        if (!_data.hasOwnProperty('view')) {
          _data.view = _state.selectedView.id;
        }
        //id,view,value
        _state.views = makeViews(_state, _data);

        // Add the search filter as a filter addon
        if (_data.id === 'search' || _data.id.indexOf('sort-') > -1) {
          _state.selectedView.addons = collections.replaceItem(_state.selectedView.addons, _data, 'id');
        }
      }

      _state.queryObject = {};
      _state.Items = [];

      _state = Object.assign({}, _state, makeQuery(_state, _state.selectedView.addons));
      runFilters(_state, _state.selectedView);

      // CLEAR the Workspace
      _state.workspace = {
        checkedItems: [],
        actions: null,
        item: {},
        selectAllChecked: false
      };

      _state.showLoading = true;
      _state.force = Math.random() * 10000000;
      _state.config.hooks.onStateUpdate(_state);

      return _state;

    case RESET_FILTERS:

      _state.views = makeViews(_state, { view: _state.selectedView.id, id: '*', value: null });
      _state.showLoading = true;
      _state.Items = [];
      _state.force = Math.random() * 10000000;
      //@todo need to run through items in addons and set their values to null

      //Clear the search addon value
      _state.selectedView.addons = _state.selectedView.addons
        .map(addon => addon.id == 'search'
          ? { ...addon, ...{ value: null } }
          : addon
        );

      // Clear sorting
      //@todo make sort readable in url. Right now sort get resets on load and is not linkable. Not enough time to program it.
      [...document.getElementsByClassName('dl__listHeader--sort')].forEach(node => {
        node.classList.remove('dl__listHeader--sort--desc');
      });

      _state = Object.assign({}, _state, makeQuery(_state, _state.selectedView.addons));

      runFilters(_state, _state.selectedView);
      
      // CLEAR the Workspace
      _state.workspace = {
        checkedItems: [],
        actions: null,
        item: {},
        selectAllChecked: false
      };

      _state.config.hooks.onStateUpdate(_state);

      return _state;

    case UPDATE_SEARCH_INPUT:

      _state.selectedView.addons = collections.replaceItem(_state.selectedView.addons, _data, 'id');
      _state = Object.assign({}, _state, makeQuery(_state, [_data]));//update the queryObject and queryString

      _state.forceSearch = Math.random() * 10000000;
      _state.config.hooks.onStateUpdate(_state);

      return _state;

    case UPDATE_PAGINATION:
      _state.pagination = _data.pagination;

      // If the user changed the default take number, set it
      if ((_state.selectedView.paginationTake !== _data.pagination.take)) {
        
        _state.selectedView.paginationTake = _data.pagination.take;

        _state.views = _state.views.map(view => {
          if (view.id === _state.selectedView.id) {
            view.paginationTake = _data.pagination.take;
          } 

          return view;
        })
      }

      _state.config.hooks.onStateUpdate(_state);

      return _state;

    case UPDATE_WORKSPACE:
      switch (_data.workspaceAction) {
        case 'add':
        case 'update':
          _state.workspace = {
            checkedItems: collections.replaceItem(_state.workspace.checkedItems, _data.Item, _state.selectedView.itemIdProp),
              action: _data.workspaceAction,
              item: _data.Item,
              selectAllChecked: _data.selectAllChecked
          }

          if(_state.config.hooks.onCheck) {
              _state.config.hooks.onCheck(_state.workspace);
          }
          break;
        case 'remove':

            _state.workspace = {
                checkedItems: collections.removeItem(_state.workspace.checkedItems, _data.Item, _state.selectedView.itemIdProp),
                action: _data.workspaceAction,
                item: _data.Item,
                selectAllChecked: _data.selectAllChecked
            }

            if(_state.config.hooks.onUnCheck) {
                _state.config.hooks.onUnCheck(_state.workspace);
            }
          break;
      }
      _state.config.hooks.onStateUpdate(_state);

      return _state;

      case CONTROL_MODAL: 
        _state.modal = {
          show: _data.show,
          Component: _data.Component
        }
        
        return _state;

    default:
      return _state;
  }
}

export default appReducer;

/**
 * Interceptor for adding props to the state object
 */
function makeQuery(_state, addons = []) {
  const pseudoFilters = [
    ...addons,
    {
      id: 'view',
      value: _state.selectedView.id,
      view: _state.selectedView.id
    }
  ];
    // Create a new array of all the filters from the current view, excluding null or undefined values
    const filters = _.chain(_state.selectedView.filterGroups
      .map(group => group.filters))
      .flatten()
      .map(filter => {
        return (typeof filter.value !== 'undefined' || (filter.range && (filter.range.start !== null || filter.range.end !== null))) ? filter : false;
      })
      .compact()
      .value();

    const queryObject = Object.assign({}, _state.queryObject, queries.makeQueryObject(filters.concat(pseudoFilters)));

  return {
    queryObject: _.omit(queryObject, (v, k) => v === null),// Clean it after we've updated the query string
    queryString: queries.makeQueryString(queryObject)
  };
}

/**
 * Hook for running common actions after state modification and before return
 * This is where filters xhr requests get called from when something changes
 * @param _state
 * @param options
 */
function runFilters(_state, options) {
  queries.writeQueryStringToURL(_state.queryString, options);
  filters.run(_state, options);// The response calls a render method that handles where we render to utils/filter._render
}


/**
 * Displays the filters' loading icon
 */
function showLoadingIcon() {
  $('#filterSort__loading').addClass('filterSort__loading--show');

  setTimeout(function () {
    hideLoadingIcon();
  }, 1000);
}

/**
 * Hides the filters' loading icon
 */
function hideLoadingIcon() {
  $('#filterSort__loading').removeClass('filterSort__loading--show');
}

/**
 * Creates & returns a new views array after altering the view & view's filter
 * @param _state
 * @param filterChange
 * @returns {Array}
 */
function makeViews(_state, filterChange) {
  return [..._state.views.map(view => {
    // Handle passed in view ids as an array.
    const filterChangeViewId = Array.isArray(filterChange.view) ? filterChange.view[0] : filterChange.view;

    if (view.id === filterChangeViewId || filterChangeViewId === '*') {
      view.filterGroups.forEach(filterGroup => {
        filterGroup.filters.forEach(filter => {
          if (filter.type === 'range') {
            const id = filterChange.id.split('--');

            if (filter.id === id[0]) {
              filter.range[id[1]] = filterChange.value;
            }

            if (filterChange.id === '*') {
              filter.range.start = filterChange.value;
              filter.range.end = filterChange.value;
            }
          } else {
            if (filter.id === filterChange.id || filterChange.id === '*') {
              filter.value = filterChange.value
            }
          }
        });
      });
    }

    return view;
  })];
}

/**
 * Apply any preferences being passed in. Called at the end of the INIT action. Must return state
 */
function applyPreferences(state) {

  /**
   * Apply the props preferences being passed in for rendering view props
   */
  state.selectedView.props = mergePropsAndPreferences(state.selectedView, state.preferences);
  return state;
}

/** 
* Reduce preferences to only the selected view for the "props" key.
* Run that over the config props to see if we need to make any changes.
* Return the adjusted config props for use in rendering.
* @todo see how this plays with dynamically changed props...
*/
function mergePropsAndPreferences(selectedView, preferences = []) {
  const propsPreferences = preferences
    ? preferences
      .filter(pref => pref && pref.view === selectedView.id && pref.data.props)
      .reduce((acc, curr) => acc.concat(curr.data.props), [])
    : [];

    return selectedView.persistListSettings 
    ? selectedView.props
      .map(prop => {
        const propPref = propsPreferences
          .filter(pref => pref.key === prop.key);

        return propPref ? { ...prop, ...propPref[0] } : prop
      })
    : selectedView.props;
}
