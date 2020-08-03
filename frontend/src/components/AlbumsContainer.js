// vim: tabstop=2 shiftwidth=2 expandtab
//

import { connect } from 'react-redux';
import API from '../api';
import Albums from './Albums';
import { updateAlbums } from '../actions';

const mapStateToProps = (state) => {
  return {
    albums: state.albums,
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    loadAlbums: (authtoken) => {
      API.albums(
        (albums) => {
          dispatch(updateAlbums(albums));
        },
        {
          token: authtoken,
        }
      );
    },
  };
};

const AlbumsContainer = connect(mapStateToProps, mapDispatchToProps)(Albums);

export default AlbumsContainer;
