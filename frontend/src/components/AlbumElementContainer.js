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

const mapDispatchToProps = (dispatch) => {
  return {
    addThumbs: (album, dim, authtoken) => {

      API.thumbnails((thumbs) => {
        dispatch(addThumbs(album, thumbs, dim));
      }, {
        token: authtoken,
        album: album,
        thumb: dim,
      });
    },
  }
}

const AlbumElementContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(AlbumElement);

export default AlbumElementContainer;

