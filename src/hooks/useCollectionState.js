import { useCallback, useReducer } from 'react';

import { COLLECTION_CONFIG, FILTER_CONFIG } from '../constants/collectionConstants';

// State action types
const COLLECTION_ACTIONS = {
  SET_LOADING: 'SET_LOADING',
  SET_REFRESHING: 'SET_REFRESHING',
  SET_CARDS: 'SET_CARDS',
  SET_INITIALIZED: 'SET_INITIALIZED',
  SET_ERROR: 'SET_ERROR',
  SET_SORT_BY: 'SET_SORT_BY',
  SET_SORT_ORDER: 'SET_SORT_ORDER',
  SET_FILTER_STATUS: 'SET_FILTER_STATUS',
  SET_DISPLAYED_CARD_COUNT: 'SET_DISPLAYED_CARD_COUNT',
  SET_IS_LOADING_MORE: 'SET_IS_LOADING_MORE',
  SET_RETRY_COUNT: 'SET_RETRY_COUNT',
  SET_USER_GEMS: 'SET_USER_GEMS',
  RESET_STATE: 'RESET_STATE',
  UPDATE_FILTER_SETTINGS: 'UPDATE_FILTER_SETTINGS',
  UPDATE_UI: 'UPDATE_UI'
};

// Initial state using shared constants
const initialState = {
  cards: [],
  loading: true,
  refreshing: false,
  initialized: false,
  userGems: 0,
  sortBy: FILTER_CONFIG.SORT_OPTIONS.NAME,
  sortOrder: FILTER_CONFIG.SORT_ORDERS.ASC,
  filterStatus: FILTER_CONFIG.STATUSES.ALL,
  displayedCardCount: COLLECTION_CONFIG.CARD_LOAD_BATCH_SIZE,
  isLoadingMore: false,
  error: null,
  retryCount: 0,
  confirmDialog: false,
  cardToDelete: null,
  selectedCard: null,
  cardPreviewVisible: false,
  downloadingCard: false,
  sortByMenuVisible: false,
  sortOrderMenuVisible: false,
  filterStatusMenuVisible: false
};

// Reducer function
const collectionReducer = (state, action) => {
  switch (action.type) {
    case COLLECTION_ACTIONS.SET_LOADING:
      return { ...state, loading: action.payload };
      
    case COLLECTION_ACTIONS.SET_REFRESHING:
      return { ...state, refreshing: action.payload };
      
    case COLLECTION_ACTIONS.SET_CARDS:
      return { ...state, cards: action.payload };
      
    case COLLECTION_ACTIONS.SET_INITIALIZED:
      return { ...state, initialized: action.payload };
      
    case COLLECTION_ACTIONS.SET_ERROR:
      return { ...state, error: action.payload };
      
    case COLLECTION_ACTIONS.SET_SORT_BY:
      return { ...state, sortBy: action.payload, displayedCardCount: COLLECTION_CONFIG.CARD_LOAD_BATCH_SIZE };
      
    case COLLECTION_ACTIONS.SET_SORT_ORDER:
      return { ...state, sortOrder: action.payload, displayedCardCount: COLLECTION_CONFIG.CARD_LOAD_BATCH_SIZE };
      
    case COLLECTION_ACTIONS.SET_FILTER_STATUS:
      return { ...state, filterStatus: action.payload, displayedCardCount: COLLECTION_CONFIG.CARD_LOAD_BATCH_SIZE };
      
    case COLLECTION_ACTIONS.SET_DISPLAYED_CARD_COUNT:
      return { ...state, displayedCardCount: action.payload };
      
    case COLLECTION_ACTIONS.SET_IS_LOADING_MORE:
      return { ...state, isLoadingMore: action.payload };
      
    case COLLECTION_ACTIONS.SET_RETRY_COUNT:
      return { ...state, retryCount: action.payload };
      
    case COLLECTION_ACTIONS.SET_USER_GEMS:
      return { ...state, userGems: action.payload };
      
    case COLLECTION_ACTIONS.UPDATE_FILTER_SETTINGS:
      return { 
        ...state, 
        ...action.payload, 
        displayedCardCount: COLLECTION_CONFIG.CARD_LOAD_BATCH_SIZE // Reset display count when filters change
      };
      
    case COLLECTION_ACTIONS.RESET_STATE:
      return { 
        ...initialState, 
        initialized: false, 
        cards: [], 
        loading: true 
      };
      
    case COLLECTION_ACTIONS.UPDATE_UI:
      return { 
        ...state, 
        ...action.payload 
      };
      
    default:
      return state;
  }
};

export const useCollectionState = () => {
  const [state, dispatch] = useReducer(collectionReducer, initialState);

  // Action creators
  const actions = {
    setLoading: useCallback((loading) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_LOADING, payload: loading });
    }, []),

    setRefreshing: useCallback((refreshing) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_REFRESHING, payload: refreshing });
    }, []),

    setCards: useCallback((cards) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_CARDS, payload: cards });
    }, []),

    setInitialized: useCallback((initialized) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_INITIALIZED, payload: initialized });
    }, []),

    setError: useCallback((error) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_ERROR, payload: error });
    }, []),

    setSortBy: useCallback((sortBy) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_SORT_BY, payload: sortBy });
    }, []),

    setSortOrder: useCallback((sortOrder) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_SORT_ORDER, payload: sortOrder });
    }, []),

    setFilterStatus: useCallback((filterStatus) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_FILTER_STATUS, payload: filterStatus });
    }, []),

    setDisplayedCardCount: useCallback((count) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_DISPLAYED_CARD_COUNT, payload: count });
    }, []),

    setIsLoadingMore: useCallback((isLoading) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_IS_LOADING_MORE, payload: isLoading });
    }, []),

    setRetryCount: useCallback((count) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_RETRY_COUNT, payload: count });
    }, []),

    setUserGems: useCallback((gems) => {
      dispatch({ type: COLLECTION_ACTIONS.SET_USER_GEMS, payload: gems });
    }, []),

    updateFilterSettings: useCallback((settings) => {
      dispatch({ type: COLLECTION_ACTIONS.UPDATE_FILTER_SETTINGS, payload: settings });
    }, []),

    resetState: useCallback(() => {
      dispatch({ type: COLLECTION_ACTIONS.RESET_STATE });
    }, []),

    updateUI: useCallback((uiUpdates) => {
      dispatch({ type: COLLECTION_ACTIONS.UPDATE_UI, payload: uiUpdates });
    }, [])
  };

  return { state, actions };
}; 