// vim: tabstop=2 shiftwidth=2 expandtab
//

import React from 'react';
//import { Link } from 'react-router-dom';
import { Breadcrumb, Row, Col } from 'react-bootstrap';
import API from '../api';
//import Gallery from 'react-photo-gallery';
//import ImageList from './ImageList';
import { PhotoSwipeGallery } from 'react-photoswipe';

const passDateFilter = (filter, mtime) => {
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
  return true;
}

class List extends React.Component {

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

  }

  getURLParams = () => {
    // find the filter
    if (!this.props.location.search) {
      return undefined;
    }
    const params = new URLSearchParams(this.props.location.search);
    const json_filter = params.get('filter');
    if (!json_filter) {
      return undefined;
    }
    const filter = JSON.parse(json_filter);

    const json_description = params.get('description');
    if (!json_description) {
      return undefined;
    }

    const description = JSON.parse(json_description);

    return {
      filter,
      description,
    };
  }

  photos = () => {
    if (!this.props.match.params.album) {
      return [];
    }

    let {filter} = this.getURLParams();
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
      let mtime = this.props.list[alb][filename].modifyDate;
      if (!passDateFilter(filter, mtime)) {
        continue;
      }

      let imageurl = API.imageurl({
        token: this.props.authtoken,
        album: alb,
        image: filename,
      })
      if(!imageurl) {
        continue;
      }
      let imageobj = {key: filename, src: imageurl, w: this.props.list[alb][filename].orientedWidth, h: this.props.list[alb][filename].orientedHeight};
      console.log(imageobj);
      //let imageobj = {key: filename, src: imageurl, width: '25%', height: '*'};
      //let imageobj = {key: filename, src: imageurl, width: this.props.list[alb][filename].width, height: this.props.list[alb][filename].height};
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  handleOnClick = (e, obj) => {
    //console.log(e.target);
    window.open(e.target.src);
    //console.log(obj);
    //window.open(obj.photo.src);
  }

  render() {
    let {description} = this.getURLParams();
    return (
      <div>
        <Breadcrumb>
          <Breadcrumb.Item onClick={ e => this.props.history.push("/albums")}>Albums</Breadcrumb.Item>
          <Breadcrumb.Item onClick={ e => this.props.history.push("/list/" + this.props.match.params.album)}>Collections</Breadcrumb.Item>
          <Breadcrumb.Item active>Collection</Breadcrumb.Item>
        </Breadcrumb>
        <h4 style={{overflow: 'hidden',}}>{this.props.match.params.album}<br/><small>{description}</small></h4>
        <Row>
          <Col xs={12}>
            {/*<Gallery columns={4} margin={1} photos={this.photos()} onClick={this.handleOnClick} />*/}
            {/*<ImageList photos={this.photos()} onClick={this.handleOnClick} />*/}
            <PhotoSwipeGallery items={this.photos()} onClick={this.handleOnClick} options={{shareButtons: [{id:'download', label:'Download image', url:'{{raw_image_url}}', download:true}]}} />
          </Col>
        </Row>
      </div>
    );
  }
}

export default List;

