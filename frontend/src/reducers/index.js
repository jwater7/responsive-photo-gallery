// vim: tabstop=2 shiftwidth=2 expandtab
//

import { combineReducers } from 'redux';

import {
  ADD_THUMBS,
  UPDATE_ALBUMS,
  ADD_LIST,
  ADD_COLLECTION_MAP,
} from '../actions';

const thumbs = (state = {}, action) => {
  switch (action.type) {
    case ADD_THUMBS:
      // thumbs = {'album': {'dimension': {data} } }
      let newThumbs = Object.assign({}, state);
      let newAlbum = Object.assign({}, state[action.album]);
      newThumbs[action.album] = newAlbum;
      newThumbs[action.album][action.dimension] = action.thumbs;
      return newThumbs;
    default:
      return state;
  }
};

const albums = (state = {}, action) => {
  switch (action.type) {
    case UPDATE_ALBUMS:
      return action.albums;
    default:
      return state;
  }
};

const list = (state = {}, action) => {
  switch (action.type) {
    case ADD_LIST:
      let newList = Object.assign({}, state);
      newList[action.album] = action.list;
      return newList;
    default:
      return state;
  }
};

const collectionMap = (state = {}, action) => {
  switch (action.type) {
    case ADD_COLLECTION_MAP:
      let newList = Object.assign({}, state);
      newList[action.album] = action.collectionMap;
      return newList;
    default:
      return state;
  }
};

const reducers = combineReducers({
  thumbs,
  albums,
  list,
  collectionMap,
});

export default reducers;
