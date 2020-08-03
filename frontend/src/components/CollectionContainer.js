// vim: tabstop=2 shiftwidth=2 expandtab
//

import { connect } from 'react-redux';
import API from '../api';
import Collection from './Collection';
import { addList } from '../actions';

const mapStateToProps = (state) => {
  return {
    list: state.list,
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    loadList: (album, authtoken) => {
      API.list(
        (list) => {
          dispatch(addList(album, list));
        },
        {
          token: authtoken,
          album: album,
        }
      );
    },
  };
};

const CollectionContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Collection);

export default CollectionContainer;
