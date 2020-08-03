// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Link } from 'react-router-dom';
import { Breadcrumb, Row, Col } from 'react-bootstrap';
import API from '../api';
//import Gallery from 'react-photo-gallery';
//import ImageList from './ImageList';
import { PhotoSwipeGallery } from 'react-photoswipe-2';
import { getURLParams } from '../utils';

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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26" style={{position:'absolute', bottom:0, opacity: .4, width: '100%'}}>
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

const VideoHtml = (props) => (
  <div style={{paddingTop: '44px', height: '100%', textAlign: 'center'}}>
    <a href={props.basename + "singleview/" + props.album + "?imageurl=" + encodeURIComponent(props.image) + "&thumburl=" + encodeURIComponent(props.thumburl) + "&collection=" + encodeURIComponent(props.collection) + "&imageIndex=" + encodeURIComponent(props.imageIndex)}>
      <div style={{position: 'relative', display: 'inline-block', width: '100%', height: '100%', paddingBottom: '88px'}}>
        <div style={{position: 'relative', display: 'block', height: '100%'}}>
          <img src={props.thumburl} style={{display: 'block', height: '100%', margin: '0 auto'}} alt="thumbnail"/>
          <svg style={{position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%)', opacity: '.4', height: '100%'}} viewBox="0 0 26 26">
            <polygon points="9.33 6.69 9.33 19.39 19.3 13.04 9.33 6.69"/>
            <path d="M26,13A13,13,0,1,1,13,0,13,13,0,0,1,26,13ZM13,2.18A10.89,10.89,0,1,0,23.84,13.06,10.89,10.89,0,0,0,13,2.18Z"/>
          </svg>
        </div>
      </div>
    </a>
  </div>
);

const PhotoCaption = (props) => (
  <span>{props.filename} <a href={props.basename + "edit/" + props.album + "?filename=" + encodeURIComponent(props.filename) + "&collection=" + encodeURIComponent(props.collection) + "&imageIndex=" + encodeURIComponent(props.imageIndex)}>[edit]</a></span>
);

class List extends React.Component {

  thumbDim = '100x100';

  state = {
    isOpen: null,
  }

  handleClose = () => {
    this.setState({ isOpen: null });
  }

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list) || !(this.props.match.params.album in this.props.collectionMap)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

    const { openAtCollection } = getURLParams(this.props.location.search, {openAtCollection: null});
    this.setState({ isOpen: openAtCollection });
    

    //if (!(this.props.match.params.album in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[this.props.match.params.album])) {
    //  this.props.addThumbs(this.props.match.params.album, this.thumbDim, this.props.authtoken);
    //}

  }

  photos = (collection, collectionItems = undefined) => {

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
        //title: filename,
        title: ReactDOMServer.renderToStaticMarkup(<PhotoCaption basename={this.props.basename} album={this.props.match.params.album} filename={filename} collection={collection} imageIndex={imagelist.length} />),
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
        imageobj['html'] = ReactDOMServer.renderToStaticMarkup(<VideoHtml thumburl={thumburl} basename={this.props.basename} album={this.props.match.params.album} image={imageobj['data-video-src']} collection={collection} imageIndex={imagelist.length} />)
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
    const { isOpen } = this.state;
    const { startIndex } = getURLParams(this.props.location.search, {startIndex: 0});
    const collectionMap = this.getCollectionMapForAlbum(this.props.match.params.album);
    const collectionKeys = [...(Object.keys(collectionMap).includes('favorites') ? ['favorites'] : []), ...(Object.keys(collectionMap).sort().filter(it => it !== 'favorites'))]
    const options = {
      index: Number(startIndex),

      // Share buttons
      // 
      // Available variables for URL:
      // {{url}}             - url to current page
      // {{text}}            - title
      // {{image_url}}       - encoded image url
      // {{raw_image_url}}   - raw image url
      shareButtons: [
        //{id:'facebook', label:'Share on Facebook', url:'https://www.facebook.com/sharer/sharer.php?u={{url}}'},
        //{id:'twitter', label:'Tweet', url:'https://twitter.com/intent/tweet?text={{text}}&url={{url}}'},
        //{id:'favorite', label:'Favorite', url:'../singleview/{{text}}?url={{url}}&media={{image_url}}&description={{raw_image_url}}'},
        {id:'download', label:'Download image', url:'{{raw_image_url}}', download:true}
      ],
    }
    return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item onClick={ e => this.props.history.push("/albums")}>Albums</Breadcrumb.Item>
          <Breadcrumb.Item active>Collections</Breadcrumb.Item>
        </Breadcrumb>
        <h4 style={{overflow: 'hidden',}}>{this.props.match.params.album}</h4>
        <Row>
          <Col xs={12}>
            {collectionKeys.map((collectionKey) => (
              <div key={collectionKey}>
                <Link key={collectionKey} to={{
                  pathname: `/collection/${this.props.match.params.album}`,
                  search: '?filter=' + JSON.stringify(collectionMap[collectionKey].filter) + '&description=' + JSON.stringify(collectionMap[collectionKey].description),
                  /*search: '?filter=' + JSON.stringify({year: '2017', month: '3'}), */
                }}>
                  <h5 style={{overflow: 'hidden',}}>{collectionMap[collectionKey].description}</h5>
                  {/*<ImageList photos={this.photos(collectionMap[collectionKey].items)} />*/}
                  {/*<Gallery columns={10} margin={.5} photos={this.photos(collectionMap[collectionKey].items)} />*/}
                </Link>
                <PhotoSwipeGallery isOpen={isOpen === collectionKey} onClose={this.handleClose} items={this.photos(collectionKey, collectionMap[collectionKey].items)} options={options} thumbnailContent={getThumbnailContent} />
              </div>
            ))}
          </Col>
        </Row>
      </div>
    );
  }
}

export default List;

