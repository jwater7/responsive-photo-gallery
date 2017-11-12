import React, { Component } from 'react';
import API from '../api';
import Gallery from 'react-photo-gallery';

class List extends Component {

  state = {
    albums: {},
    files: {},
  };

  componentDidMount() {

    API.albums((albums) => {
      this.setState({
        albums: albums,
      })

      let first = Object.keys(albums)[0];
      if (!first) {
        return;
      }

      API.list((files) => {
        this.setState({
          files: files,
        })
      }, {
        token: this.props.authtoken,
        album: first,
      });

    }, {
      token: this.props.authtoken,
    });

  }

  photos = () => {
    let first = Object.keys(this.state.albums)[0];
    if (!first) {
      return [];
    }
    let imagelist = [];
    let filelist = Object.keys(this.state.files);
    for (let i = 0; i < filelist.length; i++) {
      let imageurl = API.imageurl({
        token: this.props.authtoken,
        album: first,
        image: filelist[i],
      })
      if(!imageurl) {
        continue;
      }
      let imageobj = {src: imageurl, width: 1, height: 1};
      imagelist.push(imageobj);
    }
    if (!imagelist) {
      return [];
    }
    return(imagelist);
  }

  render() {
    return (
      <div>
        <h1>List:</h1>
        <Gallery photos={this.photos()} />
      </div>
    );
  }
}

export default List;

