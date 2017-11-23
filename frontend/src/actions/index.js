// vim: tabstop=2 shiftwidth=2 expandtab
//

// Action types

export const ADD_THUMBS = 'ADD_THUMBS';
export const UPDATE_ALBUMS = 'UPDATE_ALBUMS';
export const ADD_LIST = 'ADD_LIST';
export const ADD_COLLECTION_MAP = 'ADD_COLLECTION_MAP';

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

export const addCollectionMap = (album, collectionMap) => {
  return {
    type: ADD_COLLECTION_MAP,
    album,
    collectionMap,
  };
}

