// vim: tabstop=2 shiftwidth=2 expandtab
//

// Action types

export const UPDATE_THUMBNAILS = 'UPDATE_THUMBNAILS';
export const UPDATE_ALBUMS = 'UPDATE_ALBUMS';

// Action creators

export const updateThumbnails = (thumbs) => {
  return {
    type: UPDATE_THUMBNAILS,
    thumbs,
  };
}

export const updateAlbums = (albums) => {
  return {
    type: UPDATE_ALBUMS,
    albums,
  };
}

