// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb, Row, Col } from 'react-bootstrap';
import API from '../api';
//import Gallery from 'react-photo-gallery';
//import ImageList from './ImageList';
import { PhotoSwipeGallery } from 'react-photoswipe';

const getThumbnailContent = (item) => {
  return (
    <img alt={item.key} src={item.thumbnail} width={item.thumbnailWidth} height={item.thumbnailHeight} />
  );
}

class List extends React.Component {

  thumbDim = '100x100';

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

    if (!(this.props.match.params.album in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[this.props.match.params.album])) {
      this.props.addThumbs(this.props.match.params.album, this.thumbDim, this.props.authtoken);
    }

  }

  photos = (collectionItems = undefined) => {

    const [width, height] = this.thumbDim.split('x');

    if (collectionItems === undefined) {
      return [];
    }

    if (!this.props.match.params.album) {
      return [];
    }
    const alb = this.props.match.params.album;
    if (!(alb in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[alb]) || !(alb in this.props.list)) {
      return [];
    }
    let imagelist = [];
    // TODO sort by modify date instead of filename;
    let sortedCollectionItems = collectionItems.sort();
    for (let i = 0; i < sortedCollectionItems.length; i++) {
      let filename = sortedCollectionItems[i];
      let imageurl = API.imageurl({
        token: this.props.authtoken,
        album: alb,
        image: filename,
      })
      if(!imageurl) {
        continue;
      }
      if (!(filename in this.props.thumbs[alb][this.thumbDim])) {
        continue;
      }
      let thumburl = this.props.thumbs[alb][this.thumbDim][filename].base64tag;
      //let imageobj = {key: filename, src: thumburl, width, height, orig: imageurl};
      let imageobj = {
        key: filename,
        title: filename,
        src: imageurl,
        w: this.props.list[alb][filename].orientedWidth,
        h: this.props.list[alb][filename].orientedHeight,
        thumbnail: thumburl,
        thumbnailWidth: width,
        thumbnailHeight: height,
      };
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  getCollectionMapForAlbum = (album) => {
    if (!(album in this.props.collectionMap)) {
      return {};
    }
    return this.props.collectionMap[album];
  }

  render() {
    const collectionMap = this.getCollectionMapForAlbum(this.props.match.params.album);
    return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item onClick={ e => this.props.history.push("/albums")}>Albums</Breadcrumb.Item>
          <Breadcrumb.Item active>Collections</Breadcrumb.Item>
        </Breadcrumb>
        <h4 style={{overflow: 'hidden',}}>{this.props.match.params.album}</h4>
        <Row>
          <Col xs={12}>
            {Object.keys(collectionMap).sort().map((collectionKey) => (
              <div key={collectionKey}>
                <Link key={collectionKey} to={{
                  pathname: `/collection/${this.props.match.params.album}`,
                  search: '?filter=' + collectionMap[collectionKey].filter + '&description=' + JSON.stringify(collectionMap[collectionKey].description),
                  /*search: '?filter=' + JSON.stringify({year: '2017', month: '3'}), */
                }}>
                  <h5 style={{overflow: 'hidden',}}>{collectionMap[collectionKey].description}</h5>
                  {/*<ImageList photos={this.photos(collectionMap[collectionKey].items)} />*/}
                  {/*<Gallery columns={10} margin={.5} photos={this.photos(collectionMap[collectionKey].items)} />*/}
                </Link>
                <PhotoSwipeGallery items={this.photos(collectionMap[collectionKey].items)} options={{shareButtons: [{id:'download', label:'Download image', url:'{{raw_image_url}}', download:true}]}} thumbnailContent={getThumbnailContent} />
              </div>
            ))}
          </Col>
        </Row>
      </div>
    );
  }
}

export default List;

