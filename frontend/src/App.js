import React, { Component } from 'react';
//import logo from './logo.svg';
import './App.css';

// TODO pass in
var api_prefix = '';
if (process.env.REACT_APP_API_PREFIX) {
  api_prefix = process.env.REACT_APP_API_PREFIX;
  if (api_prefix.substr(-1) != '/') {
    api_prefix += '/';
  }
}
api_prefix += 'api/v1';

class App extends Component {
  state = {files: []};

  componentDidMount() {
    fetch(api_prefix + '/list')
      .then(res => res.json())
      .then(jsonData => {
        if (jsonData.error) {
          console.log('LIST ERROR: (' + jsonData.error.code + ') ' + jsonData.error.message);
          return;
        }
        this.setState({
          files: jsonData.result,
        })
      })
      // TODO debug log
      .catch(error => console.log('FETCH ERROR: ' + error.message));

  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          {/*<img src={logo} className="App-logo" alt="logo" />*/}
          <h1 className="App-title">Responsive Photo Gallery</h1>
        </header>
        <ul className="file-list">
          {this.state.files.map(file =>
            <li key={file}>{file}</li>
          )}
        </ul>
      </div>
    );
  }
}

export default App;
