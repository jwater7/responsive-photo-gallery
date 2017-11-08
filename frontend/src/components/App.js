import React, { Component } from 'react';
//import logo from './logo.svg';
//import './App.css';
import { Navbar } from 'react-bootstrap';

// TODO pass in
var api_prefix = '';
if (process.env.REACT_APP_API_PREFIX) {
  api_prefix = process.env.REACT_APP_API_PREFIX;
  if (api_prefix.substr(-1) !== '/') {
    api_prefix += '/';
  }
}
api_prefix += 'api/v1';

var title = 'Responsive Photo Gallery';

class App extends Component {
  state = {files: []};

  componentDidMount() {

    document.title = title;

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
        <Navbar>
          <Navbar.Header>
            <Navbar.Brand>
              {title}
            </Navbar.Brand>
          </Navbar.Header>
        </Navbar>
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

