// vim: tabstop=2 shiftwidth=2 expandtab
//

// Action types

export const ADD_THUMBS = 'ADD_THUMBS';
export const UPDATE_ALBUMS = 'UPDATE_ALBUMS';
export const ADD_LIST = 'ADD_LIST';

// Action creators

export const addThumbs = (album, thumbs, dimension) => {
  return {
    type: ADD_THUMBS,
    album,
    thumbs,
    dimension,
  };
}

export const updateAlbums = (albums) => {
  return {
    type: UPDATE_ALBUMS,
    albums,
  };
}

export const addList = (album, list) => {
  return {
    type: ADD_LIST,
    album,
    list,
  };
}

