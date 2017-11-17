// vim: tabstop=2 shiftwidth=2 expandtab
//

import { combineReducers } from 'redux';

import {
  ADD_THUMBS,
  UPDATE_ALBUMS,
  ADD_LIST,
} from '../actions'

const thumbs = (state = {}, action) => {
  switch (action.type) {
    case ADD_THUMBS:
      let newThumbs = Object.assign({}, state);
      newThumbs[action.album] = action.thumbs;
      return (newThumbs);
    default:
      return state;
  }
}

const albums = (state = {}, action) => {
  switch (action.type) {
    case UPDATE_ALBUMS:
      return action.albums;
    default:
      return state;
  }
}

const list = (state = {}, action) => {
  switch (action.type) {
    case ADD_LIST:
      let newList = Object.assign({}, state);
      newList[action.album] = action.list;
      return (newList);
    default:
      return state;
  }
}

const reducers = combineReducers({
  thumbs,
  albums,
  list,
});

export default reducers;

