// vim: tabstop=2 shiftwidth=2 expandtab
//

import { connect } from 'react-redux';
import API from '../api';
import List from './List';
import { addList, addThumbs, addCollectionMap } from '../actions';

const createCollectionObjectForListItem = (item) => {
  let mtime = item.modifyDate;
  if (!mtime) {
    return {collection: 'UNKNOWN', filter: ''};
  }
  let mdate = new Date(mtime);
  let month = mdate.getMonth();
  let monthstr = month.toString();
  let year = mdate.getFullYear();
  let yearstr = year.toString();
  let collection = year + '.' + ('0' + (month + 1)).slice(-2);
  var obj = {
    collection,
    filter: JSON.stringify({month: monthstr, year: yearstr}),
    month,
    year,
  }
  return obj;
}

const loadCollectionMap = (album, list) => {

  //populate collectionMap
  const filelist = Object.keys(list);
  const collectionMap = {};
  for (let i = 0; i < filelist.length; i++) {
    let filename = filelist[i];
    let collectionItem = createCollectionObjectForListItem(list[filename]);
    // Make the list if it doesnt exist yet
    if (!collectionMap[collectionItem.collection]) {
      collectionMap[collectionItem.collection] = {
        filter: collectionItem.filter,
        description: (collectionItem.month + 1) + '/' + collectionItem.year,
        items: [],
      };
    }
    // add to the list
    collectionMap[collectionItem.collection].items.push(filename);
    if (list[filename].tags.includes('favorite')) {
      if (!collectionMap.favorites) {
        collectionMap.favorites = {
          filter: {
            tags: ['favorite']
          },
          collection: 'favorites',
          description: 'Favorites',
          items: []
        };
      }

      collectionMap.favorites.items.push(filename);
    }
  }

  // {collection: {description, filter, items: ['filename', ...]}, ...}
  return collectionMap;

}

const mapStateToProps = (state) => {
  return {
    thumbs: state.thumbs,
    list: state.list,
    collectionMap: state.collectionMap,
  }
}

const mapDispatchToProps = (dispatch) => {
  return {
    loadList: (album, authtoken) => {

      API.list((list) => {
        dispatch(addList(album, list));
        var collectionMap = loadCollectionMap(album, list);
        dispatch(addCollectionMap(album, collectionMap));
      }, {
        token: authtoken,
        album: album,
      });
    },
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

const ListContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(List);

export default ListContainer;

