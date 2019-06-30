// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb, Row, Col } from 'react-bootstrap';
import API from '../api';
//import Gallery from 'react-photo-gallery';
//import ImageList from './ImageList';
import { PhotoSwipeGallery } from 'react-photoswipe';

class ImageWithStatusText extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loaded: false };
  }

  handleImageLoaded() {
    this.setState({ loaded: true });
  }

  render() {
    return (
      <div>
        {!this.state.loaded ? (
          <svg width="100" height="100" viewBox="0 0 100 100">  
            <rect width="100" height="100" rx="10" ry="10" fill="#CCC" />
          </svg>
        ) : null}
        <img
          alt={this.props.alt}
          src={this.props.src}
          width={this.props.width}
          height={this.props.height}
          style={!this.state.loaded ? { visibility: 'hidden' } : {}}
          onLoad={this.handleImageLoaded.bind(this)}
        />
      </div>
    );
  }
}

const getThumbnailContent = (item) => {
  if (item['data-video-src']) {
    return (
      <div style={{position: 'relative'}}>
        <ImageWithStatusText alt={item.key} src={item.thumbnail} width={item.thumbnailWidth} height={item.thumbnailHeight} />
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26" style={{position:'absolute', bottom:0, opacity: .4}}>
          <polygon points="9.33 6.69 9.33 19.39 19.3 13.04 9.33 6.69"/>
          <path d="M26,13A13,13,0,1,1,13,0,13,13,0,0,1,26,13ZM13,2.18A10.89,10.89,0,1,0,23.84,13.06,10.89,10.89,0,0,0,13,2.18Z"/>
        </svg> 
      </div>
    )
  }
  return (
    <ImageWithStatusText alt={item.key} src={item.thumbnail} width={item.thumbnailWidth} height={item.thumbnailHeight} />
  );
}

class List extends React.Component {

  thumbDim = '100x100';

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list) || !(this.props.match.params.album in this.props.collectionMap)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

    //if (!(this.props.match.params.album in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[this.props.match.params.album])) {
    //  this.props.addThumbs(this.props.match.params.album, this.thumbDim, this.props.authtoken);
    //}

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
    //if (!(alb in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[alb]) || !(alb in this.props.list)) {
    if (!(alb in this.props.list)) {
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
      let thumburl = API.imageurl({
        token: this.props.authtoken,
        album: alb,
        image: filename,
        thumb: this.thumbDim,
      })
      //if (!(filename in this.props.thumbs[alb][this.thumbDim])) {
      //  continue;
      //}
      //let thumburl = this.props.thumbs[alb][this.thumbDim][filename].base64tag;
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
      // if it is actually a video, save location and trick the gallery
      if(this.props.list[alb][filename].format === 'video') {
        let videoparams = {
          token: this.props.authtoken,
          album: alb,
          image: filename,
        };
        imageobj['data-video-src'] = API.videourl(videoparams);
        delete imageobj['src'];
        // TODO this is messy and duplicated from above
        imageobj['html'] = '<div style="padding-top: 44px; height: 100%; text-align: center"><a href="' + imageobj['data-video-src'] + '">' + 
          '<div style="position: relative; display: inline-block;"><img src=' + thumburl + ' style="display: block; height: auto;"/><svg style="position: absolute; top: 0; left: 0; opacity: .4; width: 100px;" viewBox="0 0 26 26">' + 
          '' + 
          '<polygon points="9.33 6.69 9.33 19.39 19.3 13.04 9.33 6.69"/>' + 
          '<path d="M26,13A13,13,0,1,1,13,0,13,13,0,0,1,26,13ZM13,2.18A10.89,10.89,0,1,0,23.84,13.06,10.89,10.89,0,0,0,13,2.18Z"/>' + 
          '</svg></div>' + 
          '</a></div>';
      }
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

