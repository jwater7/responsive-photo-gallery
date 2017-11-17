// vim: tabstop=2 shiftwidth=2 expandtab
//

import { connect } from 'react-redux';
import API from '../api';
import List from './List';
import { addList, addThumbs } from '../actions';

const mapStateToProps = (state) => {
  return {
    thumbs: state.thumbs,
    list: state.list,
  }
}

const mapDispatchToProps = (dispatch) => {
  return {
    loadList: (album, authtoken) => {

      API.list((list) => {
        dispatch(addList(album, list));
      }, {
        token: authtoken,
        album: album,
      });
    },
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

const ListContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(List);

export default ListContainer;

