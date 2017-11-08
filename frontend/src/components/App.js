import React, { Component } from 'react';
import Header from './Header';
import Main from './Main';
//import logo from './logo.svg';
//import './App.css';

const title = 'Responsive Photo Gallery';

class App extends Component {

  componentDidMount() {
    document.title = title;
  }

  render() {
    return (
      <div className="App">
        <Header pagetitle={title}/>
        <Main />
      </div>
    );
  }
}

export default App;

