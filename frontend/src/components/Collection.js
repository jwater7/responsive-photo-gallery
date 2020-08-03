// vim: tabstop=2 shiftwidth=2 expandtab
//

import qs from 'query-string';

import React from 'react';
//import { Link } from 'react-router-dom';
import { Breadcrumb, Row, Col } from 'react-bootstrap';
import API from '../api';
import Gallery from 'react-photo-gallery';
//import ImageList from './ImageList';
//import { PhotoSwipeGallery } from 'react-photoswipe';

const passFilters = (filter, { mtime, tags }) => {
  if (filter.year) {
    if (!mtime) {
      return false;
    }
    let mdate = new Date(mtime);
    if (mdate.getFullYear().toString() !== filter.year) {
      return false;
    }
  }
  if (filter.month) {
    if (!mtime) {
      return false;
    }
    let mdate = new Date(mtime);
    if (mdate.getMonth().toString() !== filter.month) {
      return false;
    }
  }
  if (Array.isArray(filter.tags) && filter.tags.length) {
    if (!tags) {
      return false;
    }
    if (!tags.some((tag) => filter.tags.includes(tag))) {
      return false;
    }
  }
  return true;
};

class Collection extends React.Component {
  componentDidMount() {
    if (!(this.props.match.params.album in this.props.list)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }
  }

  getURLParams = () => {
    // find the filter
    if (!this.props.location.search) {
      return {};
    }

    //const params = new URLSearchParams(this.props.location.search);
    const params = qs.parse(this.props.location.search);

    const json_filter = params['filter'];
    //const json_filter = params.get('filter');
    let filter;
    if (json_filter) {
      filter = JSON.parse(json_filter);
    }

    const json_description = params['description'];
    //const json_description = params.get('description');
    let description;
    if (json_description) {
      description = JSON.parse(json_description);
    }

    return {
      filter,
      description,
    };
  };

  photos = () => {
    if (!this.props.match.params.album) {
      return [];
    }

    let { filter } = this.getURLParams();
    if (!filter) {
      return [];
    }

    const alb = this.props.match.params.album;
    if (!(alb in this.props.list)) {
      return [];
    }
    let imagelist = [];
    let filelist = Object.keys(this.props.list[alb]).sort();
    for (let i = 0; i < filelist.length; i++) {
      let filename = filelist[i];

      // Apply Date Filters if date is present
      const mtime = this.props.list[alb][filename].modifyDate;
      const tags = this.props.list[alb][filename].tags;
      if (!passFilters(filter, { mtime, tags })) {
        continue;
      }

      let imageparams = {
        token: this.props.authtoken,
        album: alb,
        image: filename,
      };
      // if it is a video then we want a thumbnail image url instead
      if (this.props.list[alb][filename].format === 'video') {
        imageparams['thumb'] =
          this.props.list[alb][filename].orientedWidth +
          'x' +
          this.props.list[alb][filename].orientedHeight;
      }

      let imageurl = API.imageurl(imageparams);
      if (!imageurl) {
        continue;
      }

      //let imageobj = {key: filename, src: imageurl, w: this.props.list[alb][filename].orientedWidth, h: this.props.list[alb][filename].orientedHeight};
      //let imageobj = {key: filename, src: imageurl, width: '25%', height: '*'};
      let imageobj = {
        key: filename,
        src: imageurl,
        width: this.props.list[alb][filename].orientedWidth,
        height: this.props.list[alb][filename].orientedHeight,
      };
      //let imageobj = {key: filename, src: imageurl, width: this.props.list[alb][filename].width, height: this.props.list[alb][filename].height};

      // if it is a video then we want a thumbnail image url instead
      if (this.props.list[alb][filename].format === 'video') {
        let videoparams = {
          token: this.props.authtoken,
          album: alb,
          image: filename,
        };
        imageobj['data-video-src'] = API.videourl(videoparams);
        if (!imageobj['data-video-src']) {
          continue;
        }
      }

      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return imagelist;
  };

  handleOnClick = (e, obj) => {
    //console.log(e.target);
    if (e.target.getAttribute('data-video-src')) {
      window.open(e.target.getAttribute('data-video-src'));
      return;
    }
    window.open(e.target.src);
    //console.log(obj);
    //window.open(obj.photo.src);
  };

  render() {
    let { description } = this.getURLParams();
    return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item onClick={(e) => this.props.history.push('/albums')}>
            Albums
          </Breadcrumb.Item>
          <Breadcrumb.Item
            onClick={(e) =>
              this.props.history.push('/list/' + this.props.match.params.album)
            }
          >
            Collections
          </Breadcrumb.Item>
          <Breadcrumb.Item active>Collection</Breadcrumb.Item>
        </Breadcrumb>
        <h4 style={{ overflow: 'hidden' }}>
          {this.props.match.params.album}
          <br />
          <small>{description}</small>
        </h4>
        <Row>
          <Col xs={12}>
            <Gallery
              columns={4}
              margin={1}
              photos={this.photos()}
              onClick={this.handleOnClick}
            />
            {/*<ImageList photos={this.photos()} onClick={this.handleOnClick} />*/}
            {/*<PhotoSwipeGallery items={this.photos()} onClick={this.handleOnClick} options={{shareButtons: [{id:'download', label:'Download image', url:'{{raw_image_url}}', download:true}]}} />*/}
          </Col>
        </Row>
      </div>
    );
  }
}

export default Collection;
