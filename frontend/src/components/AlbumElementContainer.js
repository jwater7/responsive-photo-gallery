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
    addThumbs: (album, authtoken) => {

      API.thumbnails((thumbs) => {
        dispatch(addThumbs(album, thumbs));
      }, {
        token: authtoken,
        album: album,
        thumb: '40x40',
      });
    },
  }
}

const AlbumElementContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(AlbumElement);

export default AlbumElementContainer;

