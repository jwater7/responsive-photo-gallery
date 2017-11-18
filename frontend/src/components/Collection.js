// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import API from '../api';
import Gallery from 'react-photo-gallery';

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

class List extends Component {

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

  }

  photos = () => {
    if (!this.props.match.params.album) {
      return [];
    }
    // find the filter
    if (!this.props.location.search) {
      return [];
    }
    const params = new URLSearchParams(this.props.location.search);
    const json_filter = params.get('filter');
    if (!json_filter) {
      return [];
    }
    const filter = JSON.parse(json_filter);

    const alb = this.props.match.params.album;
    if (!(alb in this.props.list)) {
      return [];
    }
    let imagelist = [];
    let filelist = Object.keys(this.props.list[alb]);
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
      let imageobj = {key: filename, src: imageurl, width: this.props.list[alb][filename].width, height: this.props.list[alb][filename].height};
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  handleOnClick = (e, obj) => {
    //console.log(e.target);
    //console.log(obj);
    window.open(obj.photo.src);
  }

  render() {
    return (
      <div>
        <h1>Collection for {this.props.match.params.album}:</h1>
        <Gallery columns={4} margin={1} photos={this.photos()} onClick={this.handleOnClick} />
      </div>
    );
  }
}

export default List;

