// vim: tabstop=2 shiftwidth=2 expandtab
//

import { connect } from 'react-redux';
import API from '../api';
import AlbumElement from './AlbumElement';
import { addThumbs } from '../actions';

const mapStateToProps = (state) => {
  return {
    thumbs: state.thumbs,
  }
}

let max_list_items = 50;
if (process.env.REACT_APP_MAX_LIST) {
  max_list_items = process.env.REACT_APP_MAX_LIST;
}

const mapDispatchToProps = (dispatch) => {
  return {
    addThumbs: (album, dim, authtoken) => {

      API.thumbnails((thumbs) => {
        dispatch(addThumbs(album, thumbs, dim));
      }, {
        token: authtoken,
        album: album,
        thumb: dim,
        max_list_items,
      });
    },
  }
}

const AlbumElementContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(AlbumElement);

export default AlbumElementContainer;

