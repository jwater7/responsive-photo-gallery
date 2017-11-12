import React, { Component } from 'react';
import API from '../api';

class List extends Component {

  state = {files: []};

  componentDidMount() {

    API.list((files) => {
      this.setState({
        files: files,
      })
    }, {
      token: this.props.authtoken,
    });
  }

  render() {
    return (
      <div>
        <h1>List:</h1>
        <ul className="file-list">
          {this.state.files.map(file =>
            <li key={file}>{file}</li>
          )}
        </ul>
      </div>
    );
  }
}

export default List;

