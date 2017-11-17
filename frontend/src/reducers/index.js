// vim: tabstop=2 shiftwidth=2 expandtab
//

import { combineReducers } from 'redux';

import {
  UPDATE_THUMBNAILS,
  UPDATE_ALBUMS,
} from '../actions'

const thumbnails = (state = {}, action) => {
  switch (action.type) {
    case UPDATE_THUMBNAILS:
      return action.thumbs;
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

const reducers = combineReducers({
  thumbnails,
  albums,
});

export default reducers;

