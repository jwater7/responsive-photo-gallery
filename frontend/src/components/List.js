// vim: tabstop=2 shiftwidth=2 expandtab
//

import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';
import Gallery from 'react-photo-gallery';

const getMonthForListItem = (item) => {
  let mtime = item.modifyDate;
  if (!mtime) {
    return 'UNKNOWN';
  }
  let mdate = new Date(mtime);
  let month = mdate.getMonth();
  return month.toString();
}

class List extends Component {

  thumbDim = '100x100';

  componentDidMount() {

    if (!(this.props.match.params.album in this.props.list)) {
      this.props.loadList(this.props.match.params.album, this.props.authtoken);
    }

    if (!(this.props.match.params.album in this.props.thumbs) || !(this.thumbDim in this.props.thumbs[this.props.match.params.album])) {
      this.props.addThumbs(this.props.match.params.album, this.thumbDim, this.props.authtoken);
    }
  }

  getMonthMap = () => {

    if (!this.props.match.params.album) {
      return {};
    }
    const alb = this.props.match.params.album;

    let monthMap = {};
    if (alb in this.props.list) {
      let filelist = Object.keys(this.props.list[alb]);
      for (let i = 0; i < filelist.length; i++) {
        let filename = filelist[i];
        let month = getMonthForListItem(this.props.list[alb][filename]);
        monthMap[month] = true;
      }
    }

    return monthMap;
  }

  photos = (month = undefined) => {

    if (month === undefined) {
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
    let filelist = Object.keys(this.props.list[alb]);
    for (let i = 0; i < filelist.length; i++) {
      let filename = filelist[i];
      if(getMonthForListItem(this.props.list[alb][filename]) !== month) {
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
      if (!(filename in this.props.thumbs[alb][this.thumbDim])) {
        continue;
      }
      let thumburl = this.props.thumbs[alb][this.thumbDim][filename].base64tag;
      let imageobj = {key: filename, src: thumburl, width: 1, height: 1, orig: imageurl};
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  render() {
    const monthMap = this.getMonthMap();
    return (
      <div>
        <h1>List for {this.props.match.params.album}:</h1>
        {Object.keys(monthMap).map((month) => (
          <Link key={month} to={{
            pathname: `/collection/${this.props.match.params.album}`,
            search: '?filter=' + JSON.stringify({month: month}),
            /*search: '?filter=' + JSON.stringify({year: '2017', month: '3'}), */
          }}>
            <h2>Collection for {month}:</h2>
            <Gallery columns={10} margin={.5} photos={this.photos(month)} />
          </Link>
        ))}
      </div>
    );
  }
}

export default List;

