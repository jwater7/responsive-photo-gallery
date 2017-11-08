import React from 'react';
//import { Link } from 'react-router-dom';
import { Navbar } from 'react-bootstrap';

const Header = (props) => (
  <Navbar>
    <Navbar.Header>
      <Navbar.Brand>
        {props.pagetitle}
      </Navbar.Brand>
    </Navbar.Header>
  </Navbar>
);

export default Header;

